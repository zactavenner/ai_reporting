/**
 * Polling-based ingest for the MeetGeek guest-invite pipeline.
 *
 * Why this exists: GHL's API cannot create workflows, so per-location webhook
 * workflows can never be provisioned automatically. This poller is the primary
 * detection path; the signed webhook stays as an optional real-time boost.
 *
 * Two detection sources, both funnelling into the SAME idempotent job rows so a
 * booking seen twice only ever produces one invite:
 *   A. GHL calendar events on each client's mapped booking calendar.
 *   B. The connected organizer Google Calendar (covers non-GHL bookings).
 *
 * Ownership rules from calendarGuest.ts are unchanged: the notetaker is only
 * ever appended as an attendee.
 */
import {
  buildInviteIdempotencyKey,
  evaluateGuestGate,
  resolveEventLink,
  botAlreadyGuest,
  normalizeEmail,
  GUEST_REJECTION_MESSAGES,
  GHL_APPOINTMENT_PROPERTY,
  type GhlAppointmentLite,
  type GuestConfig,
} from './calendarGuest.ts';
import { findEventCandidates, getAccessToken, getEvent, listEvents, patchAttendee } from './googleCalendarClient.ts';
import {
  buildShadowInviteIcs,
  buildShadowInviteUid,
  scheduleSignature,
} from './icsInvite.ts';
import { resolveInviteSender, sendShadowInvite } from './shadowInviteSender.ts';
import {
  buildAttributedSummary,
  listLocationCalendars,
  newAttributionCache,
  resolveAppointmentAttribution,
  type AppointmentAttribution,
  type AttributionCache,
} from './ghlAttribution.ts';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const SHADOW_INVITE_CONCURRENCY = 5;

/**
 * Run async tasks with a bounded concurrency. Returns an array of results
 * in the same order as the input tasks.
 */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}



/**
 * Detection mode.
 *   shadow_email  — DEFAULT. Zero-OAuth: email an .ics invite to the notetaker.
 *   google_guest  — Dormant legacy path: patch the organizer's Google event.
 *                   Kept available, never required.
 */
export type InviteMode = 'shadow_email' | 'google_guest';

