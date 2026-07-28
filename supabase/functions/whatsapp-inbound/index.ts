import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Receives webhooks from the Baileys bridge.
// Auth: header `x-bridge-secret` must equal WHATSAPP_WEBHOOK_SECRET.
// Body shape (from bridge):
// {
//   event: 'message' | 'status' | 'qr' | 'connection',
//   session_label: string,
//   payload: { ... event-specific ... }
// }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const secret = req.headers.get('x-bridge-secret');
  if (!secret || secret !== Deno.env.get('WHATSAPP_WEBHOOK_SECRET')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    const { event, session_label = 'default', payload = {} } = body ?? {};

    // Resolve or create the session so bridge webhooks never fail because the seed row is missing.
    const { data: session } = await sb
      .from('whatsapp_sessions')
      .select('id')
      .eq('label', session_label)
      .maybeSingle();
    let sessionId = session?.id;
    if (!sessionId) {
      const { data: created, error: createError } = await sb
        .from('whatsapp_sessions')
        .insert({ label: session_label, status: 'connecting' })
        .select('id')
        .single();
      if (createError) throw createError;
      sessionId = created.id;
    }

    if (event === 'qr') {
      await sb.from('whatsapp_sessions').update({
        status: 'qr',
        last_qr: payload.qr ?? null,
        last_qr_at: new Date().toISOString(),
      }).eq('id', sessionId);
    } else if (event === 'connection') {
      const patch: Record<string, unknown> = {
        status: payload.status ?? 'disconnected',
        last_error: payload.error ?? null,
      };
      if (payload.status === 'connected') {
        patch.last_connected_at = new Date().toISOString();
        patch.last_qr = null;
        if (payload.phone_number) patch.phone_number = payload.phone_number;
      }
      await sb.from('whatsapp_sessions').update(patch).eq('id', sessionId);
    } else if (event === 'message') {
      const {
        jid, wa_message_id, direction = 'inbound', body: text, media_url,
        media_mime, message_type = 'text', sender_jid, sender_name,
        push_name, is_group = false, wa_timestamp, raw,
      } = payload;

      if (!jid) {
        return new Response(JSON.stringify({ error: 'jid required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const timestamp = typeof wa_timestamp === 'number'
        ? new Date(wa_timestamp * 1000).toISOString()
        : (typeof wa_timestamp === 'string' ? wa_timestamp : new Date().toISOString());

      // Upsert contact
      const phone = jid.includes('@s.whatsapp.net') ? '+' + jid.split('@')[0] : null;
      const { data: contact } = await sb
        .from('whatsapp_contacts')
        .upsert({
          session_id: sessionId,
          jid,
          is_group,
          phone,
          push_name: push_name ?? sender_name ?? null,
          display_name: push_name ?? sender_name ?? phone ?? jid,
          last_message_at: timestamp,
          last_message_preview: (text ?? `[${message_type}]`).slice(0, 200),
        }, { onConflict: 'session_id,jid' })
        .select('id, unread_count')
        .single();

      // Increment unread for inbound
      if (contact && direction === 'inbound') {
        await sb.from('whatsapp_contacts')
          .update({ unread_count: (contact.unread_count ?? 0) + 1 })
          .eq('id', contact.id);
      }

      const messageRecord = {
        session_id: sessionId,
        contact_id: contact?.id ?? null,
        jid,
        wa_message_id,
        direction,
        body: text ?? null,
        media_url: media_url ?? null,
        media_mime: media_mime ?? null,
        message_type,
        sender_jid: sender_jid ?? null,
        sender_name: sender_name ?? push_name ?? null,
        wa_timestamp: timestamp,
        status: direction === 'inbound' ? 'received' : 'sent',
        raw: raw ?? null,
      };
      if (wa_message_id) {
        await sb.from('whatsapp_messages').upsert(messageRecord, {
          onConflict: 'session_id,wa_message_id',
          ignoreDuplicates: false,
        });
      } else {
        await sb.from('whatsapp_messages').insert(messageRecord);
      }
    } else {
      return new Response(JSON.stringify({ error: `unknown event: ${event}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('whatsapp-inbound error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});