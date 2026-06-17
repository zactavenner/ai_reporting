import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

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