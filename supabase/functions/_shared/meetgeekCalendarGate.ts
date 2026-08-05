// Shared, dependency-injected calendar gating + call-activity lifecycle for the
// MeetGeek bridge. Pure decision logic lives here so it is unit-testable outside
// the Deno runtime. NOTHING in here trusts caller-supplied tenant identifiers:
// every client/location value must come from the server-side config row.

import { normalizeEmail, type NormalizedMeeting } from './meetgeekIngest.ts';

export type BotJoinPolicy = 'never' | 'selected_calendar_video_only' | 'all_video_on_calendar';

export interface MeetgeekClientConfig {
  clientId: string;
  enabled: boolean;
  /** Server-derived from the client's mapped HighLevel location. */
  ghlLocationId: string | null;
  /** The single calendar MeetGeek is allowed to operate on. */
  ghlCalendarId: string | null;
  ghlCalendarName?: string | null;
  botJoinPolicy: BotJoinPolicy;
  mappingValid: boolean;
  webhookSecretConfigured?: boolean;
}

export interface CalendarAppointment {
  eventId: string;
  calendarId: string | null;
  locationId: string | null;
  contactId: string | null;
  attendeeEmail: string | null;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  /** True when the appointment carries a video conferencing link. */
  isVideo: boolean;
}

export type GateRejection =
  | 'not_configured'
  | 'integration_disabled'
  | 'mapping_invalid'
  | 'no_calendar_selected'
  | 'calendar_not_selected'
  | 'cross_client_location'
  | 'ambiguous_appointment'
  | 'appointment_not_found'
  | 'not_video_meeting'
  | 'bot_join_disabled';

export type GateDecision =
  | { allowed: true; appointment: CalendarAppointment; botShouldJoin: boolean }
  | { allowed: false; reason: GateRejection };

export const GATE_REJECTION_MESSAGES: Record<GateRejection, string> = {
  not_configured: 'MeetGeek is not configured for this client.',
  integration_disabled: 'MeetGeek is turned off for this client.',
  mapping_invalid: 'The HighLevel location mapping for this client is invalid — re-validate it in Settings.',
  no_calendar_selected: 'No HighLevel calendar has been selected for this client.',
  calendar_not_selected: 'The booking is not on the calendar selected for this client.',
  cross_client_location: 'The booking belongs to a different HighLevel location than this client.',
  ambiguous_appointment: 'More than one calendar booking matched this meeting — refusing to guess.',
  appointment_not_found: 'No booking on the selected calendar matched this meeting.',
  not_video_meeting: 'The booking has no video conferencing link.',
  bot_join_disabled: 'The bot-join policy for this client is set to never join.',
};

/**
 * Decides whether a MeetGeek meeting may be ingested for a client, based ONLY on
 * the server-side config and the appointments read back from that client's mapped
 * location. Rejects unconfigured, disabled, wrong-calendar, cross-client and
 * ambiguous cases.
 */
export function evaluateCalendarGate(args: {
  config: MeetgeekClientConfig | null;
  appointments: CalendarAppointment[];
}): GateDecision {
  const { config } = args;
  if (!config) return { allowed: false, reason: 'not_configured' };
  if (!config.enabled) return { allowed: false, reason: 'integration_disabled' };
  if (!config.mappingValid || !config.ghlLocationId) return { allowed: false, reason: 'mapping_invalid' };
  if (!config.ghlCalendarId) return { allowed: false, reason: 'no_calendar_selected' };

  const appointments = args.appointments || [];
  if (appointments.length === 0) return { allowed: false, reason: 'appointment_not_found' };

  // Any appointment whose location differs from the client's mapped location is a
  // cross-tenant leak attempt — reject the whole event, never fall through.
  if (appointments.some((a) => a.locationId && a.locationId !== config.ghlLocationId)) {
    return { allowed: false, reason: 'cross_client_location' };
  }

  const onSelected = appointments.filter((a) => a.calendarId === config.ghlCalendarId);
  if (onSelected.length === 0) return { allowed: false, reason: 'calendar_not_selected' };

  const unique = dedupeByEventId(onSelected);
  if (unique.length > 1) return { allowed: false, reason: 'ambiguous_appointment' };

  const appointment = unique[0];
  if (config.botJoinPolicy === 'never') return { allowed: false, reason: 'bot_join_disabled' };
  if (!appointment.isVideo) return { allowed: false, reason: 'not_video_meeting' };

  return { allowed: true, appointment, botShouldJoin: true };
}

