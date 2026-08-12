// Password-gated admin bridge for the Appointment Call Bridge UI.
// Actions: list, timeline, call_now, cancel, test_credentials
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeaders,
  dialAssignedUser,
  hangupCall,
  INTERNAL_PASSWORD,
  json,
  logEvent,
  serviceClient,
  twilioFetch,
} from '../_shared/callBridge.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body?.password !== INTERNAL_PASSWORD) return json({ error: 'unauthorized' }, 401);
    const sb = serviceClient();
    const action = String(body.action || 'list');

    if (action === 'list') {
      let q = sb
        .from('appointment_call_bridges')
        .select('*')
        .order('appointment_time', { ascending: false })
        .limit(Number(body.limit) || 200);
      if (body.client_id) q = q.eq('client_id', body.client_id);
      if (body.start_date) q = q.gte('appointment_time', new Date(body.start_date).toISOString());
      if (body.end_date) {
        const end = new Date(body.end_date);
        end.setUTCDate(end.getUTCDate() + 1);
        q = q.lt('appointment_time', end.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      const count = (fn: (r: any) => boolean) => rows.filter(fn).length;
      return json({
        ok: true,
        bridges: rows,
        kpis: {
          total: rows.length,
          scheduled: count((r) => r.status === 'scheduled' || r.status === 'retry_user'),
          connected: count((r) => r.status === 'connected' || r.status === 'completed'),
          user_not_reached: count((r) => r.status === 'user_not_reached'),
          contact_not_reached: count((r) => r.status === 'contact_not_reached'),
          failed: count((r) => r.status === 'failed'),
        },
      });
    }

    if (action === 'timeline') {
      const { data, error } = await sb
        .from('appointment_call_bridge_events')
        .select('*')
        .eq('bridge_id', body.bridge_id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json({ ok: true, events: data || [] });
    }

    if (action === 'call_now') {
      const { data: bridge } = await sb
        .from('appointment_call_bridges')
        .select('*')
        .eq('id', body.bridge_id)
        .maybeSingle();
      if (!bridge) return json({ error: 'bridge not found' }, 404);
      const sid = await dialAssignedUser(sb, bridge as any);
      return json({ ok: true, user_call_sid: sid });
    }

    if (action === 'cancel') {
      const { data: bridge } = await sb
        .from('appointment_call_bridges')
        .select('*')
        .eq('id', body.bridge_id)
        .maybeSingle();
      if (!bridge) return json({ error: 'bridge not found' }, 404);
      for (const sid of [bridge.user_call_sid, bridge.contact_call_sid]) {
        if (sid) await hangupCall(sid).catch(() => undefined);
      }
      await sb
        .from('appointment_call_bridges')
        .update({ status: 'cancelled', ended_at: new Date().toISOString() })
        .eq('id', bridge.id);
      await logEvent(sb, bridge.id, 'cancelled', { detail: 'Cancelled by operator' });
      return json({ ok: true });
    }

    if (action === 'test_credentials') {
      const numbers = await twilioFetch('/IncomingPhoneNumbers.json?PageSize=20', undefined, 'GET');
      return json({
        ok: true,
        numbers: (numbers?.incoming_phone_numbers || []).map((n: any) => ({
          phone_number: n.phone_number,
          friendly_name: n.friendly_name,
          voice: n.capabilities?.voice,
        })),
      });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    const message = String((e as Error)?.message || e);
    console.error('[appointment-bridge-admin]', message);
    return json({ error: message }, 500);
  }
});