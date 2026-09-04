/**
 * grok-booking — production bridge between the xAI Voice Agent
 * ("AI Capital Raising Sales Associate") and Reporting 5.0 / GoHighLevel.
 *
 * Two operations, one strict contract:
 *   get_available_slots      (read only)  { start_date, end_date?, timezone }
 *   create_discovery_booking (write)      { name, phone, email, start_time, timezone }
 *
 * Security posture:
 *  - Authenticated ONLY by the pre-existing GROK_BOOKING_TOKEN environment
 *    secret. If it is absent the function fails closed with a configuration
 *    error and performs no work.
 *  - The caller may never supply GHL credentials, client ids, location ids or
 *    calendar ids. The target is resolved from public.calendar_mappings joined
 *    to public.clients, and the client's own server-side GHL credentials are
 *    used. Anything the caller sends beyond the documented fields is ignored.
 *  - Availability is re-read from GHL free-slots immediately before every
 *    appointment create; a stale slot is refused.
 *  - Every attempt is logged in the AI Caller reporting path
 *    (public.phone_call_records) with no PII in console output.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  GROK_BOOKING_TOKEN_ENV,
  authorizeGrokBooking,
  presentedToken,
  validateSlotsInput,
  validateBookingInput,
  parseFreeSlots,
  slotIsAvailable,
  endTimeFor,
  bookingIdempotencyKey,
  maskForLog,
} from '../_shared/grokBooking.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-grok-booking-token',
};

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_CALENDAR_ID = '5NMmbITnqFbds1yWP3TD';
const CALENDAR_LABEL = '30-min Discovery Call';
const SLOT_MINUTES = 30;
const AI_AGENT = 'AI Capital Raising Sales Associate';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(code: string, error: string, status: number) {
  return json({ ok: false, code, error }, status);
}

/** Resolve the single mapped calendar + the owning client's credentials. */
async function resolveTarget() {
  const { data: mappings, error } = await admin
    .from('calendar_mappings')
    .select('id, client_id, ghl_calendar_id, calendar_name')
    .eq('ghl_calendar_id', GHL_CALENDAR_ID)
    .not('client_id', 'is', null);
  if (error) return { code: 'mapping_lookup_failed' as const };
  if (!mappings || mappings.length === 0) return { code: 'calendar_not_configured' as const };
  if (mappings.length > 1) return { code: 'ambiguous_calendar_mapping' as const };

  const mapping = mappings[0];
  const { data: client } = await admin
    .from('clients')
    .select('id, name, ghl_api_key, ghl_location_id')
    .eq('id', mapping.client_id)
    .maybeSingle();
  if (!client?.ghl_api_key || !client?.ghl_location_id) {
    return { code: 'client_ghl_not_configured' as const };
  }
  return {
    code: 'ok' as const,
    mappingId: mapping.id as string,
    calendarName: (mapping.calendar_name as string) || CALENDAR_LABEL,
    clientId: client.id as string,
    clientName: client.name as string,
    apiKey: client.ghl_api_key as string,
    locationId: client.ghl_location_id as string,
  };
}

