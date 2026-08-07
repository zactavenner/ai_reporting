// Authenticated GHL "Customer Booked Appointment" receiver.
//
// Fail-closed order: credential check -> server-side appointment read ->
// mapping gate -> idempotent guest-invite job -> add notetaker as ATTENDEE ONLY.
// GHL ownership (assignedUserId / appointment owner / linked calendars) is never
// written by this function.
//
// Accepted credentials (in order, at least one is REQUIRED):
//  1. Official GHL Marketplace signature (x-wh-signature / x-ghl-signature,
//     Ed25519 over the raw body) when GHL_MARKETPLACE_PUBLIC_KEY is configured.
//  2. HMAC-SHA256 over the raw body (x-hpa-signature) for senders that can sign.
//  3. High-entropy shared secret in x-hpa-webhook-token, constant-time compared.
//     This is the only mechanism a NATIVE GHL workflow webhook action can use,
//     because it cannot compute an HMAC over its own serialized body.
// Unsigned / untokened requests are always rejected with 401.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  buildInviteIdempotencyKey,
  evaluateGuestGate,
  resolveEventLink,
  botAlreadyGuest,
  GUEST_REJECTION_MESSAGES,
  GHL_MARKETPLACE_SIGNATURE_HEADERS,
  SHARED_SECRET_HEADER,
  type GhlAppointmentLite,
  type GuestConfig,
  verifyWebhookSignature,
  verifyGhlMarketplaceSignature,
  verifySharedSecretHeader,
} from '../_shared/calendarGuest.ts';
import { findEventCandidates, getAccessToken, getEvent, patchAttendee } from '../_shared/googleCalendarClient.ts';
import { getMappedGhl } from '../_shared/ghlMapping.ts';
import { resolveGhlAppointmentWebhookSecret } from '../_shared/webhookSecret.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': [
    'content-type',
    'authorization',
    'apikey',
    'x-client-info',
    SHARED_SECRET_HEADER,
    'x-hpa-signature',
    ...GHL_MARKETPLACE_SIGNATURE_HEADERS,
  ].join(', '),
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const HMAC_SIGNATURE_HEADERS = ['x-hpa-signature', 'x-webhook-signature'];

/** Never logs or returns the secret — only which mechanism authenticated. */
async function authenticateRequest(
  req: Request,
  rawBody: string,
  supabase: any,
): Promise<{ ok: true; method: string } | { ok: false; reason: string }> {
  const marketplaceHeader = GHL_MARKETPLACE_SIGNATURE_HEADERS.map((h) => req.headers.get(h)).find(Boolean) || null;
  const marketplaceKey = Deno.env.get('GHL_MARKETPLACE_PUBLIC_KEY') || null;
  if (marketplaceHeader && marketplaceKey) {
    if (await verifyGhlMarketplaceSignature({ rawBody, header: marketplaceHeader, publicKeyPem: marketplaceKey })) {
      return { ok: true, method: 'ghl_marketplace' };
    }
    return { ok: false, reason: 'marketplace_signature_invalid' };
  }

  const secret = await resolveGhlAppointmentWebhookSecret(supabase);

  const hmacHeader = HMAC_SIGNATURE_HEADERS.map((h) => req.headers.get(h)).find(Boolean) || null;
  if (hmacHeader) {
    if (await verifyWebhookSignature({ rawBody, header: hmacHeader, secret })) {
      return { ok: true, method: 'hmac' };
    }
    return { ok: false, reason: 'signature_invalid' };
  }

  const shared = verifySharedSecretHeader({ header: req.headers.get(SHARED_SECRET_HEADER), secret });
  return shared.ok ? { ok: true, method: shared.method } : { ok: false, reason: shared.reason };
}

function extractAppointmentId(payload: any): string | null {
  const candidates = [
    payload?.appointment?.id,
    payload?.appointmentId,
    payload?.id,
    payload?.calendar?.appointmentId,
    payload?.event?.id,
  ];
  for (const c of candidates) if (c) return String(c);
  return null;
}

