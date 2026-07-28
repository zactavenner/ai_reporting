import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyDashboardToken, readDashboardToken } from '../_shared/dashboardToken.ts';

// Proxies live status from the bridge (current QR, connection state).
// Body: { session_label?: string, action?: 'status' | 'logout' | 'reset' }
// Auth: accepts either a Supabase Auth Bearer token OR the custom
// x-dashboard-token / body.dashboard_session_token issued by verify-password.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let body: any = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
    const { session_label = 'default', action = 'status' } = body;

    // Accept either a Supabase Auth Bearer OR the dashboard HMAC token.
    const authHeader = req.headers.get('Authorization');
    const dashboardToken = readDashboardToken(req, body);
    const dashboardMember = await verifyDashboardToken(dashboardToken);
    if (!dashboardMember && !authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!['status', 'logout', 'reset'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Get-or-create the session row up-front so callers always get a full row.
    let { data: sessionRow } = await admin
      .from('whatsapp_sessions').select('*').eq('label', session_label).maybeSingle();
    if (!sessionRow) {
      const { data: created } = await admin.from('whatsapp_sessions')
        .insert({ label: session_label, status: 'disconnected' })
        .select('*').single();
      sessionRow = created;
    }

    const bridgeUrl = Deno.env.get('WHATSAPP_BRIDGE_URL');
    const bridgeToken = Deno.env.get('WHATSAPP_BRIDGE_TOKEN');
    if (!bridgeUrl || !bridgeToken) {
      return new Response(JSON.stringify({
        ok: false,
        configured: false,
        session: sessionRow,
        message: 'Bridge not configured. Deploy the bridge and add WHATSAPP_BRIDGE_URL / WHATSAPP_BRIDGE_TOKEN secrets.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const url = `${bridgeUrl.replace(/\/$/, '')}/${action}?session_label=${encodeURIComponent(session_label)}`;
    const res = await fetch(url, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${bridgeToken}` },
    });
    const text = await res.text();
    let live: any = {};
    try { live = text ? JSON.parse(text) : {}; } catch { live = { raw: text }; }

    if (action === 'status' && res.ok) {
      const patch: Record<string, unknown> = {
        status: live.status ?? 'disconnected',
        phone_number: live.phone_number || sessionRow?.phone_number || null,
        last_qr: live.qr || null,
        last_qr_at: live.qr_at || (live.qr ? new Date().toISOString() : sessionRow?.last_qr_at),
        last_error: live.error || null,
        bridge_meta: live,
      };
      if (live.status === 'connected') patch.last_connected_at = new Date().toISOString();
      const { data: updated } = await admin.from('whatsapp_sessions')
        .update(patch).eq('id', sessionRow!.id).select('*').single();
      sessionRow = updated ?? { ...sessionRow, ...patch };
    } else if (action !== 'status') {
      const patch: Record<string, unknown> = {
        status: 'connecting',
        last_qr: null,
        last_qr_at: null,
        last_error: res.ok ? null : `bridge ${res.status}: ${text.slice(0, 400)}`,
      };
      if (action === 'reset') patch.phone_number = null;
      const { data: updated } = await admin.from('whatsapp_sessions')
        .update(patch).eq('id', sessionRow!.id).select('*').single();
      sessionRow = updated ?? { ...sessionRow, ...patch };
    }

    return new Response(JSON.stringify({
      ok: res.ok,
      configured: true,
      status: live.status ?? sessionRow?.status,
      phone_number: live.phone_number ?? sessionRow?.phone_number,
      qr: live.qr ?? sessionRow?.last_qr,
      qr_at: live.qr_at ?? sessionRow?.last_qr_at,
      error: live.error ?? null,
      session: sessionRow,
      bridge: live,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});