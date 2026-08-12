// Shared helpers for the Appointment Call Bridge (two-leg Twilio call).
//
// Leg 1: dial the assigned appointment user. Leg 2 (only after the user
// answers): dial the contact. Both legs join the same Twilio conference so the
// user and the contact talk directly with no menus.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export const INTERNAL_PASSWORD = 'HPA1234$';
export const GATEWAY_URL = 'https://connector-gateway.lovable.dev/twilio';
export const DEFAULT_CALLER_ID = '+19165709296';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hpa-webhook-token',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

export const xml = (body: string, status = 200) =>
  new Response(body, { status, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } });

export function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

export function functionsBase(): string {
  const url = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  return `${url}/functions/v1`;
}

export function toE164(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Raw Twilio REST call through the Lovable connector gateway. */
export async function twilioFetch(path: string, form?: URLSearchParams, method = 'POST') {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const twilioKey = Deno.env.get('TWILIO_API_KEY');
  if (!lovableKey) throw new Error('LOVABLE_API_KEY is not configured');
  if (!twilioKey) throw new Error('TWILIO_API_KEY is not configured (link the Twilio connector)');

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': twilioKey,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? form.toString() : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[call-bridge] Twilio ${method} ${path} failed [${res.status}]: ${text.slice(0, 400)}`);
    throw new Error(`Twilio request failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

export interface BridgeRow {
  id: string;
  client_id: string | null;
  appointment_id: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string;
  assigned_user_name: string | null;
  assigned_user_phone: string;
  status: string;
  from_number: string | null;
  conference_name: string | null;
  user_call_sid: string | null;
  contact_call_sid: string | null;
  attempts: number;
}

export async function logEvent(
  sb: any,
  bridgeId: string,
  eventType: string,
  extra: { leg?: string; callSid?: string | null; detail?: string | null; payload?: unknown } = {},
) {
  try {
    await sb.from('appointment_call_bridge_events').insert({
      bridge_id: bridgeId,
      event_type: eventType,
      leg: extra.leg || null,
      call_sid: extra.callSid || null,
      detail: extra.detail || null,
      payload: (extra.payload as any) ?? null,
    });
  } catch (e) {
    console.error('[call-bridge] logEvent failed', (e as Error)?.message);
  }
}

async function resolveCallerId(sb: any, bridge: BridgeRow): Promise<string> {
  if (bridge.from_number) return bridge.from_number;
  if (bridge.client_id) {
    const { data } = await sb
      .from('client_settings')
      .select('outbound_caller_number')
      .eq('client_id', bridge.client_id)
      .maybeSingle();
    const mapped = toE164(data?.outbound_caller_number);
    if (mapped) return mapped;
  }
  return toE164(Deno.env.get('TWILIO_CALLER_ID')) || DEFAULT_CALLER_ID;
}

/** Step 2 — dial the ASSIGNED USER first. Never dials the contact here. */
export async function dialAssignedUser(sb: any, bridge: BridgeRow) {
  const toNumber = toE164(bridge.assigned_user_phone);
  if (!toNumber) throw new Error('assigned user phone missing/invalid');
  const from = await resolveCallerId(sb, bridge);
  const conference = bridge.conference_name || `appt-${bridge.id}`;
  const base = functionsBase();

  const form = new URLSearchParams({
    To: toNumber,
    From: from,
    Url: `${base}/appointment-bridge-voice?bridge=${bridge.id}&leg=user`,
    Method: 'POST',
    StatusCallback: `${base}/appointment-bridge-events?bridge=${bridge.id}&leg=user`,
    StatusCallbackMethod: 'POST',
    Timeout: '30',
    MachineDetection: 'Enable',
  });
  for (const ev of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', ev);

  const call = await twilioFetch('/Calls.json', form);
  const nowIso = new Date().toISOString();
  await sb
    .from('appointment_call_bridges')
    .update({
      status: 'dialing_user',
      conference_name: conference,
      from_number: from,
      user_call_sid: call?.sid || null,
      contact_call_sid: null,
      call_started_at: nowIso,
      attempts: (bridge.attempts || 0) + 1,
      last_error: null,
    })
    .eq('id', bridge.id);
  await logEvent(sb, bridge.id, 'user_dialed', { leg: 'user', callSid: call?.sid, detail: `Dialing ${toNumber}` });
  return call?.sid as string | undefined;
}

/** Step 3 — dial the CONTACT, only ever called after the user answered. */
export async function dialContact(sb: any, bridge: BridgeRow) {
  const toNumber = toE164(bridge.contact_phone);
  if (!toNumber) throw new Error('contact phone missing/invalid');
  const from = bridge.from_number || (await resolveCallerId(sb, bridge));
  const base = functionsBase();

  const form = new URLSearchParams({
    To: toNumber,
    From: from,
    Url: `${base}/appointment-bridge-voice?bridge=${bridge.id}&leg=contact`,
    Method: 'POST',
    StatusCallback: `${base}/appointment-bridge-events?bridge=${bridge.id}&leg=contact`,
    StatusCallbackMethod: 'POST',
    Timeout: '30',
  });
  for (const ev of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', ev);

  const call = await twilioFetch('/Calls.json', form);
  await sb
    .from('appointment_call_bridges')
    .update({ status: 'dialing_contact', contact_call_sid: call?.sid || null })
    .eq('id', bridge.id);
  await logEvent(sb, bridge.id, 'contact_dialed', { leg: 'contact', callSid: call?.sid, detail: `Dialing ${toNumber}` });
  return call?.sid as string | undefined;
}

/** Speak a closing line on a live leg, then hang it up. */
export async function speakAndHangup(callSid: string, message: string) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${escapeXml(message)}</Say><Hangup/></Response>`;
  const form = new URLSearchParams({ Twiml: twiml });
  await twilioFetch(`/Calls/${callSid}.json`, form);
}

export async function hangupCall(callSid: string) {
  await twilioFetch(`/Calls/${callSid}.json`, new URLSearchParams({ Status: 'completed' }));
}