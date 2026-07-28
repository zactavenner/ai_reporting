import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Proxies live status from the bridge (current QR, connection state).
// Body: { session_label?: string, action?: 'status' | 'logout' | 'reset' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { session_label = 'default', action = 'status' } =
      req.method === 'POST' ? await req.json() : {};

    if (!['status', 'logout', 'reset'].includes(action)) {
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bridgeUrl = Deno.env.get('WHATSAPP_BRIDGE_URL');
    const bridgeToken = Deno.env.get('WHATSAPP_BRIDGE_TOKEN');
    if (!bridgeUrl || !bridgeToken) {
      return new Response(JSON.stringify({
        ok: false,
        configured: false,
        message: 'Bridge not configured. Deploy the bridge and add WHATSAPP_BRIDGE_URL / WHATSAPP_BRIDGE_TOKEN secrets.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const url = `${bridgeUrl.replace(/\/$/, '')}/${action}?session_label=${encodeURIComponent(session_label)}`;
    const res = await fetch(url, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${bridgeToken}` },
    });
    const text = await res.text();

    if (action === 'status' && res.ok) {
      try {
        const live = text ? JSON.parse(text) : {};
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        const patch = {
          label: session_label,
          status: live.status ?? 'disconnected',
          phone_number: live.phone_number || null,
          last_qr: live.qr || null,
          last_qr_at: live.qr_at || null,
          last_error: live.error || null,
          bridge_meta: live,
        };
        const { data: existing } = await admin
          .from('whatsapp_sessions')
          .select('id, last_connected_at')
          .eq('label', session_label)
          .maybeSingle();
        if (existing?.id) {
          await admin.from('whatsapp_sessions').update({
            ...patch,
            last_connected_at: live.status === 'connected'
              ? new Date().toISOString()
              : existing.last_connected_at,
          }).eq('id', existing.id);
        } else {
          await admin.from('whatsapp_sessions').insert({
            ...patch,
            last_connected_at: live.status === 'connected' ? new Date().toISOString() : null,
          });
        }
      } catch (e) {
        console.error('status persist failed', e);
      }
    }

    return new Response(text, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});