function dedupeByEventId(list: CalendarAppointment[]): CalendarAppointment[] {
  const seen = new Set<string>();
  const out: CalendarAppointment[] = [];
  for (const a of list) {
    if (seen.has(a.eventId)) continue;
    seen.add(a.eventId);
    out.push(a);
  }
  return out;
}

export type ActivityStage = 'booked' | 'bot_joined' | 'completed' | 'unmatched' | 'rejected' | 'error' | 'test';

/** Deterministic idempotency key so replays collapse onto one row per stage. */
export function buildActivityKey(input: {
  clientId: string;
  stage: ActivityStage;
  ghlEventId?: string | null;
  meetgeekMeetingId?: string | null;
  meetgeekEventId?: string | null;
}): string {
  const anchor = input.meetgeekEventId
    || input.meetgeekMeetingId
    || input.ghlEventId
    || 'unknown';
  return `${input.clientId}:${input.stage}:${anchor}`;
}

export interface ActivityRow {
  client_id: string;
  source: string;
  idempotency_key: string;
  ghl_location_id: string | null;
  ghl_calendar_id: string | null;
  ghl_event_id: string | null;
  ghl_contact_id: string | null;
  meetgeek_meeting_id: string | null;
  meetgeek_event_id: string | null;
  lead_id: string | null;
  meeting_record_id: string | null;
  status: ActivityStage;
  title: string | null;
  attendee_email: string | null;
  agent_joined_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_minutes: number | null;
  recording_url: string | null;
  transcript_url: string | null;
  summary: string | null;
  action_items: string[];
  crm_sync_status: 'pending' | 'written' | 'skipped' | 'retrying' | 'error' | 'not_applicable';
  crm_sync_error: string | null;
  crm_attempts: number;
  error_message: string | null;
}

/** Builds the canonical activity row. Client/location come from config only. */
export function buildActivityRow(args: {
  config: MeetgeekClientConfig;
  stage: ActivityStage;
  appointment?: CalendarAppointment | null;
  meeting?: NormalizedMeeting | null;
  leadId?: string | null;
  meetingRecordId?: string | null;
  attendeeEmail?: string | null;
  agentJoinedAt?: string | null;
  crmStatus?: ActivityRow['crm_sync_status'];
  crmError?: string | null;
  crmAttempts?: number;
  errorMessage?: string | null;
  source?: string;
}): ActivityRow {
  const { config, stage, appointment, meeting } = args;
  return {
    client_id: config.clientId,
    source: args.source || 'meetgeek',
    idempotency_key: buildActivityKey({
      clientId: config.clientId,
      stage,
      ghlEventId: appointment?.eventId ?? null,
      meetgeekMeetingId: meeting?.meetingExternalId ?? null,
      meetgeekEventId: meeting?.eventId ?? null,
    }),
    ghl_location_id: config.ghlLocationId,
    ghl_calendar_id: config.ghlCalendarId,
    ghl_event_id: appointment?.eventId ?? null,
    ghl_contact_id: appointment?.contactId ?? null,
    meetgeek_meeting_id: meeting?.meetingExternalId ?? null,
    meetgeek_event_id: meeting?.eventId ?? null,
    lead_id: args.leadId ?? null,
    meeting_record_id: args.meetingRecordId ?? null,
    status: stage,
    title: meeting?.title ?? appointment?.title ?? null,
    attendee_email: normalizeEmail(args.attendeeEmail ?? appointment?.attendeeEmail ?? null),
    agent_joined_at: args.agentJoinedAt ?? null,
    started_at: meeting?.startedAt ?? appointment?.startTime ?? null,
    ended_at: meeting?.endedAt ?? appointment?.endTime ?? null,
    duration_minutes: meeting?.durationMinutes ?? null,
    recording_url: meeting?.recordingUrl ?? null,
    transcript_url: meeting?.transcriptUrl ?? meeting?.sourceUrl ?? null,
    summary: meeting?.summary ?? null,
    action_items: meeting?.actionItems ?? [],
    crm_sync_status: args.crmStatus ?? 'pending',
    crm_sync_error: args.crmError ?? null,
    crm_attempts: args.crmAttempts ?? 0,
    error_message: args.errorMessage ?? null,
  };
}

