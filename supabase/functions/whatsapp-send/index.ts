import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Authenticated send-message endpoint. Forwards to the whatsmeow bridge.
// Body: { jid: string, message: string, session_label?: string, source?: string, alert_type?: string, client_id?: string, task_id?: string }
// On bridge failure (unpaired, network, 5xx) the message is enqueued into
// `whatsapp_send_queue` and will be retried by whatsapp-queue-drain.

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

  const token = authHeader.replace('Bearer ', '');
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { jid, message, session_label = 'default',
            source = 'manual', alert_type = null, client_id = null, task_id = null } = body;
    if (!jid || !message) {
      return new Response(JSON.stringify({ error: 'jid and message required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const { data: session } = await admin
      .from('whatsapp_sessions').select('id').eq('label', session_label).maybeSingle();

    const phone = jid.includes('@s.whatsapp.net') ? '+' + jid.split('@')[0] : null;
    const enqueue = async (err: string) => {
      await admin.from('whatsapp_send_queue').insert({
        session_id: session?.id ?? null, jid, phone, message,
        source, alert_type, client_id, task_id,
        status: 'pending', last_error: err,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      });
    };

    const bridgeUrl = Deno.env.get('WHATSAPP_BRIDGE_URL');
    const bridgeToken = Deno.env.get('WHATSAPP_BRIDGE_TOKEN');
    if (!bridgeUrl || !bridgeToken) {
      await enqueue('bridge not configured');
      return new Response(JSON.stringify({ ok: false, queued: true, error: 'Bridge not configured — message queued.' }), {
        status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let res: Response;
    let text = '';
    let waMessageId: string | null = null;
    try {
      res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeToken}` },
        body: JSON.stringify({ session_label, jid, message }),
      });
      text = await res.text();
      try {
        const parsed = text ? JSON.parse(text) : null;
        if (typeof parsed?.wa_message_id === 'string') waMessageId = parsed.wa_message_id;
      } catch (_) {
        // Non-JSON bridge responses are handled by status checks below.
      }
    } catch (e) {
      await enqueue(`bridge unreachable: ${(e as Error).message}`);
      return new Response(JSON.stringify({ ok: false, queued: true, error: 'Bridge unreachable — queued for retry.' }), {
        status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!res.ok) {
      await enqueue(`bridge ${res.status}: ${text.slice(0, 500)}`);
      return new Response(JSON.stringify({ ok: false, queued: true, error: `Bridge ${res.status} — queued for retry.` }), {
        status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Optimistically record outbound
    if (session) {
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
      const outboundMessage = {
        session_id: session.id,
        contact_id: contact?.id ?? null,
        jid,
        wa_message_id: waMessageId,
        direction: 'outbound',
        body: message,
        message_type: 'text',
        team_member_id: null,
        status: 'sent',
        wa_timestamp: new Date().toISOString(),
      };
      if (waMessageId) {
        await admin.from('whatsapp_messages').upsert(outboundMessage, {
          onConflict: 'session_id,wa_message_id',
          ignoreDuplicates: false,
        });
      } else {
        await admin.from('whatsapp_messages').insert(outboundMessage);
      }
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