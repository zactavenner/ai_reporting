// Drains pending/failed WhatsApp sends. Called by pg_cron every 2 minutes and
// on-demand from the Health tab. Uses exponential backoff (2m, 5m, 15m, 1h, 6h)
// and marks rows 'dead' after max_attempts.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const BACKOFF_MINUTES = [2, 5, 15, 60, 360];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const bridgeUrl = Deno.env.get('WHATSAPP_BRIDGE_URL');
  const bridgeToken = Deno.env.get('WHATSAPP_BRIDGE_TOKEN');

  // Only try to drain if session appears connected — otherwise leave queued.
  const { data: session } = await admin
    .from('whatsapp_sessions').select('id, status').eq('label', 'default').maybeSingle();

  if (!bridgeUrl || !bridgeToken) {
    return new Response(JSON.stringify({ ok: true, skipped: 'bridge not configured' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  if (session?.status !== 'connected') {
    return new Response(JSON.stringify({ ok: true, skipped: `session ${session?.status ?? 'missing'}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const nowIso = new Date().toISOString();
  const { data: due } = await admin
    .from('whatsapp_send_queue')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(50);

  const results: any[] = [];
  for (const row of (due || [])) {
    // Claim
    const { data: claimed } = await admin
      .from('whatsapp_send_queue')
      .update({ status: 'sending', last_attempt_at: nowIso })
      .eq('id', row.id).in('status', ['pending', 'failed'])
      .select('id').maybeSingle();
    if (!claimed) continue;

    try {
      const r = await fetch(`${bridgeUrl.replace(/\/$/, '')}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeToken}` },
        body: JSON.stringify({ jid: row.jid, message: row.message }),
      });
      const text = await r.text();
      if (r.ok) {
        await admin.from('whatsapp_send_queue').update({
          status: 'sent', sent_at: new Date().toISOString(), last_error: null,
          attempts: row.attempts + 1,
        }).eq('id', row.id);

        // Log outbound message
        if (session?.id) {
          const { data: contact } = await admin.from('whatsapp_contacts').upsert({
            session_id: session.id, jid: row.jid,
            is_group: row.jid.endsWith('@g.us'),
            phone: row.phone,
            display_name: row.phone ?? row.jid,
            last_message_at: new Date().toISOString(),
            last_message_preview: row.message.slice(0, 200),
          }, { onConflict: 'session_id,jid' }).select('id').single();
          await admin.from('whatsapp_messages').insert({
            session_id: session.id, contact_id: contact?.id ?? null,
            jid: row.jid, direction: 'outbound', body: row.message,
            message_type: 'text', status: 'sent',
            sender_name: row.source === 'jarvis' ? `Jarvis (${row.alert_type ?? 'all'})` : null,
            wa_timestamp: new Date().toISOString(),
          });
        }
        results.push({ id: row.id, ok: true });
      } else {
        const attempts = row.attempts + 1;
        const dead = attempts >= row.max_attempts;
        const idx = Math.min(attempts - 1, BACKOFF_MINUTES.length - 1);
        await admin.from('whatsapp_send_queue').update({
          status: dead ? 'dead' : 'failed',
          attempts,
          last_error: `bridge ${r.status}: ${text.slice(0, 500)}`,
          next_attempt_at: dead ? row.next_attempt_at
            : new Date(Date.now() + BACKOFF_MINUTES[idx] * 60_000).toISOString(),
        }).eq('id', row.id);
        results.push({ id: row.id, ok: false, status: r.status });
      }
    } catch (e) {
      const attempts = row.attempts + 1;
      const dead = attempts >= row.max_attempts;
      const idx = Math.min(attempts - 1, BACKOFF_MINUTES.length - 1);
      await admin.from('whatsapp_send_queue').update({
        status: dead ? 'dead' : 'failed',
        attempts,
        last_error: `unreachable: ${(e as Error).message}`,
        next_attempt_at: dead ? row.next_attempt_at
          : new Date(Date.now() + BACKOFF_MINUTES[idx] * 60_000).toISOString(),
      }).eq('id', row.id);
      results.push({ id: row.id, ok: false, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({
    ok: true, drained: results.length,
    succeeded: results.filter(r => r.ok).length,
    results,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});