async function fetchAppointment(apiKey: string, appointmentId: string): Promise<GhlAppointmentLite | null> {
  const res = await fetch(
    `https://services.leadconnectorhq.com/calendars/events/appointments/${encodeURIComponent(appointmentId)}`,
    { headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-04-15', Accept: 'application/json' } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const appt = data?.appointment || data?.event || data;
  if (!appt?.id) return null;
  return {
    appointmentId: String(appt.id),
    calendarId: appt.calendarId ? String(appt.calendarId) : null,
    locationId: appt.locationId ? String(appt.locationId) : null,
    title: appt.title ?? null,
    startTime: appt.startTime ?? null,
    endTime: appt.endTime ?? null,
    externalGoogleEventId: appt.googleEventId || appt.externalId || null,
    meetingUrl: appt.address || appt.meetingUrl || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const rawBody = await req.text();

  const authed = await authenticateRequest(req, rawBody, supabase);
  if (!authed.ok) {
    console.error('ghl-appointment-webhook rejected', authed.reason);
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const appointmentId = extractAppointmentId(payload);
  const payloadLocationId = payload?.locationId ? String(payload.locationId) : null;
  const payloadCalendarId = payload?.calendarId || payload?.appointment?.calendarId
    ? String(payload.calendarId || payload.appointment.calendarId)
    : null;
  if (!appointmentId) return json({ ok: false, ignored: 'no_appointment_id' }, 202);

  // Candidate configs are looked up by the SERVER-held mapping, never by payload
  // claims. The payload's calendar/location must match the row we find.
  const { data: configs } = await supabase
    .from('client_meetgeek_guest_configs')
    .select('id, client_id, enabled, ghl_location_id, ghl_calendar_id, calendar_connection_id, organizer_calendar_id, bot_guest_email')
    .eq('enabled', true);

  let config: GuestConfig | null = null;
  for (const row of configs || []) {
    if (payloadLocationId && row.ghl_location_id !== payloadLocationId) continue;
    if (payloadCalendarId && row.ghl_calendar_id !== payloadCalendarId) continue;
    if (config) return json({ ok: false, ignored: 'ambiguous_mapping' }, 202);
    config = {
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
  if (!config) return json({ ok: false, ignored: 'unmapped_or_disabled' }, 202);

  // Server-side read of the appointment (payload fields are never trusted).
  // Same mapping path as meetgeek-webhook: clients.ghl_api_key + ghl_location_id.
  const { apiKey, locationId: mappedLocationId } = await getMappedGhl(supabase, config.clientId);
  const mappingUsable = !!apiKey && !!mappedLocationId && mappedLocationId === config.ghlLocationId;
  const appointment = mappingUsable ? await fetchAppointment(apiKey!, appointmentId) : null;

  const gate = evaluateGuestGate({ config, appointment });
  const idempotencyKey = buildInviteIdempotencyKey({
    clientId: config.clientId,
    appointmentId,
    botGuestEmail: config.botGuestEmail || 'none',
  });

  if (!gate.allowed) {
    await supabase.from('meetgeek_guest_invite_jobs').upsert(
      {
        idempotency_key: idempotencyKey,
        client_id: config.clientId,
        guest_config_id: config.id,
        ghl_appointment_id: appointmentId,
        ghl_calendar_id: config.ghlCalendarId,
        ghl_location_id: config.ghlLocationId,
        bot_guest_email: config.botGuestEmail,
        status: 'rejected',
        rejection_reason: gate.reason,
        error_message: GUEST_REJECTION_MESSAGES[gate.reason],
      },
      { onConflict: 'idempotency_key' },
    );
    return json({ ok: false, rejected: gate.reason }, 202);
  }

  // Idempotency: a completed job for this appointment short-circuits.
  // Default path: zero-OAuth shadow invite. The same polling code handles
  // enqueue, send, reschedule (SEQUENCE bump) and cancellation, so the webhook
  // is purely a real-time trigger for the client that just booked.
  if ((Deno.env.get('GUEST_INVITE_MODE') || 'shadow_email') !== 'google_guest') {
    const poll = await runGuestInvitePolling({
      supabase,
      clientId: config.clientId,
      horizonDays: 60,
      scanGoogle: false,
      force: true,
    });
    const row = poll.clients[0];
    return json(
      {
        ok: true,
        mode: poll.mode,
        sender_configured: poll.sender.configured,
        invites_sent: row?.invites_sent ?? 0,
        invites_updated: row?.invites_updated ?? 0,
        invites_cancelled: row?.invites_cancelled ?? 0,
        pending_awaiting_sender: row?.pending_awaiting_sender ?? 0,
      },
      200,
    );
  }

  const { data: existing } = await supabase
    .from('meetgeek_guest_invite_jobs')
    .select('id, status, attempts, google_event_id')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing?.status === 'invited') {
    return json({ ok: true, idempotent: true, google_event_id: existing.google_event_id }, 200);
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
        google_calendar_id: config.organizerCalendarId,
        bot_guest_email: gate.botGuestEmail,
        status: 'processing',
        attempts: (existing?.attempts || 0) + 1,
        scheduled_start: gate.appointment.startTime,
        scheduled_end: gate.appointment.endTime,
        rejection_reason: null,
        error_message: null,
      },
      { onConflict: 'idempotency_key' },
    )
    .select('id')
    .maybeSingle();

  const finish = async (patch: Record<string, unknown>) => {
    if (job?.id) await supabase.from('meetgeek_guest_invite_jobs').update(patch).eq('id', job.id);
  };

  try {
    const { token } = await getAccessToken(supabase, config.calendarConnectionId!);
    const calendarId = config.organizerCalendarId;

    let event = null as any;
    if (gate.appointment.externalGoogleEventId) {
      // A real GET first: patching with a synthesized empty attendee list would
      // wipe the organizer's existing guests.
      event = await getEvent({ token, calendarId, eventId: gate.appointment.externalGoogleEventId });
      if (!event) {
        await finish({
          status: 'needs_event_link',
          error_code: 'google_event_not_readable',
          error_message: 'The Google event referenced by the appointment could not be read on the organizer calendar.',
        });
        return json({ ok: false, status: 'needs_event_link' }, 202);
      }
    } else {
      const { tagged, windowEvents } = await findEventCandidates({ token, calendarId, appointment: gate.appointment });
      const link = resolveEventLink({ taggedEvents: tagged, windowEvents, allowCreate: false });
      if (link.kind === 'needs_event_link') {
        await finish({
          status: 'needs_event_link',
          error_code: 'no_unique_event',
          error_message: `Could not link the appointment to exactly one organizer event (${link.candidates} candidates).`,
        });
        return json({ ok: false, status: 'needs_event_link' }, 202);
      }
      if (link.kind === 'create') {
        await finish({ status: 'needs_event_link', error_code: 'create_disabled' });
        return json({ ok: false, status: 'needs_event_link' }, 202);
      }
      event = link.event;
    }

    if (botAlreadyGuest(event, gate.botGuestEmail)) {
      await finish({ status: 'invited', google_event_id: event.id, completed_at: new Date().toISOString() });
      return json({ ok: true, idempotent: true, google_event_id: event.id }, 200);
    }

    const updated = await patchAttendee({
      token,
      calendarId,
      event,
      botGuestEmail: gate.botGuestEmail,
      appointmentId,
      clientId: config.clientId,
    });

    await finish({ status: 'invited', google_event_id: updated.id || event.id, completed_at: new Date().toISOString() });
    await supabase
      .from('client_meetgeek_guest_configs')
      .update({ last_invite_at: new Date().toISOString(), last_error: null })
      .eq('id', config.id);

    return json({ ok: true, google_event_id: updated.id || event.id }, 200);
  } catch (e) {
    const message = String((e as Error).message || 'invite_failed').slice(0, 300);
    console.error('guest invite failed', message);
    await finish({ status: 'error', error_code: 'invite_failed', error_message: message });
    await supabase
      .from('client_meetgeek_guest_configs')
      .update({ last_error: message, last_error_at: new Date().toISOString() })
      .eq('id', config.id);
    return json({ ok: false, error: 'invite_failed' }, 500);
  }
});