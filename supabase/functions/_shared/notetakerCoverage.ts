/**
 * Durable notetaker coverage ledger.
 *
 * Every CRM (GHL) appointment that the notetaker pipeline observes gets exactly
 * one `notetaker_coverage` row per client + appointment. The row records what we
 * EXPECT to capture (MeetGeek video recording vs a GHL phone call vs nothing),
 * the CRM booking state, and whether a transcript actually landed. A watchdog
 * reconciles the rows every 10 minutes and raises deterministic exceptions for
 * anything that is overdue, so a silent capture gap is impossible.
 *
 * The shadow/ghost calendar invite architecture is untouched: MeetGeek is never
 * an appointment owner, organizer or collective-calendar participant. This
 * module only observes and reconciles.
 */

export type ExpectedProvider = 'meetgeek' | 'ghl_phone' | 'none' | 'unknown';
export type AppointmentState =
  | 'scheduled'
  | 'rescheduled'
  | 'cancelled'
  | 'completed'
  | 'noshow'
  | 'unknown';
export type CoverageState =
  | 'pending'
  | 'invited'
  | 'awaiting_transcript'
  | 'transcript_complete'
  | 'no_answer'
  | 'not_required'
  | 'exception';
export type CoverageOutcome =
  | 'transcript_complete'
  | 'no_transcript'
  | 'no_answer'
  | 'cancelled'
  | 'not_required'
  | 'pending';

/** Where a proven transcript came from. */
export type TranscriptSource = 'meetgeek' | 'ghl_phone' | 'ghl_calls';
/** How the capture record was linked to the booking. */
export type CoverageMatchMethod =
  | 'ghl_appointment_id'
  | 'phone_appointment_id'
  | 'calls_appointment_id'
  | 'contact_time_window';

/** Minutes after the scheduled end before a missing transcript is an exception. */
export const TRANSCRIPT_GRACE_MINUTES = 90;
/** Minutes before the start by which a video booking must have been invited. */
export const INVITE_LEAD_MINUTES = 10;
/** A transcript shorter than this is treated as not usable. */
export const MIN_TRANSCRIPT_CHARS = 200;
/** Bounded window for the same-client contact/time fallback match. */
export const CONTACT_MATCH_WINDOW_MINUTES = 180;


const CANCELLED_RE = /cancel|deleted|removed/i;
const NOSHOW_RE = /no[\s_-]*show|noshow/i;
const SHOWED_RE = /showed|completed|attended|show$/i;
const VIDEO_LINK_RE =
  /(zoom\.us|meet\.google\.com|teams\.microsoft|teams\.live|whereby\.com|webex\.com|gotomeet|meetgeek\.ai|riverside\.fm|around\.co|daily\.co|chime\.aws|bluejeans|join\.skype)/i;

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function clean(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s ? s : null;
}

/** CRM-owned booking state. The CRM status always wins over local guesses. */
export function classifyAppointmentState(args: {
  rawStatus?: string | null;
  cancelled?: boolean;
  scheduledEnd?: string | null;
  scheduleChanged?: boolean;
  now?: Date;
}): AppointmentState {
  const raw = String(args.rawStatus || '');
  if (args.cancelled || CANCELLED_RE.test(raw)) return 'cancelled';
  if (NOSHOW_RE.test(raw)) return 'noshow';
  if (SHOWED_RE.test(raw)) return 'completed';
  const end = iso(args.scheduledEnd);
  const now = args.now || new Date();
  if (end && new Date(end).getTime() < now.getTime()) return 'completed';
  if (args.scheduleChanged) return 'rescheduled';
  if (!raw && !end) return 'unknown';
  return 'scheduled';
}

/**
 * What is expected to capture this appointment.
 * - a joinable video link  -> MeetGeek shadow invite
 * - no link but a phone    -> GHL dialer / phone-call transcription
 * - cancelled or neither   -> nothing is expected
 */