export const MAX_CRM_ATTEMPTS = 3;

/** Retry policy for the CRM write-back: transient failures retry, refusals don't. */
export function nextCrmState(input: {
  status: 'written' | 'skipped' | 'error';
  attempts: number;
  error?: string | null;
}): { crm_sync_status: ActivityRow['crm_sync_status']; retryable: boolean } {
  if (input.status === 'written') return { crm_sync_status: 'written', retryable: false };
  if (input.status === 'skipped') return { crm_sync_status: 'skipped', retryable: false };
  const attempts = input.attempts + 1;
  if (attempts < MAX_CRM_ATTEMPTS) return { crm_sync_status: 'retrying', retryable: true };
  return { crm_sync_status: 'error', retryable: false };
}

// ---------------------------------------------------------------------------
// Lifecycle orchestration
// ---------------------------------------------------------------------------

export interface LifecycleDeps {
  /** Server-side config lookup. The only source of client/location authority. */
  getConfigForMeeting(meeting: NormalizedMeeting): Promise<MeetgeekClientConfig | null>;
  /** Reads appointments from the client's mapped location + selected calendar. */
  findAppointments(config: MeetgeekClientConfig, meeting: NormalizedMeeting): Promise<CalendarAppointment[]>;
  /** Returns the existing activity row for this idempotency key, if any. */
  findActivity(source: string, idempotencyKey: string): Promise<{ id: string; status: string; crm_sync_status: string; crm_attempts: number } | null>;
  upsertActivity(row: ActivityRow): Promise<{ id: string }>;
  patchActivity(id: string, patch: Record<string, unknown>): Promise<void>;
  matchLead(config: MeetgeekClientConfig, emails: string[]): Promise<{ id: string; external_id: string | null; email: string | null } | null>;
  writeGhlNote(input: { config: MeetgeekClientConfig; contactId: string; note: string }): Promise<{ status: 'written' | 'skipped' | 'error'; error?: string }>;
  touchHealth(clientId: string, patch: Record<string, unknown>): Promise<void>;
}

export interface LifecycleResult {
  ok: boolean;
  status: number;
  activityId?: string;
  duplicate?: boolean;
  rejected?: GateRejection;
  matched?: boolean;
  crmSyncStatus?: string;
  clientId?: string | null;
}

/**
 * Runs a completed MeetGeek meeting through the calendar gate and records the
 * lifecycle as client-scoped call activity — including for unmatched leads.
 */
