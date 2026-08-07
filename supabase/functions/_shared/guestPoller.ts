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

const GHL_BASE = 'https://services.leadconnectorhq.com';

export interface PollClientResult {
  client_id: string;
  client_name: string;
  ghl_appointments_found: number;
  jobs_enqueued: number;
  jobs_already_present: number;
  invited: number;
  pending_awaiting_connection: number;
  rejected: number;
  errors: string[];
}

export interface PollResult {
  horizon_days: number;
  clients: PollClientResult[];
  google_scan: {
    connections: number;
    events_scanned: number;
    events_missing_bot: number;
    invited: number;
    skipped_duplicate: number;
    errors: string[];
  };
  totals: { appointments_found: number; jobs_enqueued: number; invited: number; pending: number };
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

/** Upcoming events on one GHL calendar. Read-only. */
async function fetchUpcomingGhlAppointments(args: {
  apiKey: string;
  locationId: string;
  calendarId: string;
  horizonDays: number;
}): Promise<GhlAppointmentLite[]> {
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
  return events
    .filter((e) => e?.id && !cancelled.test(String(e.appointmentStatus || e.status || '')))
    .map((e) => ({
      appointmentId: String(e.id),
      calendarId: String(e.calendarId || args.calendarId),
      locationId: String(e.locationId || args.locationId),
      title: e.title ?? null,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
      externalGoogleEventId: e.googleEventId || e.externalId || null,
      meetingUrl: e.address || e.meetingUrl || null,
    }));
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
}): Promise<PollResult> {
  const { supabase } = args;
  const horizonDays = args.horizonDays ?? 14;

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
      rejected: 0,
      errors: [],
    };

    // Poll only clients the operator has switched on in either surface.
    const active = row.enabled || settings?.enabled;
    if (!active) continue;

    const calendarId = row.ghl_calendar_id || settings?.ghl_calendar_id || null;
    const config = toConfig({ ...row, ghl_calendar_id: calendarId, enabled: true });
    if (!client?.ghl_api_key || !client?.ghl_location_id || !calendarId) {
      result.errors.push('missing CRM credentials or mapped calendar');
      clients.push(result);
      continue;
    }

    let appointments: GhlAppointmentLite[] = [];
    try {
      appointments = await fetchUpcomingGhlAppointments({
        apiKey: client.ghl_api_key,
        locationId: client.ghl_location_id,
        calendarId,
        horizonDays,
      });
    } catch (e) {
      result.errors.push(String((e as Error).message).slice(0, 200));
      clients.push(result);
      continue;
    }
    result.ghl_appointments_found = appointments.length;

    const botEmail = normalizeEmail(config.botGuestEmail);
    for (const appointment of appointments) {
      const gate = evaluateGuestGate({
        config: { ...config, calendarConnectionId: config.calendarConnectionId || 'pending' },
        appointment,
      });
      const idempotencyKey = buildInviteIdempotencyKey({
        clientId: config.clientId,
        appointmentId: appointment.appointmentId,
        botGuestEmail: botEmail || 'none',
      });

      const { data: existing } = await supabase
        .from('meetgeek_guest_invite_jobs')
        .select('id, status, attempts')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      // Dedupe across webhook + poller: anything already invited or rejected is
      // left untouched.
      if (existing && TERMINAL.has(String(existing.status))) {
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
            ghl_calendar_id: calendarId,
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

      const hasConnection = !!row.calendar_connection_id;
      const { data: job } = await supabase
        .from('meetgeek_guest_invite_jobs')
        .upsert(
          {
            idempotency_key: idempotencyKey,
            client_id: config.clientId,
            guest_config_id: config.id,
            ghl_appointment_id: appointment.appointmentId,
            ghl_calendar_id: calendarId,
            ghl_location_id: config.ghlLocationId,
            google_calendar_id: hasConnection ? config.organizerCalendarId : null,
            bot_guest_email: gate.botGuestEmail,
            // Without a Google connection the job parks as `pending` and is
            // picked up by a later poll once the calendar is connected.
            status: hasConnection ? 'processing' : 'pending',
            attempts: hasConnection ? (existing?.attempts || 0) + 1 : existing?.attempts || 0,
            scheduled_start: appointment.startTime,
            scheduled_end: appointment.endTime,
            rejection_reason: null,
            error_message: hasConnection ? null : 'Waiting for the organizer Google Calendar connection.',
          },
          { onConflict: 'idempotency_key' },
        )
        .select('id')
        .maybeSingle();

      if (!existing) result.jobs_enqueued += 1;
      else result.jobs_already_present += 1;

      if (!hasConnection) {
        result.pending_awaiting_connection += 1;
        continue;
      }
      if (!job?.id) continue;
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

  if (args.scanGoogle !== false) {
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
    clients,
    google_scan: google,
    totals: {
      appointments_found: clients.reduce((s, c) => s + c.ghl_appointments_found, 0),
      jobs_enqueued: clients.reduce((s, c) => s + c.jobs_enqueued, 0),
      invited: clients.reduce((s, c) => s + c.invited, 0) + google.invited,
      pending: clients.reduce((s, c) => s + c.pending_awaiting_connection, 0),
    },
  };
}
