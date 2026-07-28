// Sends Jarvis alerts over WhatsApp to configured recipients.
// Body: { message: string, alert_type?: string, recipients?: string[] (E.164) }
// - If `recipients` is provided, sends to those numbers directly (still WhatsApp).
// - Otherwise loads active rows from `jarvis_alert_recipients` and filters by `alert_type`
//   ('all' matches anything).
// Uses the same bridge as whatsapp-send (WHATSAPP_BRIDGE_URL / WHATSAPP_BRIDGE_TOKEN).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

function toJid(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { message, alert_type = 'all', recipients } = await req.json();
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'message required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bridgeUrl = Deno.env.get('WHATSAPP_BRIDGE_URL');
    const bridgeToken = Deno.env.get('WHATSAPP_BRIDGE_TOKEN');
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: sessionRow } = await admin.from('whatsapp_sessions').select('id').eq('label', 'default').maybeSingle();
    const enqueue = async (phone: string, err: string) => {
      await admin.from('whatsapp_send_queue').insert({
        session_id: sessionRow?.id ?? null,
        jid: toJid(phone), phone, message,
        source: 'jarvis', alert_type,
        status: 'pending', last_error: err,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      });
    };

    let targets: string[] = [];
    if (Array.isArray(recipients) && recipients.length) {
      targets = recipients;
    } else {
      const { data, error } = await admin
        .from('jarvis_alert_recipients')
        .select('phone_e164, alert_types, active')
        .eq('active', true);
      if (error) throw error;
      targets = (data ?? [])
        .filter((r: any) => Array.isArray(r.alert_types) && (r.alert_types.includes('all') || r.alert_types.includes(alert_type)))
        .map((r: any) => r.phone_e164);
    }

    if (!targets.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0, note: 'no active recipients' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = await Promise.all(targets.map(async (phone) => {
      const jid = toJid(phone);
      if (!bridgeUrl || !bridgeToken) {
        await enqueue(phone, 'bridge not configured');
        return { phone, ok: false, queued: true, error: 'bridge not configured' };
      }
      try {
        const r = await fetch(`${bridgeUrl.replace(/\/$/, '')}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeToken}` },
          body: JSON.stringify({ jid, message }),
        });
        const text = await r.text();
        if (!r.ok) {
          await enqueue(phone, `bridge ${r.status}: ${text.slice(0, 500)}`);
          return { phone, ok: false, queued: true, status: r.status, error: text };
        }

        // Best-effort: log outbound to whatsapp_messages
        try {
          const { data: session } = await admin.from('whatsapp_sessions').select('id').eq('label', 'default').maybeSingle();
          if (session) {
            const { data: contact } = await admin.from('whatsapp_contacts').upsert({
              session_id: session.id, jid, is_group: false, phone,
              display_name: phone,
              last_message_at: new Date().toISOString(),
              last_message_preview: message.slice(0, 200),
            }, { onConflict: 'session_id,jid' }).select('id').single();
            await admin.from('whatsapp_messages').insert({
              session_id: session.id, contact_id: contact?.id ?? null,
              jid, direction: 'outbound', body: message,
              message_type: 'text', status: 'sent',
              sender_name: `Jarvis (${alert_type})`,
              wa_timestamp: new Date().toISOString(),
            });
          }
        } catch (_) { /* non-fatal */ }

        return { phone, ok: true };
      } catch (e) {
        await enqueue(phone, `bridge unreachable: ${(e as Error).message}`);
        return { phone, ok: false, queued: true, error: (e as Error).message };
      }
    }));

    return new Response(JSON.stringify({ ok: true, sent: results.filter(r => r.ok).length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});