export async function processCalendarMeeting(args: {
  meeting: NormalizedMeeting;
  noteBuilder: (meeting: NormalizedMeeting, appointment: CalendarAppointment | null) => string;
  deps: LifecycleDeps;
}): Promise<LifecycleResult> {
  const { meeting, deps, noteBuilder } = args;

  const config = await deps.getConfigForMeeting(meeting);
  if (!config) return { ok: false, status: 403, rejected: 'not_configured', clientId: null };

  await deps.touchHealth(config.clientId, { last_event_at: new Date().toISOString() });

  const appointments = await deps.findAppointments(config, meeting);
  const decision = evaluateCalendarGate({ config, appointments });

  if (decision.allowed !== true) {
    const reason: GateRejection = decision.reason;
    const row = buildActivityRow({
      config,
      stage: 'rejected',
      meeting,
      appointment: appointments.find((a) => a.calendarId === config.ghlCalendarId) ?? null,
      crmStatus: 'not_applicable',
      errorMessage: GATE_REJECTION_MESSAGES[reason],
    });
    const existing = await deps.findActivity(row.source, row.idempotency_key);
    if (existing) return { ok: true, status: 200, duplicate: true, rejected: reason, activityId: existing.id, clientId: config.clientId };
    const saved = await deps.upsertActivity(row);
    await deps.touchHealth(config.clientId, {
      last_error: GATE_REJECTION_MESSAGES[reason],
      last_error_at: new Date().toISOString(),
    });
    return { ok: false, status: 403, rejected: reason, activityId: saved.id, clientId: config.clientId };
  }

  const appointment = decision.appointment;
  const emails = meeting.participants
    .map((p) => normalizeEmail(p.email))
    .filter((e): e is string => !!e);
  const appointmentEmail = normalizeEmail(appointment.attendeeEmail);
  if (appointmentEmail && !emails.includes(appointmentEmail)) emails.unshift(appointmentEmail);

  const lead = emails.length ? await deps.matchLead(config, emails) : null;
  const stage: ActivityStage = lead ? 'completed' : 'unmatched';

  const baseRow = buildActivityRow({
    config,
    stage,
    appointment,
    meeting,
    leadId: lead?.id ?? null,
    attendeeEmail: lead?.email ?? appointmentEmail,
    agentJoinedAt: meeting.startedAt,
    crmStatus: 'pending',
  });

  const existing = await deps.findActivity(baseRow.source, baseRow.idempotency_key);
  if (existing && existing.crm_sync_status === 'written') {
    return { ok: true, status: 200, duplicate: true, activityId: existing.id, matched: !!lead, crmSyncStatus: 'written', clientId: config.clientId };
  }

  const saved = await deps.upsertActivity(baseRow);
  const attemptsSoFar = existing?.crm_attempts ?? 0;

  await deps.touchHealth(config.clientId, {
    last_bot_join_at: meeting.startedAt,
    last_completed_meeting_at: meeting.endedAt || new Date().toISOString(),
    last_error: null,
    last_error_at: null,
  });

  // CRM write-back: only via the server-side mapped GHL route, only to the
  // contact already linked to the matched lead.
  let crmStatus: ActivityRow['crm_sync_status'] = 'not_applicable';
  let crmError: string | null = null;
  let attempts = attemptsSoFar;

  const contactId = lead?.external_id || appointment.contactId || null;
  if (lead && contactId) {
    const res = await deps.writeGhlNote({ config, contactId, note: noteBuilder(meeting, appointment) });
    const next = nextCrmState({ status: res.status, attempts: attemptsSoFar, error: res.error });
    crmStatus = next.crm_sync_status;
    crmError = res.error ?? null;
    attempts = res.status === 'written' ? attemptsSoFar : attemptsSoFar + 1;
  } else if (lead) {
    crmStatus = 'skipped';
    crmError = 'no_ghl_contact_id';
  } else {
    crmStatus = 'skipped';
    crmError = 'lead_unmatched';
  }

  await deps.patchActivity(saved.id, {
    ghl_contact_id: contactId,
    crm_sync_status: crmStatus,
    crm_sync_error: crmError,
    crm_attempts: attempts,
    crm_synced_at: crmStatus === 'written' ? new Date().toISOString() : null,
  });

  if (crmStatus === 'written') {
    await deps.touchHealth(config.clientId, { last_crm_sync_at: new Date().toISOString() });
  } else if (crmStatus === 'error' || crmStatus === 'retrying') {
    await deps.touchHealth(config.clientId, {
      last_error: crmError ? `CRM sync: ${crmError}` : 'CRM sync failed',
      last_error_at: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    status: 200,
    activityId: saved.id,
    matched: !!lead,
    crmSyncStatus: crmStatus,
    clientId: config.clientId,
  };
}