// Twilio status-callback handler for the appointment call bridge.
//
// user leg answered   -> immediately dial the contact
// user leg unanswered -> DO NOT dial the contact; log "Appointment User Not
//                        Reached" and queue one retry 90s later
// contact answered    -> Connected (both legs are already in the conference)
// contact unanswered  -> tell the user, hang up, log "Contact Not Reached"
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  dialContact,
  json,
  logEvent,
  serviceClient,
  speakAndHangup,
  type BridgeRow,
} from '../_shared/callBridge.ts';

const MAX_USER_ATTEMPTS = 2;
const FAILED_STATES = new Set(['busy', 'no-answer', 'failed', 'canceled']);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const bridgeId = url.searchParams.get('bridge') || '';
  const leg = url.searchParams.get('leg') || 'user';

  let params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) params[k] = String(v);
  } catch {
    try {
      params = await req.json();
    } catch {
      params = {};
    }
  }

  const callStatus = (params.CallStatus || '').toLowerCase();
  const answeredBy = (params.AnsweredBy || '').toLowerCase();
  const callSid = params.CallSid || null;
  const sb = serviceClient();

  const { data: row } = await sb.from('appointment_call_bridges').select('*').eq('id', bridgeId).maybeSingle();
  if (!row) return json({ ok: true, ignored: 'bridge_not_found' });
  const bridge = row as BridgeRow & Record<string, any>;

  await logEvent(sb, bridge.id, `${leg}_${callStatus || 'event'}`, {
    leg,
    callSid,
    detail: answeredBy ? `answered_by=${answeredBy}` : null,
    payload: params,
  });

  const nowIso = new Date().toISOString();
  const machine = answeredBy.startsWith('machine') || answeredBy === 'fax';

  try {
    if (leg === 'user') {
      if (callStatus === 'in-progress' || callStatus === 'answered') {
        if (machine) {
          await sb
            .from('appointment_call_bridges')
            .update({ status: 'user_not_reached', last_error: 'voicemail/machine answered', ended_at: nowIso })
            .eq('id', bridge.id);
          await logEvent(sb, bridge.id, 'appointment_user_not_reached', { leg: 'user', detail: 'voicemail' });
          if (callSid) await speakAndHangup(callSid, 'This appointment call has ended.');
          return json({ ok: true, outcome: 'user_voicemail' });
        }
        if (!bridge.user_answered_at) {
          await sb
            .from('appointment_call_bridges')
            .update({ status: 'user_answered', user_answered_at: nowIso })
            .eq('id', bridge.id);
          await logEvent(sb, bridge.id, 'appointment_user_answered', { leg: 'user', callSid });
          await dialContact(sb, { ...bridge, user_call_sid: callSid || bridge.user_call_sid });
        }
        return json({ ok: true, outcome: 'contact_dialed' });
      }

      if (FAILED_STATES.has(callStatus) && !bridge.user_answered_at) {
        const attempts = bridge.attempts || 1;
        const retry = attempts < MAX_USER_ATTEMPTS;
        await sb
          .from('appointment_call_bridges')
          .update({
            status: retry ? 'retry_user' : 'user_not_reached',
            scheduled_at: retry ? new Date(Date.now() + 90_000).toISOString() : bridge.scheduled_at,
            last_error: `Appointment User Not Reached (${callStatus})`,
            ended_at: retry ? null : nowIso,
          })
          .eq('id', bridge.id);
        await logEvent(sb, bridge.id, retry ? 'appointment_user_retry_queued' : 'appointment_user_not_reached', {
          leg: 'user',
          detail: callStatus,
        });
        return json({ ok: true, outcome: retry ? 'retry_queued' : 'user_not_reached' });
      }

      if (callStatus === 'completed' && bridge.user_answered_at) {
        const duration = Number(params.CallDuration || 0) || null;
        const finalStatus = bridge.contact_answered_at
          ? 'completed'
          : bridge.status === 'contact_not_reached'
            ? 'contact_not_reached'
            : 'contact_not_reached';
        await sb
          .from('appointment_call_bridges')
          .update({ status: finalStatus, ended_at: nowIso, duration_seconds: duration })
          .eq('id', bridge.id);
        return json({ ok: true, outcome: finalStatus });
      }

      return json({ ok: true });
    }

    // contact leg
    if (callStatus === 'in-progress' || callStatus === 'answered') {
      await sb
        .from('appointment_call_bridges')
        .update({ status: 'connected', contact_answered_at: nowIso, contact_call_sid: callSid || bridge.contact_call_sid })
        .eq('id', bridge.id);
      await logEvent(sb, bridge.id, 'bridged', { leg: 'contact', callSid, detail: 'Both parties connected' });
      return json({ ok: true, outcome: 'connected' });
    }

    if (FAILED_STATES.has(callStatus) && !bridge.contact_answered_at) {
      await sb
        .from('appointment_call_bridges')
        .update({ status: 'contact_not_reached', last_error: `Contact Not Reached (${callStatus})`, ended_at: nowIso })
        .eq('id', bridge.id);
      await logEvent(sb, bridge.id, 'contact_not_reached', { leg: 'contact', detail: callStatus });
      if (bridge.user_call_sid) {
        await speakAndHangup(bridge.user_call_sid, 'The contact did not answer. The call has ended.');
      }
      return json({ ok: true, outcome: 'contact_not_reached' });
    }

    if (callStatus === 'completed' && bridge.contact_answered_at) {
      const duration = Number(params.CallDuration || 0) || null;
      await sb
        .from('appointment_call_bridges')
        .update({ status: 'completed', ended_at: nowIso, duration_seconds: duration })
        .eq('id', bridge.id);
      return json({ ok: true, outcome: 'completed' });
    }

    return json({ ok: true });
  } catch (e) {
    const message = String((e as Error)?.message || e);
    console.error('[appointment-bridge-events]', message);
    await sb.from('appointment_call_bridges').update({ last_error: message }).eq('id', bridge.id);
    await logEvent(sb, bridge.id, 'error', { leg, detail: message });
    return json({ ok: false, error: message }, 200);
  }
});