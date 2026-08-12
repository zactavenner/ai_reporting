// Receives appointment data from GoHighLevel (workflow webhook / API) and
// schedules the two-leg bridge call for the appointment start time.
//
// Auth: shared secret in x-hpa-webhook-token (same secret family as the other
// GHL webhooks) OR an internal password in the JSON body.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, functionsBase, INTERNAL_PASSWORD, json, logEvent, serviceClient, toE164 } from '../_shared/callBridge.ts';
import { resolveGhlAppointmentWebhookSecret } from '../_shared/webhookSecret.ts';

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const raw = await req.text();
    let body: any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      // GHL can post form-encoded bodies.
      try {
        body = Object.fromEntries(new URLSearchParams(raw).entries());
      } catch {
        body = {};
      }
    }

    const sb = serviceClient();

    const url = new URL(req.url);
    // Any query param is also accepted as a field (GHL "custom values" URLs).
    for (const [k, v] of url.searchParams.entries()) if (body[k] === undefined) body[k] = v;
    const qToken = (url.searchParams.get('token') || url.searchParams.get('secret') || '').trim();
    const token = (req.headers.get('x-hpa-webhook-token') || qToken).trim();
    const secret = await resolveGhlAppointmentWebhookSecret(sb);
    const tokenOk = !!token && !!secret && timingSafeEqual(token, secret);
    const passwordOk = body?.password === INTERNAL_PASSWORD ||
      (url.searchParams.get('password') || '') === INTERNAL_PASSWORD;
    if (!tokenOk && !passwordOk) return json({ error: 'unauthorized' }, 401);

    const appt = body.appointment || body.calendar || {};
    const contact = body.contact || {};
    const assigned = body.assigned_user || body.user || body.assignedUser || {};
    const custom = body.customData || body.custom_data || {};
    const loc = body.location || {};

    const pick = (...vals: unknown[]) => {
      for (const v of vals) {
        const s = v === null || v === undefined ? '' : String(v).trim();
        if (s) return s;
      }
      return null;
    };
    const joinName = (first?: unknown, last?: unknown) =>
      pick([first, last].map((p) => (p ? String(p).trim() : '')).filter(Boolean).join(' '));

    const appointmentId = String(
      body.appointment_id || body.appointmentId || appt.id || appt.appointmentId ||
      body.id || body.event_id || '',
    ).trim();
    const appointmentTime = String(
      body.appointment_time || body.start_time || body.startTime ||
      appt.startTime || appt.start_time || appt.selectedTimezoneStartTime || '',
    ).trim();
    const contactPhone = toE164(
      body.contact_phone || body.phone || contact.phone || contact.phone_number || body.full_phone,
    );
    const userPhone = toE164(
      body.assigned_user_phone || body.user_phone || assigned.phone ||
      body.assignedUserPhone || appt.assignedUserPhone,
    );

    if (!appointmentId) return json({ error: 'appointment_id is required' }, 400);
    if (!appointmentTime || Number.isNaN(Date.parse(appointmentTime))) {
      return json({ error: 'appointment_time must be a valid date/time' }, 400);
    }
    if (!contactPhone) return json({ error: 'contact_phone is required' }, 400);
    if (!userPhone) return json({ error: 'assigned_user_phone is required' }, 400);

    const startsAt = new Date(appointmentTime).toISOString();

    // Resolve the client from the GHL location when not passed explicitly.
    let clientId: string | null = body.client_id ? String(body.client_id) : null;
    if (!clientId) {
      const locationId = pick(body.location_id, body.locationId, loc.id);
      if (locationId) {
        const { data: byLoc } = await sb
          .from('clients')
          .select('id')
          .eq('ghl_location_id', locationId)
          .maybeSingle();
        clientId = byLoc?.id ?? null;
      }
      if (!clientId) {
        const locationName = pick(loc.name, body.location_name);
        if (locationName) {
          const { data: byName } = await sb
            .from('clients')
            .select('id')
            .ilike('name', locationName)
            .maybeSingle();
          clientId = byName?.id ?? null;
        }
      }
    }

    const payload = {
      client_id: clientId,
      appointment_id: appointmentId,
      contact_id: pick(body.contact_id, contact.id, custom['Contact Id'], custom['Contact ID']),
      contact_name: pick(
        body.contact_name,
        contact.name,
        contact.full_name,
        custom['Contact Name'],
        body.full_name,
        joinName(body.first_name || contact.first_name, body.last_name || contact.last_name),
      ),
      contact_phone: contactPhone,
      assigned_user_id: pick(body.assigned_user_id, assigned.id, custom['User ID'], custom['User Id']),
      assigned_user_name: pick(
        body.assigned_user_name,
        assigned.name,
        custom['User Name'],
        joinName(assigned.firstName || assigned.first_name, assigned.lastName || assigned.last_name),
        assigned.email,
      ),
      assigned_user_phone: userPhone,
      appointment_time: startsAt,
      scheduled_at: startsAt,
      status: 'scheduled',
      attempts: 0,
      last_error: null,
      raw_payload: body,
    };

    const { data: saved, error } = await sb
      .from('appointment_call_bridges')
      .upsert(payload, { onConflict: 'appointment_id' })
      .select('*')
      .maybeSingle();
    if (error) throw error;

    await logEvent(sb, saved!.id, 'scheduled', {
      detail: `Appointment ${appointmentId} scheduled for ${startsAt}`,
      payload: { via: tokenOk ? 'ghl_token' : 'internal' },
    });

    // Appointment already due (or within the next minute) — fire immediately.
    const dueNow = Date.parse(startsAt) - Date.now() <= 60_000;
    if (dueNow) {
      await fetch(`${functionsBase()}/appointment-bridge-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: INTERNAL_PASSWORD, bridge_id: saved!.id }),
      }).catch((e) => console.error('[appointment-bridge-webhook] immediate dispatch failed', e?.message));
    }

    return json({ ok: true, bridge_id: saved!.id, scheduled_at: startsAt, dispatched_now: dueNow });
  } catch (e) {
    const message = String((e as Error)?.message || e);
    console.error('[appointment-bridge-webhook]', message);
    return json({ error: message }, 500);
  }
});