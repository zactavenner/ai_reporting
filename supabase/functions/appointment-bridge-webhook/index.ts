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
      body = {};
    }

    const sb = serviceClient();

    const token = (req.headers.get('x-hpa-webhook-token') || '').trim();
    const secret = await resolveGhlAppointmentWebhookSecret(sb);
    const tokenOk = !!token && !!secret && timingSafeEqual(token, secret);
    const passwordOk = body?.password === INTERNAL_PASSWORD;
    if (!tokenOk && !passwordOk) return json({ error: 'unauthorized' }, 401);

    const appointmentId = String(body.appointment_id || body.appointmentId || '').trim();
    const appointmentTime = String(body.appointment_time || body.start_time || '').trim();
    const contactPhone = toE164(body.contact_phone || body.phone);
    const userPhone = toE164(body.assigned_user_phone || body.user_phone);

    if (!appointmentId) return json({ error: 'appointment_id is required' }, 400);
    if (!appointmentTime || Number.isNaN(Date.parse(appointmentTime))) {
      return json({ error: 'appointment_time must be a valid date/time' }, 400);
    }
    if (!contactPhone) return json({ error: 'contact_phone is required' }, 400);
    if (!userPhone) return json({ error: 'assigned_user_phone is required' }, 400);

    const startsAt = new Date(appointmentTime).toISOString();

    const payload = {
      client_id: body.client_id || null,
      appointment_id: appointmentId,
      contact_id: body.contact_id ? String(body.contact_id) : null,
      contact_name: body.contact_name ? String(body.contact_name) : null,
      contact_phone: contactPhone,
      assigned_user_id: body.assigned_user_id ? String(body.assigned_user_id) : null,
      assigned_user_name: body.assigned_user_name ? String(body.assigned_user_name) : null,
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