async function ghl(path: string, apiKey: string, init?: RequestInit) {
  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Version: '2021-04-15',
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

/** Free slots for one calendar, in the caller's timezone. */
async function fetchSlots(
  apiKey: string,
  startDate: string,
  endDate: string,
  timezone: string,
) {
  const startMs = Date.parse(`${startDate}T00:00:00Z`) - 86400000;
  const endMs = Date.parse(`${endDate}T23:59:59Z`) + 86400000;
  const r = await ghl(
    `/calendars/${encodeURIComponent(GHL_CALENDAR_ID)}/free-slots` +
      `?startDate=${startMs}&endDate=${endMs}&timezone=${encodeURIComponent(timezone)}`,
    apiKey,
  );
  return r;
}

/** AI Caller reporting path: one row per booking attempt, keyed for idempotency. */
async function logAttempt(row: Record<string, unknown>) {
  const { data, error } = await admin
    .from('phone_call_records')
    .insert(row)
    .select('id, appointment_id')
    .maybeSingle();
  if (error) return { conflict: true as const };
  return { conflict: false as const, id: data?.id as string | undefined };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return err('method_not_allowed', 'POST only', 405);

  // 1. Fail closed on a missing environment secret — no work, no lookups.
  const expected = (Deno.env.get(GROK_BOOKING_TOKEN_ENV) || '').trim();
  if (!expected || expected.length < 16) {
    console.error(`grok-booking: ${GROK_BOOKING_TOKEN_ENV} is not configured; refusing all requests`);
    return err(
      'configuration_error',
      `${GROK_BOOKING_TOKEN_ENV} is not configured for this environment`,
      503,
    );
  }
  if (!authorizeGrokBooking(presentedToken(req.headers), expected)) {
    return err('unauthorized', 'A valid booking token is required', 401);
  }

  let payload: any;
  try { payload = await req.json(); } catch { return err('invalid_body', 'JSON body required', 400); }
  const operation = String(payload?.operation ?? payload?.action ?? '');

  const target = await resolveTarget();
  if (target.code !== 'ok') {
    const status = target.code === 'mapping_lookup_failed' ? 500 : 409;
    console.error(`grok-booking: target unresolved (${target.code})`);
    return err(target.code, `The Discovery Call calendar could not be resolved (${target.code})`, status);
  }

  // ---------- read only ----------
  if (operation === 'get_available_slots') {
    const v = validateSlotsInput(payload);
    if (!v.ok) return err(v.code, v.error, 400);
    const { startDate, endDate, timezone } = v.value;

    const r = await fetchSlots(target.apiKey, startDate, endDate, timezone);
    if (!r.ok) {
      console.error(`grok-booking: free-slots read failed status=${r.status}`);
      return err('availability_unavailable', 'Availability could not be read right now', 502);
    }
    const slots = parseFreeSlots(r.body).sort();
    console.log(`grok-booking: availability ok slots=${slots.length} range=${startDate}..${endDate}`);
    return json({
      ok: true,
      operation,
      calendar_name: target.calendarName,
      timezone,
      duration_minutes: SLOT_MINUTES,
      slots,
    });
  }

  // ---------- guarded write ----------
  if (operation === 'create_discovery_booking') {
    const v = validateBookingInput(payload);
    if (!v.ok) return err(v.code, v.error, 400);
    const { name, phone, email, startTime, timezone } = v.value;

    const idempotencyKey = await bookingIdempotencyKey(GHL_CALENDAR_ID, startTime, email);

    // Duplicate guard: a prior confirmed attempt wins, nothing is re-created.
    const { data: prior } = await admin
      .from('phone_call_records')
      .select('appointment_id, appointment_date, appointment_booked')
      .eq('call_id', idempotencyKey)
      .maybeSingle();
    if (prior?.appointment_booked && prior?.appointment_id) {
      return json({
        ok: true,
        operation,
        duplicate: true,
        appointment_id: prior.appointment_id,
        start_time: startTime,
        end_time: endTimeFor(startTime, SLOT_MINUTES),
        timezone,
        calendar_name: target.calendarName,
      });
    }
    if (prior && !prior.appointment_booked) {
      return err('duplicate_in_progress', 'An identical booking attempt is already in flight', 409);
    }

    // Reserve the idempotency key in the AI Caller reporting path first.
    const startDate = new Date(startTime).toISOString().slice(0, 10);
    const reserved = await logAttempt({
      client_id: target.clientId,
      call_id: idempotencyKey,
      provider: 'grok_voice',
      ai_agent: AI_AGENT,
      is_ai_caller: true,
      direction: 'outbound',
      call_status: 'booking_attempt',
      contact_name: name,
      contact_phone: phone,
      contact_email: email,
      appointment_date: startTime,
      appointment_status: 'pending',
      appointment_booked: false,
      started_at: new Date().toISOString(),
      outcome: 'booking_requested',
    });
    if (reserved.conflict) {
      return err('duplicate_in_progress', 'An identical booking attempt is already in flight', 409);
    }

    // Re-read availability immediately before the write.
    const avail = await fetchSlots(target.apiKey, startDate, startDate, timezone);
    if (!avail.ok) {
      await admin.from('phone_call_records')
        .update({ appointment_status: 'invalid', outcome: 'availability_unavailable' })
        .eq('call_id', idempotencyKey);
      console.error(`grok-booking: pre-write availability read failed status=${avail.status}`);
      return err('availability_unavailable', 'Availability could not be verified right now', 502);
    }
    if (!slotIsAvailable(parseFreeSlots(avail.body), startTime)) {
      await admin.from('phone_call_records')
        .update({ appointment_status: 'invalid', outcome: 'slot_unavailable' })
        .eq('call_id', idempotencyKey);
      console.log(`grok-booking: refused stale slot contact=${maskForLog(email)}`);
      return err('slot_unavailable', 'That time is no longer available; please pick another slot', 409);
    }

    // Contact, then appointment. GHL is the system of record for both.
    const [firstName, ...rest] = name.split(/\s+/);
    const contactRes = await ghl('/contacts/upsert', target.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        locationId: target.locationId,
        firstName,
        lastName: rest.join(' ') || undefined,
        name,
        email,
        phone,
        source: 'xAI Voice Agent',
      }),
    });
    const contactId = contactRes.body?.contact?.id || contactRes.body?.id;
    if (!contactRes.ok || !contactId) {
      await admin.from('phone_call_records')
        .update({ appointment_status: 'invalid', outcome: 'contact_create_failed' })
        .eq('call_id', idempotencyKey);
      console.error(`grok-booking: contact upsert failed status=${contactRes.status}`);
      return err('contact_create_failed', 'The contact record could not be created', 502);
    }

    const endTime = endTimeFor(startTime, SLOT_MINUTES);
    const apptRes = await ghl('/calendars/events/appointments', target.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        calendarId: GHL_CALENDAR_ID,
        locationId: target.locationId,
        contactId,
        startTime,
        endTime,
        title: `${CALENDAR_LABEL} — ${name}`,
        appointmentStatus: 'confirmed',
        ignoreDateRange: false,
        ignoreFreeSlotValidation: false,
      }),
    });
    const appointmentId = apptRes.body?.id || apptRes.body?.appointment?.id || apptRes.body?.event?.id;
    if (!apptRes.ok || !appointmentId) {
      await admin.from('phone_call_records')
        .update({
          contact_id: String(contactId),
          appointment_status: 'invalid',
          outcome: 'appointment_create_failed',
        })
        .eq('call_id', idempotencyKey);
      console.error(`grok-booking: appointment create failed status=${apptRes.status}`);
      return err('appointment_create_failed', 'The appointment could not be created', 502);
    }

    await admin.from('phone_call_records')
      .update({
        contact_id: String(contactId),
        appointment_id: String(appointmentId),
        appointment_booked: true,
        appointment_status: 'confirmed',
        appointment_date: startTime,
        call_status: 'booked',
        outcome: 'discovery_call_booked',
        qualified: true,
      })
      .eq('call_id', idempotencyKey);

    console.log(`grok-booking: booked appointment cal=${CALENDAR_LABEL} contact=${maskForLog(email)}`);
    return json({
      ok: true,
      operation,
      appointment_id: String(appointmentId),
      start_time: startTime,
      end_time: endTime,
      timezone,
      calendar_name: target.calendarName,
    });
  }

  return err('unknown_operation', 'operation must be get_available_slots or create_discovery_booking', 400);
});