const VIDEO_LINK_RE =
  /(https?:\/\/[^\s<>"']*(?:zoom\.us\/j\/|zoom\.us\/my\/|meet\.google\.com\/|teams\.microsoft\.com\/|whereby\.com\/|meet\.jit\.si\/|us\d{2}web\.zoom\.us\/)[^\s<>"']*)/i;

/** Pull the first video meeting link out of any GHL appointment text field. */
export function extractVideoLink(...fields: (string | null | undefined)[]): string | null {
  for (const field of fields) {
    const match = String(field || '').match(VIDEO_LINK_RE);
    if (match) return match[1].replace(/[.,;)]+$/, '');
  }
  return null;
}

export interface PollClientResult {
  client_id: string;
  client_name: string;
  ghl_appointments_found: number;
  jobs_enqueued: number;
  jobs_already_present: number;
  invited: number;
  pending_awaiting_connection: number;
  /** Shadow-invite counters. */
  invites_sent: number;
  invites_updated: number;
  invites_cancelled: number;
  pending_awaiting_sender: number;
  needs_meeting_link: number;
  rejected: number;
  /** Every active booking calendar in the location that was polled. */
  calendars_polled: { id: string; name: string; appointments: number }[];
  errors: string[];
}

export interface PollResult {
  horizon_days: number;
  mode: InviteMode;
  sender: { configured: boolean; provider: string | null; from_email: string | null; detail: string };
  clients: PollClientResult[];
  google_scan: {
    connections: number;
    events_scanned: number;
    events_missing_bot: number;
    invited: number;
    skipped_duplicate: number;
    errors: string[];
  };
  totals: {
    appointments_found: number;
    jobs_enqueued: number;
    invited: number;
    pending: number;
    invites_sent: number;
    invites_updated: number;
    invites_cancelled: number;
  };
}

function toConfig(row: any): GuestConfig {
  return {
    id: row.id,
    clientId: row.client_id,
    enabled: row.enabled,
    ghlLocationId: row.ghl_location_id,
    ghlCalendarId: row.ghl_calendar_id,
    calendarConnectionId: row.calendar_connection_id,
    organizerCalendarId: row.organizer_calendar_id || 'primary',
    botGuestEmail: row.bot_guest_email,
  };
}

export type PolledAppointment = GhlAppointmentLite & {
  cancelled: boolean;
  calendarName?: string | null;
  /** Full CRM attribution captured at detection time. */
  attribution?: AppointmentAttribution;
};

/** Upcoming events on one GHL calendar. Read-only. Cancellations included. */
async function fetchUpcomingGhlAppointments(args: {
  apiKey: string;
  locationId: string;
  calendarId: string;
  calendarName?: string | null;
  horizonDays: number;
  cache?: AttributionCache;
}): Promise<PolledAppointment[]> {
  // A small backward window catches bookings made moments ago for a slot that
  // has technically just started.
  const startTime = Date.now() - 60 * 60 * 1000;
  const endTime = Date.now() + args.horizonDays * 24 * 60 * 60 * 1000;
  const url =
    `${GHL_BASE}/calendars/events?locationId=${encodeURIComponent(args.locationId)}` +
    `&calendarId=${encodeURIComponent(args.calendarId)}&startTime=${startTime}&endTime=${endTime}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${args.apiKey}`, Version: '2021-07-28', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ghl_events_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json().catch(() => null);
  const events: any[] = data?.events || data?.appointments || [];
  const cancelled = /cancel/i;
  const cache = args.cache || newAttributionCache();
  const mapped: PolledAppointment[] = [];
  for (const e of events.filter((ev) => ev?.id)) {
    // Attribution is captured at detection time so a later reschedule or a
    // recorded meeting can always be traced to contact + sales agent.
    const attribution = await resolveAppointmentAttribution({ apiKey: args.apiKey, event: e, cache });
    mapped.push({
      appointmentId: String(e.id),
      calendarId: String(e.calendarId || args.calendarId),
      locationId: String(e.locationId || args.locationId),
      title: e.title ?? null,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
      externalGoogleEventId: e.googleEventId || e.externalId || null,
      meetingUrl:
        extractVideoLink(e.address, e.meetingUrl, e.meetingLocation, e.notes, e.description) ||
        e.meetingUrl ||
        null,
      cancelled: cancelled.test(String(e.appointmentStatus || e.status || '')),
      calendarName: args.calendarName || null,
      attribution,
    });
  }
  return mapped;
}

/**
 * Zero-OAuth shadow invite: email a standard iCalendar REQUEST/CANCEL for the
 * appointment's exact window to the notetaker mailbox. Gmail auto-adds it, so
 * MeetGeek joins without anyone touching the organizer's calendar.
 */
async function runShadowInvite(args: {
  supabase: any;
  config: GuestConfig;
  appointment: PolledAppointment;
  botGuestEmail: string;
  job: any;
  clientName: string | null;
}): Promise<'sent' | 'updated' | 'cancelled' | 'noop' | 'awaiting_sender' | 'needs_meeting_link' | 'error'> {
  const { supabase, config, appointment, botGuestEmail, job, clientName } = args;
  const finish = (patch: Record<string, unknown>) =>
    supabase.from('meetgeek_guest_invite_jobs').update(patch).eq('id', job.id);

  const link = extractVideoLink(appointment.meetingUrl);
  const isCancel = appointment.cancelled;
  const alreadySent = (job.invite_send_count || 0) > 0;

  if (isCancel && !alreadySent) {
    await finish({ status: 'cancelled', error_code: null, error_message: 'Appointment cancelled before any invite was sent.' });
    return 'noop';
  }
  if (!isCancel && !link) {
    await finish({
      status: 'pending',
      error_code: 'no_meeting_link',
      error_message: 'Appointment has no video meeting link yet — will retry on the next poll.',
    });
    return 'needs_meeting_link';
  }
  if (!appointment.startTime || !appointment.endTime) {
    await finish({ status: 'pending', error_code: 'no_time_window', error_message: 'Appointment is missing a start/end time.' });
    return 'needs_meeting_link';
  }

  const signature = scheduleSignature(appointment.startTime, appointment.endTime, link);
  if (!isCancel && alreadySent && job.schedule_signature === signature) {
    // Nothing changed since the last invite — stay idempotent.
    if (job.status !== 'invited') await finish({ status: 'invited' });
    return 'noop';
  }
  if (isCancel && String(job.status) === 'cancelled') return 'noop';

  const uid = job.invite_uid || buildShadowInviteUid({ clientId: config.clientId, appointmentId: appointment.appointmentId });
  const method = isCancel ? 'CANCEL' : 'REQUEST';
  // SEQUENCE must increase on every change so calendars accept the update.
  const sequence = alreadySent ? (job.invite_sequence || 0) + 1 : job.invite_sequence || 0;
  const sender = await resolveInviteSender(supabase);
  if (!sender.configured || !sender.from_email) {
    await finish({
      status: 'pending',
      error_code: 'no_email_sender',
      error_message: sender.detail,
      invite_uid: uid,
      invite_mode: 'shadow_email',
      meeting_url: link,
    });
    return 'awaiting_sender';
  }

  // Structured title so the MeetGeek meeting itself carries attribution.
  const title = buildAttributedSummary({
    clientName,
    calendarName: appointment.calendarName || null,
    contactName: appointment.attribution?.contactName || null,
    fallbackTitle: appointment.title || null,
  });
  const ics = buildShadowInviteIcs({
    uid,
    method,
    sequence,
    start: appointment.startTime,
    end: appointment.endTime,
    summary: isCancel ? `CANCELLED — ${title}` : title,
    description: [
      'Auto-scheduled notetaker coverage (HPA Reporting).',
      appointment.attribution?.contactName ? `Contact: ${appointment.attribution.contactName}` : '',
      appointment.attribution?.assignedUserName ? `Sales agent: ${appointment.attribution.assignedUserName}` : '',
      `Ref: ${uid}`,
    ].filter(Boolean).join('\n'),
    meetingUrl: link,
    organizerEmail: sender.from_email,
    organizerName: 'HPA Reporting',
    attendeeEmail: botGuestEmail,
  });

  const result = await sendShadowInvite({
    supabase,
    to: botGuestEmail,
    subject: `${isCancel ? 'Cancelled' : alreadySent ? 'Updated' : 'Invitation'}: ${title}`,
    bodyText: [
      isCancel ? 'This meeting was cancelled — please drop it from the calendar.' : 'Notetaker coverage for an upcoming client meeting.',
      link ? `Join link: ${link}` : '',
      `Starts: ${new Date(appointment.startTime).toISOString()}`,
    ].filter(Boolean).join('\n\n'),
    ics,
    method,
  });

  if (!result.ok) {
    await finish({
      status: result.configured ? 'error' : 'pending',
      error_code: result.configured ? 'invite_email_failed' : 'no_email_sender',
      error_message: result.error || 'invite email failed',
      invite_uid: uid,
      invite_mode: 'shadow_email',
      meeting_url: link,
    });
    return result.configured ? 'error' : 'awaiting_sender';
  }

  // The mail provider accepted the invite ⇒ the job is done for this state.
  await finish({
    status: isCancel ? 'cancelled' : 'invited',
    invite_mode: 'shadow_email',
    invite_uid: uid,
    invite_sequence: sequence,
    invite_method: method,
    invite_provider: result.provider,
    invite_message_id: result.message_id,
    invite_last_sent_at: new Date().toISOString(),
    invite_summary: title,
    invite_send_count: isCancel ? job.invite_send_count || 0 : (job.invite_send_count || 0) + 1,
    invite_update_count: !isCancel && alreadySent ? (job.invite_update_count || 0) + 1 : job.invite_update_count || 0,
    invite_cancel_count: isCancel ? (job.invite_cancel_count || 0) + 1 : job.invite_cancel_count || 0,
    schedule_signature: signature,
    meeting_url: link,
    completed_at: new Date().toISOString(),
    error_code: null,
    error_message: null,
  });
  await supabase
    .from('client_meetgeek_guest_configs')
    .update({ last_invite_at: new Date().toISOString(), last_error: null })
    .eq('id', config.id);

  if (isCancel) return 'cancelled';
  return alreadySent ? 'updated' : 'sent';
}

/**
 * Adds the notetaker to the organizer event for one appointment and records the
 * outcome on the job row. Never creates events, never touches ownership.
 */
async function runInvite(args: {
  supabase: any;
  config: GuestConfig;
  appointment: GhlAppointmentLite;
  botGuestEmail: string;
  jobId: string;
}): Promise<'invited' | 'needs_event_link' | 'error'> {
  const { supabase, config, appointment, botGuestEmail, jobId } = args;
  const finish = (patch: Record<string, unknown>) =>
    supabase.from('meetgeek_guest_invite_jobs').update(patch).eq('id', jobId);
  try {
    const { token } = await getAccessToken(supabase, config.calendarConnectionId!);
    const calendarId = config.organizerCalendarId;

    let event: any = null;
    if (appointment.externalGoogleEventId) {
      event = await getEvent({ token, calendarId, eventId: appointment.externalGoogleEventId });
    }
    if (!event) {
      const { tagged, windowEvents } = await findEventCandidates({ token, calendarId, appointment });
      const link = resolveEventLink({ taggedEvents: tagged, windowEvents, allowCreate: false });
      if (link.kind === 'needs_event_link' || link.kind === 'create') {
        await finish({
          status: 'needs_event_link',
          error_code: link.kind === 'create' ? 'create_disabled' : 'no_unique_event',
          error_message: 'Could not link the appointment to exactly one organizer event.',
        });
        return 'needs_event_link';
      }
      event = link.event;
    }

    if (botAlreadyGuest(event, botGuestEmail)) {
      await finish({ status: 'invited', google_event_id: event.id, completed_at: new Date().toISOString() });
      return 'invited';
    }

    const updated = await patchAttendee({
      token,
      calendarId,
      event,
      botGuestEmail,
      appointmentId: appointment.appointmentId,
      clientId: config.clientId,
    });
    await finish({
      status: 'invited',
      google_event_id: updated.id || event.id,
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    });
    await supabase
      .from('client_meetgeek_guest_configs')
      .update({ last_invite_at: new Date().toISOString(), last_error: null })
      .eq('id', config.id);
    return 'invited';
  } catch (e) {
    const message = String((e as Error).message || 'invite_failed').slice(0, 300);
    await finish({ status: 'error', error_code: 'invite_failed', error_message: message });
    await supabase
      .from('client_meetgeek_guest_configs')
      .update({ last_error: message, last_error_at: new Date().toISOString() })
      .eq('id', config.id);
    return 'error';
  }
}

const TERMINAL = new Set(['invited', 'rejected']);

/** Source B helper: does this Google event look like a real video meeting? */
function hasVideoLink(event: any): boolean {
  if (event?.hangoutLink) return true;
  const entries = event?.conferenceData?.entryPoints || [];
  if (entries.some((p: any) => p?.entryPointType === 'video' && p?.uri)) return true;
  const haystack = `${event?.location || ''} ${event?.description || ''}`;
  return /(zoom\.us\/j|meet\.google\.com|teams\.microsoft\.com|whereby\.com|meet\.jit\.si)/i.test(haystack);
}

export async function runGuestInvitePolling(args: {
  supabase: any;
  clientId?: string | null;
  horizonDays?: number;
  scanGoogle?: boolean;
  /** Operator-only: poll a single client even while it is still disabled. */
  force?: boolean;
  /** Defaults to the zero-OAuth shadow-invite path. */
  mode?: InviteMode;
}): Promise<PollResult> {
  const { supabase } = args;
  const horizonDays = args.horizonDays ?? 14;
  const mode: InviteMode = args.mode === 'google_guest' ? 'google_guest' : 'shadow_email';
  const sender = await resolveInviteSender(supabase);

  let configQuery = supabase
    .from('client_meetgeek_guest_configs')
    .select('id, client_id, enabled, ghl_location_id, ghl_calendar_id, calendar_connection_id, organizer_calendar_id, bot_guest_email');
  if (args.clientId) configQuery = configQuery.eq('client_id', args.clientId);
  const { data: configRows } = await configQuery;

  const { data: settingsRows } = await supabase
    .from('client_meetgeek_settings')
    .select('client_id, enabled, ghl_calendar_id');
  const settingsByClient = new Map((settingsRows || []).map((r: any) => [r.client_id, r]));

  const ids = (configRows || []).map((r: any) => r.client_id);
  const { data: clientRows } = await supabase
    .from('clients')
    .select('id, name, ghl_api_key, ghl_location_id')
    .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const clientById = new Map((clientRows || []).map((c: any) => [c.id, c]));

  const clients: PollClientResult[] = [];

  for (const row of configRows || []) {
    const settings = settingsByClient.get(row.client_id) as any;
    const client = clientById.get(row.client_id) as any;
    const result: PollClientResult = {
      client_id: row.client_id,
      client_name: client?.name || 'Unknown client',
      ghl_appointments_found: 0,
      jobs_enqueued: 0,
      jobs_already_present: 0,
      invited: 0,
      pending_awaiting_connection: 0,
      invites_sent: 0,
      invites_updated: 0,
      invites_cancelled: 0,
      pending_awaiting_sender: 0,
      needs_meeting_link: 0,
      rejected: 0,
      calendars_polled: [],
      errors: [],
    };

    // Poll only clients the operator has switched on in either surface, unless
    // a single client is force-polled from the admin panel.
    const active = row.enabled || settings?.enabled || (args.force && args.clientId === row.client_id);
    if (!active) continue;

    const mappedCalendarId = row.ghl_calendar_id || settings?.ghl_calendar_id || null;
    const config = toConfig({ ...row, ghl_calendar_id: mappedCalendarId, enabled: true });
    if (!client?.ghl_api_key || !client?.ghl_location_id) {
      result.errors.push('missing CRM credentials (GHL location id + API key)');
      clients.push(result);
      continue;
    }

    // ALL active booking calendars in the location are covered, not just the
    // mapped primary. The mapped calendar is always included as a fallback so a
    // failed calendar listing never silently drops coverage.
    const locationCalendars = await listLocationCalendars(client.ghl_api_key, client.ghl_location_id);
    const targets = locationCalendars.filter((c) => c.isActive);
    if (mappedCalendarId && !targets.some((c) => c.id === mappedCalendarId)) {
      targets.push({ id: mappedCalendarId, name: 'Mapped calendar', isActive: true });
    }
    if (!targets.length) {
      result.errors.push('no active booking calendars found in the CRM location');
      clients.push(result);
      continue;
    }
    // Keep the settings row in sync so the UI can show what is covered.
    await supabase
      .from('client_meetgeek_settings')
      .update({ booking_calendars: targets as any })
      .eq('client_id', config.clientId);

    const cache = newAttributionCache();
    let appointments: PolledAppointment[] = [];
    for (const cal of targets) {
      try {
        const batch = await fetchUpcomingGhlAppointments({
          apiKey: client.ghl_api_key,
          locationId: client.ghl_location_id,
          calendarId: cal.id,
          calendarName: cal.name,
          horizonDays,
          cache,
        });
        result.calendars_polled.push({ id: cal.id, name: cal.name, appointments: batch.length });
        appointments = appointments.concat(batch);
      } catch (e) {
        result.errors.push(`${cal.name}: ${String((e as Error).message).slice(0, 160)}`);
      }
    }
    result.ghl_appointments_found = appointments.length;

    const botEmail = normalizeEmail(config.botGuestEmail);
    const shadowTasks: (() => Promise<void>)[] = [];
    for (const appointment of appointments) {
      // Every active calendar in the location is in scope, and each was already
      // validated as belonging to this client's location, so the gate is run
      // against the appointment's own calendar rather than a single primary.
      const gate = evaluateGuestGate({
        config: {
          ...config,
          ghlCalendarId: appointment.calendarId || config.ghlCalendarId,
          calendarConnectionId: config.calendarConnectionId || 'pending',
        },
        appointment,
      });
      const idempotencyKey = buildInviteIdempotencyKey({
        clientId: config.clientId,
        appointmentId: appointment.appointmentId,
        botGuestEmail: botEmail || 'none',
      });

      const { data: existing } = await supabase
        .from('meetgeek_guest_invite_jobs')
        .select(
          'id, status, attempts, invite_uid, invite_sequence, invite_send_count, invite_update_count, invite_cancel_count, schedule_signature',
        )
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      // Dedupe across webhook + poller. In shadow mode an already-invited job is
      // still revisited so reschedules and cancellations stay in sync; only the
      // signature check decides whether anything is actually re-sent.
      const revisit =
        mode === 'shadow_email' &&
        (appointment.cancelled ||
          scheduleSignature(appointment.startTime, appointment.endTime, extractVideoLink(appointment.meetingUrl)) !==
            (existing?.schedule_signature || ''));
      if (existing && TERMINAL.has(String(existing.status)) && !revisit) {
        result.jobs_already_present += 1;
        continue;
      }
      if (existing && String(existing.status) === 'cancelled' && appointment.cancelled) {
        result.jobs_already_present += 1;
        continue;
      }

      if (!gate.allowed) {
        await supabase.from('meetgeek_guest_invite_jobs').upsert(
          {
            idempotency_key: idempotencyKey,
            client_id: config.clientId,
            guest_config_id: config.id,
            ghl_appointment_id: appointment.appointmentId,
            ghl_calendar_id: appointment.calendarId,
            ghl_calendar_name: appointment.calendarName || null,
            ghl_location_id: config.ghlLocationId,
            bot_guest_email: config.botGuestEmail,
            status: 'rejected',
            rejection_reason: gate.reason,
            error_message: GUEST_REJECTION_MESSAGES[gate.reason],
          },
          { onConflict: 'idempotency_key' },
        );
        result.rejected += 1;
        continue;
      }

      const shadow = mode === 'shadow_email';
      const hasConnection = !shadow && !!row.calendar_connection_id;
      const { data: job } = await supabase
        .from('meetgeek_guest_invite_jobs')
        .upsert(
          {
            idempotency_key: idempotencyKey,
            client_id: config.clientId,
            guest_config_id: config.id,
            ghl_appointment_id: appointment.appointmentId,
            ghl_calendar_id: appointment.calendarId,
            ghl_calendar_name: appointment.calendarName || null,
            ghl_location_id: config.ghlLocationId,
            // Attribution: contact + assigned sales agent, captured on every
            // upsert so reschedules keep (never duplicate) the attribution.
            ghl_contact_id: appointment.attribution?.contactId || null,
            contact_name: appointment.attribution?.contactName || null,
            contact_email: appointment.attribution?.contactEmail || null,
            contact_phone: appointment.attribution?.contactPhone || null,
            assigned_user_id: appointment.attribution?.assignedUserId || null,
            assigned_user_name: appointment.attribution?.assignedUserName || null,
            assigned_user_email: appointment.attribution?.assignedUserEmail || null,
            google_calendar_id: hasConnection ? config.organizerCalendarId : null,
            bot_guest_email: gate.botGuestEmail,
            invite_mode: shadow ? 'shadow_email' : 'google_guest',
            // Shadow mode always processes immediately; the legacy Google path
            // parks as `pending` until a connection exists.
            status: shadow || hasConnection ? 'processing' : 'pending',
            attempts: shadow || hasConnection ? (existing?.attempts || 0) + 1 : existing?.attempts || 0,
            scheduled_start: appointment.startTime,
            scheduled_end: appointment.endTime,
            meeting_url: extractVideoLink(appointment.meetingUrl),
            rejection_reason: null,
            error_message: shadow || hasConnection ? null : 'Waiting for the organizer Google Calendar connection.',
          },
          { onConflict: 'idempotency_key' },
        )
        .select(
          'id, status, invite_uid, invite_sequence, invite_send_count, invite_update_count, invite_cancel_count, schedule_signature',
        )
        .maybeSingle();

      if (!existing) result.jobs_enqueued += 1;
      else result.jobs_already_present += 1;

      if (!job?.id) continue;

      if (shadow) {
        // Queue the send for concurrent execution; the actual SMTP handshakes are
        // the bottleneck, so this keeps the overall runtime under the edge-fn
        // timeout while still capping parallel connections below.
        shadowTasks.push(() =>
          runShadowInvite({
            supabase,
            config,
            appointment,
            botGuestEmail: gate.botGuestEmail,
            job: { ...(existing || {}), ...job },
            clientName: client?.name || null,
          }).then((outcome) => {
            if (outcome === 'sent') {
              result.invites_sent += 1;
              result.invited += 1;
            } else if (outcome === 'updated') {
              result.invites_updated += 1;
              result.invited += 1;
            } else if (outcome === 'cancelled') result.invites_cancelled += 1;
            else if (outcome === 'awaiting_sender') result.pending_awaiting_sender += 1;
            else if (outcome === 'needs_meeting_link') result.needs_meeting_link += 1;
            else if (outcome === 'error') result.errors.push(`${appointment.appointmentId}: invite email failed`);
          })
        );
        continue;
      }

      if (!hasConnection) {
        result.pending_awaiting_connection += 1;
        continue;
      }
      const outcome = await runInvite({
        supabase,
        config,
        appointment,
        botGuestEmail: gate.botGuestEmail,
        jobId: job.id,
      });
      if (outcome === 'invited') result.invited += 1;
      else result.errors.push(`${appointment.appointmentId}: ${outcome}`);
    }

    // Run shadow sends concurrently with a bounded concurrency limit to keep the
    // SMTP handshake time reasonable and avoid exhausting connection pools.
    if (shadowTasks.length > 0) {
      await runWithConcurrency(shadowTasks, 10);
    }

    await supabase
      .from('client_meetgeek_settings')
      .update({ last_crm_sync_at: new Date().toISOString() })
      .eq('client_id', config.clientId);

    clients.push(result);
  }

  // ---- Source B: scan the connected organizer calendar directly ----
  const google = {
    connections: 0,
    events_scanned: 0,
    events_missing_bot: 0,
    invited: 0,
    skipped_duplicate: 0,
    errors: [] as string[],
  };

  // Dormant legacy path: only runs when explicitly requested in google mode.
  if (mode === 'google_guest' && args.scanGoogle !== false) {
    const byConnection = new Map<string, any[]>();
    for (const row of configRows || []) {
      if (!row.calendar_connection_id) continue;
      if (!(row.enabled || (settingsByClient.get(row.client_id) as any)?.enabled)) continue;
      const key = `${row.calendar_connection_id}|${row.organizer_calendar_id || 'primary'}`;
      const list = byConnection.get(key) || [];
      list.push(row);
      byConnection.set(key, list);
    }
    google.connections = byConnection.size;

    for (const [key, rows] of byConnection) {
      const [connectionId, organizerCalendarId] = key.split('|');
      // A connection shared by several clients cannot be attributed safely, so
      // only tagged events (which carry hpaClientId) are handled there.
      const soleConfig = rows.length === 1 ? toConfig(rows[0]) : null;
      try {
        const { token } = await getAccessToken(supabase, connectionId);
        const events = (await listEvents(token, organizerCalendarId, {
          timeMin: new Date().toISOString(),
          timeMax: new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000).toISOString(),
          singleEvents: 'true',
          showDeleted: 'false',
          maxResults: '250',
          orderBy: 'startTime',
        })) as any[];
        google.events_scanned += events.length;

        for (const event of events) {
          if (event?.status === 'cancelled' || !hasVideoLink(event)) continue;
          const taggedAppointmentId = event?.extendedProperties?.private?.[GHL_APPOINTMENT_PROPERTY] || null;
          const config = soleConfig;
          if (!config) continue;
          const botEmail = normalizeEmail(config.botGuestEmail);
          if (!botEmail) continue;
          if (botAlreadyGuest(event, botEmail)) continue;
          google.events_missing_bot += 1;

          // Same dedupe key space as the GHL path: a GHL-tagged event reuses the
          // appointment id, everything else gets a stable calendar-derived id.
          const appointmentId = taggedAppointmentId || `gcal:${event.id}`;
          const idempotencyKey = buildInviteIdempotencyKey({
            clientId: config.clientId,
            appointmentId,
            botGuestEmail: botEmail,
          });
          const { data: existing } = await supabase
            .from('meetgeek_guest_invite_jobs')
            .select('id, status, attempts')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();
          if (existing && TERMINAL.has(String(existing.status))) {
            google.skipped_duplicate += 1;
            continue;
          }

          const { data: job } = await supabase
            .from('meetgeek_guest_invite_jobs')
            .upsert(
              {
                idempotency_key: idempotencyKey,
                client_id: config.clientId,
                guest_config_id: config.id,
                ghl_appointment_id: appointmentId,
                ghl_calendar_id: config.ghlCalendarId,
                ghl_location_id: config.ghlLocationId,
                google_calendar_id: organizerCalendarId,
                google_event_id: event.id,
                bot_guest_email: botEmail,
                status: 'processing',
                attempts: (existing?.attempts || 0) + 1,
                scheduled_start: event?.start?.dateTime || null,
                scheduled_end: event?.end?.dateTime || null,
                rejection_reason: null,
                error_message: null,
              },
              { onConflict: 'idempotency_key' },
            )
            .select('id')
            .maybeSingle();

          try {
            const updated = await patchAttendee({
              token,
              calendarId: organizerCalendarId,
              event,
              botGuestEmail: botEmail,
              appointmentId,
              clientId: config.clientId,
            });
            if (job?.id) {
              await supabase
                .from('meetgeek_guest_invite_jobs')
                .update({
                  status: 'invited',
                  google_event_id: updated.id || event.id,
                  completed_at: new Date().toISOString(),
                })
                .eq('id', job.id);
            }
            google.invited += 1;
          } catch (e) {
            const message = String((e as Error).message || 'invite_failed').slice(0, 200);
            google.errors.push(message);
            if (job?.id) {
              await supabase
                .from('meetgeek_guest_invite_jobs')
                .update({ status: 'error', error_code: 'invite_failed', error_message: message })
                .eq('id', job.id);
            }
          }
        }
      } catch (e) {
        google.errors.push(String((e as Error).message).slice(0, 200));
      }
    }
  }

  return {
    horizon_days: horizonDays,
    mode,
    sender: {
      configured: sender.configured,
      provider: sender.provider,
      from_email: sender.from_email,
      detail: sender.detail,
    },
    clients,
    google_scan: google,
    totals: {
      appointments_found: clients.reduce((s, c) => s + c.ghl_appointments_found, 0),
      jobs_enqueued: clients.reduce((s, c) => s + c.jobs_enqueued, 0),
      invited: clients.reduce((s, c) => s + c.invited, 0) + google.invited,
      pending: clients.reduce((s, c) => s + c.pending_awaiting_connection + c.pending_awaiting_sender, 0),
      invites_sent: clients.reduce((s, c) => s + c.invites_sent, 0),
      invites_updated: clients.reduce((s, c) => s + c.invites_updated, 0),
      invites_cancelled: clients.reduce((s, c) => s + c.invites_cancelled, 0),
    },
  };
}
