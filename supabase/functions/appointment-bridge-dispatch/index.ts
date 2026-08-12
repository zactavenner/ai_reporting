// Runs every minute (pg_cron) and fires any appointment whose start time has
// arrived. Also handles the single 90-second retry of the assigned user.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, dialAssignedUser, INTERNAL_PASSWORD, json, logEvent, serviceClient } from '../_shared/callBridge.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (body?.password && body.password !== INTERNAL_PASSWORD) return json({ error: 'unauthorized' }, 401);

    const sb = serviceClient();
    const nowIso = new Date().toISOString();

    const { data: due, error } = body?.bridge_id
      ? await sb.from('appointment_call_bridges').select('*').eq('id', body.bridge_id).limit(1)
      : await sb
          .from('appointment_call_bridges')
          .select('*')
          .in('status', ['scheduled', 'retry_user'])
          .lte('scheduled_at', nowIso)
          .gte('scheduled_at', new Date(Date.now() - 30 * 60_000).toISOString())
          .order('scheduled_at', { ascending: true })
          .limit(25);
    if (error) throw error;

    const results: any[] = [];
    for (const bridge of due || []) {
      try {
        const sid = await dialAssignedUser(sb, bridge as any);
        results.push({ bridge_id: bridge.id, appointment_id: bridge.appointment_id, user_call_sid: sid });
      } catch (e) {
        const message = String((e as Error)?.message || e);
        await sb
          .from('appointment_call_bridges')
          .update({ status: 'failed', last_error: message, ended_at: new Date().toISOString() })
          .eq('id', bridge.id);
        await logEvent(sb, bridge.id, 'dial_failed', { leg: 'user', detail: message });
        results.push({ bridge_id: bridge.id, error: message });
      }
    }

    return json({ ok: true, dispatched: results.length, results });
  } catch (e) {
    const message = String((e as Error)?.message || e);
    console.error('[appointment-bridge-dispatch]', message);
    return json({ error: message }, 500);
  }
});