export function classifyExpectedProvider(args: {
  meetingUrl?: string | null;
  contactPhone?: string | null;
  appointmentState?: AppointmentState;
}): ExpectedProvider {
  if (args.appointmentState === 'cancelled') return 'none';
  const url = clean(args.meetingUrl);
  if (url && (VIDEO_LINK_RE.test(url) || /^https?:\/\//i.test(url))) return 'meetgeek';
  if (clean(args.contactPhone)) return 'ghl_phone';
  return 'none';
}

/**
 * Authoritative CRM call disposition. A genuine no-answer / busy / failed /
 * voicemail dial is a COMPLETED non-transcript outcome: there was never any
 * speech to transcribe, so it must never be reported as a missing transcript
 * and no transcript text is ever invented for it.
 *
 * Only authoritative CRM fields are consulted (`connected`, `answered`,
 * `call_status`, `outcome`). Duration alone is never sufficient.
 */
export interface CallDisposition {
  noAnswer: boolean;
  reason: string | null;
}

const NO_ANSWER_PATTERNS: [RegExp, string][] = [
  [/voice[\s_-]*mail|voicemail|left[\s_-]*message|machine/i, 'voicemail'],
  [/busy/i, 'busy'],
  [/no[\s_-]*answer|unanswered|no[\s_-]*response|missed/i, 'no_answer'],
  [/fail|error|canceled_by_caller|cancelled_by_caller|declin|reject|unreachable|invalid[\s_-]*number/i, 'failed'],
];

export function classifyCallDisposition(args: {
  connected?: boolean | null;
  answered?: boolean | null;
  callStatus?: string | null;
  outcome?: string | null;
  transcriptChars?: number | null;
}): CallDisposition {
  // A real transcript always wins: never downgrade a captured conversation.
  if ((args.transcriptChars || 0) >= MIN_TRANSCRIPT_CHARS) return { noAnswer: false, reason: null };

  const text = `${args.callStatus || ''} ${args.outcome || ''}`;
  for (const [re, reason] of NO_ANSWER_PATTERNS) {
    if (re.test(text)) return { noAnswer: true, reason };
  }
  if (args.connected === false) return { noAnswer: true, reason: 'not_connected' };
  if (args.answered === false) return { noAnswer: true, reason: 'not_answered' };
  return { noAnswer: false, reason: null };
}

/** Deterministic deadline by which capture must be proven. */
export function computeOverdueAt(
  scheduledEnd: string | null | undefined,
  expectedProvider: ExpectedProvider,
): string | null {
  const end = iso(scheduledEnd);
  if (!end) return null;
  if (expectedProvider === 'none' || expectedProvider === 'unknown') return null;
  return new Date(new Date(end).getTime() + TRANSCRIPT_GRACE_MINUTES * 60000).toISOString();
}

export interface CoverageEvaluationInput {
  expectedProvider: ExpectedProvider;
  appointmentState: AppointmentState;
  inviteState?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  transcriptChars?: number | null;
  meetingRecordId?: string | null;
  phoneCallRecordId?: string | null;
  callRecordId?: string | null;
  /** Authoritative CRM disposition for the dialed call, when one exists. */
  callDisposition?: CallDisposition | null;
  now?: Date;
}


export interface CoverageEvaluation {
  coverage_state: CoverageState;
  outcome: CoverageOutcome;
  exception_code: string | null;
  exception_message: string | null;
  overdue_at: string | null;
}

/**
 * Pure state machine. Given what the CRM says and what actually landed, decide
 * the coverage state. Fails LOUD (exception) rather than silently pending.
 */
export function evaluateCoverage(input: CoverageEvaluationInput): CoverageEvaluation {
  const now = input.now || new Date();
  const overdueAt = computeOverdueAt(input.scheduledEnd, input.expectedProvider);
  const hasTranscript =
    (input.transcriptChars || 0) >= MIN_TRANSCRIPT_CHARS &&
    !!(input.meetingRecordId || input.phoneCallRecordId || input.callRecordId);

  if (hasTranscript) {
    return {
      coverage_state: 'transcript_complete',
      outcome: 'transcript_complete',
      exception_code: null,
      exception_message: null,
      overdue_at: overdueAt,
    };
  }

  if (input.appointmentState === 'cancelled') {
    return {
      coverage_state: 'not_required',
      outcome: 'cancelled',
      exception_code: null,
      exception_message: null,
      overdue_at: null,
    };
  }

  if (input.expectedProvider === 'none') {
    return {
      coverage_state: 'not_required',
      outcome: 'not_required',
      exception_code: null,
      exception_message: null,
      overdue_at: null,
    };
  }

  // Completed non-transcript outcome: the CRM proves the dial never connected.
  // This closes the row without an exception and without fabricating text.
  if (input.callDisposition?.noAnswer) {
    return {
      coverage_state: 'no_answer',
      outcome: 'no_answer',
      exception_code: null,
      exception_message: null,
      overdue_at: overdueAt,
    };
  }



  const start = iso(input.scheduledStart);
  const overdue = !!overdueAt && new Date(overdueAt).getTime() < now.getTime();

  if (overdue) {
    if (input.appointmentState === 'noshow') {
      return {
        coverage_state: 'not_required',
        outcome: 'not_required',
        exception_code: null,
        exception_message: null,
        overdue_at: overdueAt,
      };
    }
    const code =
      input.expectedProvider === 'ghl_phone'
        ? 'phone_transcript_missing'
        : input.inviteState === 'invited'
          ? 'notetaker_never_joined'
          : 'invite_never_sent';
    const message =
      code === 'phone_transcript_missing'
        ? 'Phone appointment ended with no transcribed call record in the CRM.'
        : code === 'notetaker_never_joined'
          ? 'Shadow invite was delivered but no recording/transcript came back — the notetaker was likely not admitted.'
          : 'No shadow invite was ever sent for this video booking, so nothing could be captured.';
    return {
      coverage_state: 'exception',
      outcome: 'no_transcript',
      exception_code: code,
      exception_message: message,
      overdue_at: overdueAt,
    };
  }

  // Not overdue yet.
  if (input.expectedProvider === 'meetgeek') {
    const inviteDue =
      !!start && new Date(start).getTime() - INVITE_LEAD_MINUTES * 60000 < now.getTime();
    if (input.inviteState === 'invited') {
      return {
        coverage_state: 'awaiting_transcript',
        outcome: 'pending',
        exception_code: null,
        exception_message: null,
        overdue_at: overdueAt,
      };
    }
    if (inviteDue) {
      return {
        coverage_state: 'exception',
        outcome: 'pending',
        exception_code: 'invite_not_delivered',
        exception_message:
          'The booking starts imminently and the shadow invite has not been delivered yet.',
        overdue_at: overdueAt,
      };
    }
    return {
      coverage_state: 'pending',
      outcome: 'pending',
      exception_code: null,
      exception_message: null,
      overdue_at: overdueAt,
    };
  }

  return {
    coverage_state: 'awaiting_transcript',
    outcome: 'pending',
    exception_code: null,
    exception_message: null,
    overdue_at: overdueAt,
  };
}

export interface CoverageUpsertInput {
  clientId: string;
  ghlAppointmentId: string;
  ghlCalendarId?: string | null;
  ghlCalendarName?: string | null;
  ghlLocationId?: string | null;
  ghlContactId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  scheduleSignature?: string | null;
  meetingUrl?: string | null;
  rawStatus?: string | null;
  cancelled?: boolean;
  inviteJobId?: string | null;
  inviteState?: string | null;
  now?: Date;
}

/** Deterministic, idempotent row body for one appointment. */
export function buildCoverageRow(input: CoverageUpsertInput) {
  const now = input.now || new Date();
  const appointmentState = classifyAppointmentState({
    rawStatus: input.rawStatus,
    cancelled: input.cancelled,
    scheduledEnd: input.scheduledEnd,
    now,
  });
  const expectedProvider = classifyExpectedProvider({
    meetingUrl: input.meetingUrl,
    contactPhone: input.contactPhone,
    appointmentState,
  });
  const evaluation = evaluateCoverage({
    expectedProvider,
    appointmentState,
    inviteState: input.inviteState,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    now,
  });
  return {
    client_id: input.clientId,
    ghl_appointment_id: input.ghlAppointmentId,
    ghl_calendar_id: clean(input.ghlCalendarId),
    ghl_calendar_name: clean(input.ghlCalendarName),
    ghl_location_id: clean(input.ghlLocationId),
    ghl_contact_id: clean(input.ghlContactId),
    contact_name: clean(input.contactName),
    contact_email: clean(input.contactEmail),
    contact_phone: clean(input.contactPhone),
    assigned_user_id: clean(input.assignedUserId),
    assigned_user_name: clean(input.assignedUserName),
    scheduled_start: iso(input.scheduledStart),
    scheduled_end: iso(input.scheduledEnd),
    schedule_signature: clean(input.scheduleSignature),
    meeting_url: clean(input.meetingUrl),
    expected_provider: expectedProvider,
    appointment_state: appointmentState,
    invite_job_id: input.inviteJobId || null,
    invite_state: clean(input.inviteState),
    coverage_state: evaluation.coverage_state,
    outcome: evaluation.outcome,
    exception_code: evaluation.exception_code,
    exception_message: evaluation.exception_message,
    overdue_at: evaluation.overdue_at,
    last_checked_at: now.toISOString(),
  };
}

/**
 * Upsert one appointment's coverage row. Idempotent on (client, appointment):
 * re-running the poller never creates a duplicate and never regresses a row
 * that already proved a transcript.
 */
export async function recordCoverage(supabase: any, input: CoverageUpsertInput) {
  const row = buildCoverageRow(input);
  const { data: existing } = await supabase
    .from('notetaker_coverage')
    .select('id, coverage_state, transcript_chars, meeting_record_id, phone_call_record_id')
    .eq('client_id', input.clientId)
    .eq('ghl_appointment_id', input.ghlAppointmentId)
    .maybeSingle();

  // Never downgrade a proven capture.
  if (existing?.coverage_state === 'transcript_complete') {
    const { coverage_state: _s, outcome: _o, exception_code: _c, exception_message: _m, ...rest } = row;
    await supabase.from('notetaker_coverage').update(rest).eq('id', existing.id);
    return { id: existing.id as string, created: false };
  }

  const { data, error } = await supabase
    .from('notetaker_coverage')
    .upsert(row, { onConflict: 'client_id,ghl_appointment_id' })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { id: (data?.id as string) || (existing?.id as string) || '', created: !existing };
}

export interface CoverageSummary {
  total: number;
  transcript_complete: number;
  awaiting: number;
  pending: number;
  no_answer: number;
  not_required: number;
  exceptions: number;
  by_exception: Record<string, number>;
  by_provider: Record<string, number>;
  by_no_answer_reason: Record<string, number>;
  capture_rate: number | null;
}

/**
 * Rollup for the operator UI. `capture_rate` scores only rows where capture was
 * genuinely expected and possible: not-required rows and completed no-answer
 * dials are excluded from both numerator and denominator.
 */
export function summarizeCoverage(rows: any[]): CoverageSummary {
  const summary: CoverageSummary = {
    total: rows.length,
    transcript_complete: 0,
    awaiting: 0,
    pending: 0,
    no_answer: 0,
    not_required: 0,
    exceptions: 0,
    by_exception: {},
    by_provider: {},
    by_no_answer_reason: {},
    capture_rate: null,
  };
  for (const r of rows) {
    const provider = String(r?.expected_provider || 'unknown');
    summary.by_provider[provider] = (summary.by_provider[provider] || 0) + 1;
    switch (String(r?.coverage_state)) {
      case 'transcript_complete':
        summary.transcript_complete += 1;
        break;
      case 'awaiting_transcript':
      case 'invited':
        summary.awaiting += 1;
        break;
      case 'pending':
        summary.pending += 1;
        break;
      case 'no_answer': {
        summary.no_answer += 1;
        const reason = String(r?.no_answer_reason || 'no_answer');
        summary.by_no_answer_reason[reason] = (summary.by_no_answer_reason[reason] || 0) + 1;
        break;
      }
      case 'not_required':
        summary.not_required += 1;
        break;
      case 'exception':
        summary.exceptions += 1;
        if (r?.exception_code) {
          const code = String(r.exception_code);
          summary.by_exception[code] = (summary.by_exception[code] || 0) + 1;
        }
        break;
    }
  }
  const scored = summary.transcript_complete + summary.exceptions;
  summary.capture_rate = scored ? Math.round((summary.transcript_complete / scored) * 1000) / 10 : null;
  return summary;
}


/**
 * Watchdog: re-evaluate open coverage rows against the authoritative capture
 * tables (meeting records for video, phone call records for dialer calls) and
 * mark overdue rows as exceptions. Idempotent — safe to run every 10 minutes.
 */
export async function reconcileCoverage(args: {
  supabase: any;
  clientId?: string | null;
  lookbackDays?: number;
  limit?: number;
  now?: Date;
}): Promise<{
  scanned: number;
  updated: number;
  completed: number;
  exceptions: number;
  errors: string[];
}> {
  const { supabase } = args;
  const now = args.now || new Date();
  const lookbackDays = args.lookbackDays && args.lookbackDays > 0 ? args.lookbackDays : 30;
  const limit = Math.min(Math.max(args.limit || 1000, 1), 5000);
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const out = { scanned: 0, updated: 0, completed: 0, exceptions: 0, errors: [] as string[] };

  let q = supabase
    .from('notetaker_coverage')
    .select('*')
    .neq('coverage_state', 'transcript_complete')
    .gte('scheduled_start', since)
    .order('scheduled_start', { ascending: true })
    .limit(limit);
  if (args.clientId) q = q.eq('client_id', args.clientId);
  const { data: rows, error } = await q;
  if (error) {
    out.errors.push(error.message);
    return out;
  }
  const open = rows || [];
  out.scanned = open.length;
  if (!open.length) return out;

  const appointmentIds = Array.from(new Set(open.map((r: any) => String(r.ghl_appointment_id))));
  const jobIds = Array.from(new Set(open.map((r: any) => r.invite_job_id).filter(Boolean)));

  const chunk = <T,>(list: T[], size = 200) => {
    const parts: T[][] = [];
    for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
    return parts;
  };

  // Authoritative video capture: meeting_records keyed by CRM appointment id.
  const meetingByAppointment = new Map<string, any>();
  for (const part of chunk(appointmentIds)) {
    const { data } = await supabase
      .from('meeting_records')
      .select('id, client_id, ghl_appointment_id, transcript_text, summary, started_at')
      .in('ghl_appointment_id', part);
    for (const m of data || []) {
      if (m?.ghl_appointment_id) meetingByAppointment.set(`${m.client_id}:${m.ghl_appointment_id}`, m);
    }
  }

  // Authoritative phone capture #1: phone_call_records keyed by appointment id.
  const phoneByAppointment = new Map<string, any>();
  for (const part of chunk(appointmentIds)) {
    const { data } = await supabase
      .from('phone_call_records')
      .select(
        'id, client_id, appointment_id, transcript, connected, answered, call_status, outcome, started_at, contact_phone, contact_email, contact_id',
      )
      .in('appointment_id', part);
    for (const p of data || []) {
      if (!p?.appointment_id) continue;
      const key = `${p.client_id}:${p.appointment_id}`;
      const prev = phoneByAppointment.get(key);
      const len = String(p.transcript || '').length;
      if (!prev || len > String(prev.transcript || '').length) phoneByAppointment.set(key, p);
    }
  }

  // Authoritative phone capture #2: public.calls, which is where the existing
  // GHL post-call worker writes transcripts. Reading it is what clears the
  // false `phone_transcript_missing` exceptions.
  const callByAppointment = new Map<string, any>();
  for (const part of chunk(appointmentIds)) {
    const { data } = await supabase
      .from('calls')
      .select(
        'id, client_id, ghl_appointment_id, transcript, outcome, appointment_status, call_connected, call_duration_seconds, scheduled_at, contact_phone, contact_email',
      )
      .in('ghl_appointment_id', part);
    for (const c of data || []) {
      if (!c?.ghl_appointment_id) continue;
      const key = `${c.client_id}:${c.ghl_appointment_id}`;
      const prev = callByAppointment.get(key);
      const len = String(c.transcript || '').length;
      if (!prev || len > String(prev.transcript || '').length) callByAppointment.set(key, c);
    }
  }

  // Latest invite state per job (shadow invite pipeline is the source of truth).
  const jobById = new Map<string, any>();
  for (const part of chunk(jobIds as string[])) {
    const { data } = await supabase
      .from('meetgeek_guest_invite_jobs')
      .select('id, status, meeting_record_id, attendance_status, ghl_appointment_status, error_code')
      .in('id', part);
    for (const j of data || []) jobById.set(String(j.id), j);
  }

  let fallbackLookups = 0;
  const FALLBACK_BUDGET = 300;

  for (const row of open) {
    const key = `${row.client_id}:${row.ghl_appointment_id}`;
    const job = row.invite_job_id ? jobById.get(String(row.invite_job_id)) : null;
    const meeting = meetingByAppointment.get(key);
    const phone = phoneByAppointment.get(key);
    let call = callByAppointment.get(key);

    // Bounded same-client contact/time fallback, used ONLY when the exact
    // appointment id matched nothing. Never crosses tenants and never widens
    // beyond CONTACT_MATCH_WINDOW_MINUTES around the booking.
    let usedFallback = false;
    if (!meeting && !phone && !call && fallbackLookups < FALLBACK_BUDGET && row.scheduled_start) {
      const contactKey = clean(row.contact_phone) || clean(row.contact_email);
      if (contactKey) {
        fallbackLookups += 1;
        const from = new Date(
          new Date(row.scheduled_start).getTime() - CONTACT_MATCH_WINDOW_MINUTES * 60000,
        ).toISOString();
        const to = new Date(
          new Date(row.scheduled_end || row.scheduled_start).getTime() + CONTACT_MATCH_WINDOW_MINUTES * 60000,
        ).toISOString();
        const column = clean(row.contact_phone) ? 'contact_phone' : 'contact_email';
        const { data: near } = await supabase
          .from('calls')
          .select('id, client_id, transcript, outcome, appointment_status, call_connected, scheduled_at')
          .eq('client_id', row.client_id)
          .eq(column, contactKey)
          .gte('scheduled_at', from)
          .lte('scheduled_at', to)
          .limit(5);
        const best = (near || [])
          .slice()
          .sort((a: any, b: any) => String(b.transcript || '').length - String(a.transcript || '').length)[0];
        if (best) {
          call = best;
          usedFallback = true;
        }
      }
    }

    const meetingChars = String(meeting?.transcript_text || '').length;
    const phoneChars = String(phone?.transcript || '').length;
    const callChars = String(call?.transcript || '').length;
    const transcriptChars = Math.max(meetingChars, phoneChars, callChars);

    // Which source actually proved the capture (transcript bodies are NEVER
    // copied into the coverage ledger — only the length and the linkage).
    const transcriptSource: TranscriptSource | null =
      meetingChars >= MIN_TRANSCRIPT_CHARS
        ? 'meetgeek'
        : phoneChars >= MIN_TRANSCRIPT_CHARS
          ? 'ghl_phone'
          : callChars >= MIN_TRANSCRIPT_CHARS
            ? 'ghl_calls'
            : null;

    const matchMethod: CoverageMatchMethod | null = meeting
      ? 'ghl_appointment_id'
      : phone
        ? 'phone_appointment_id'
        : call
          ? usedFallback
            ? 'contact_time_window'
            : 'calls_appointment_id'
          : null;

    const appointmentState = classifyAppointmentState({
      rawStatus: job?.ghl_appointment_status || call?.appointment_status || row.appointment_state,
      cancelled: row.appointment_state === 'cancelled' || job?.status === 'cancelled',
      scheduledEnd: row.scheduled_end,
      now,
    });
    const expectedProvider = (row.expected_provider === 'unknown'
      ? classifyExpectedProvider({
          meetingUrl: row.meeting_url,
          contactPhone: row.contact_phone,
          appointmentState,
        })
      : row.expected_provider) as ExpectedProvider;

    // Authoritative CRM disposition, only when a dialed record exists.
    const disposition =
      phone || call
        ? classifyCallDisposition({
            connected: phone ? phone.connected : call?.call_connected,
            answered: phone ? phone.answered : null,
            callStatus: phone?.call_status ?? null,
            outcome: phone?.outcome ?? call?.outcome ?? null,
            transcriptChars,
          })
        : null;

    const evaluation = evaluateCoverage({
      expectedProvider,
      appointmentState,
      inviteState: job?.status || row.invite_state,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      transcriptChars,
      meetingRecordId: meetingChars >= MIN_TRANSCRIPT_CHARS ? meeting?.id : null,
      phoneCallRecordId: phoneChars >= MIN_TRANSCRIPT_CHARS ? phone?.id : null,
      callRecordId: callChars >= MIN_TRANSCRIPT_CHARS ? call?.id : null,
      callDisposition: disposition,
      now,
    });

    const patch: Record<string, unknown> = {
      appointment_state: appointmentState,
      expected_provider: expectedProvider,
      invite_state: job?.status || row.invite_state || null,
      meeting_record_id: meeting?.id || job?.meeting_record_id || row.meeting_record_id || null,
      phone_call_record_id: phone?.id || row.phone_call_record_id || null,
      call_record_id: call?.id || row.call_record_id || null,
      transcript_source: transcriptSource || row.transcript_source || null,
      transcript_chars: transcriptChars,
      transcript_complete_at:
        evaluation.coverage_state === 'transcript_complete'
          ? row.transcript_complete_at || now.toISOString()
          : row.transcript_complete_at,
      match_method: matchMethod || row.match_method || null,
      no_answer_reason: evaluation.coverage_state === 'no_answer' ? disposition?.reason || 'no_answer' : null,
      coverage_state: evaluation.coverage_state,
      outcome: evaluation.outcome,
      exception_code: evaluation.exception_code,
      exception_message: evaluation.exception_message,
      overdue_at: evaluation.overdue_at,
      last_checked_at: now.toISOString(),
      reconcile_count: (row.reconcile_count || 0) + 1,
    };

    const { error: upErr } = await supabase.from('notetaker_coverage').update(patch).eq('id', row.id);
    if (upErr) {
      out.errors.push(`${row.id}: ${upErr.message}`.slice(0, 160));
      continue;
    }
    out.updated += 1;
    if (evaluation.coverage_state === 'transcript_complete') out.completed += 1;
    if (evaluation.coverage_state === 'no_answer') out.no_answer += 1;
    if (evaluation.coverage_state === 'exception') out.exceptions += 1;
  }

  return out;
}

