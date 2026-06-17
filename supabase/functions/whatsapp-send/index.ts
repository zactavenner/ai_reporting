import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Authenticated send-message endpoint. Forwards to the Baileys bridge.
// Body: { jid: string, message: string, session_label?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: claimsData, error: claimsErr } = await sb.auth.getClaims(
    authHeader.replace('Bearer ', '')
  );
  if (claimsErr || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { jid, message, session_label = 'default' } = await req.json();
    if (!jid || !message) {
      return new Response(JSON.stringify({ error: 'jid and message required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bridgeUrl = Deno.env.get('WHATSAPP_BRIDGE_URL');
    const bridgeToken = Deno.env.get('WHATSAPP_BRIDGE_TOKEN');
    if (!bridgeUrl || !bridgeToken) {
      return new Response(JSON.stringify({ error: 'Bridge not configured. Set WHATSAPP_BRIDGE_URL and WHATSAPP_BRIDGE_TOKEN.' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeToken}`,
      },
      body: JSON.stringify({ session_label, jid, message }),
    });
    const text = await res.text();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `bridge: ${res.status} ${text}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Optimistically record outbound (bridge will also webhook it back, but UI feels snappier)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: session } = await admin
      .from('whatsapp_sessions').select('id').eq('label', session_label).maybeSingle();
    if (session) {
      const phone = jid.includes('@s.whatsapp.net') ? '+' + jid.split('@')[0] : null;
      const { data: contact } = await admin
        .from('whatsapp_contacts')
        .upsert({
          session_id: session.id, jid,
          is_group: jid.endsWith('@g.us'),
          phone,
          display_name: phone ?? jid,
          last_message_at: new Date().toISOString(),
          last_message_preview: message.slice(0, 200),
        }, { onConflict: 'session_id,jid' })
        .select('id').single();
      await admin.from('whatsapp_messages').insert({
        session_id: session.id,
        contact_id: contact?.id ?? null,
        jid,
        direction: 'outbound',
        body: message,
        message_type: 'text',
        team_member_id: null,
        status: 'sent',
        wa_timestamp: new Date().toISOString(),
      });
    }

    return new Response(text || JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});