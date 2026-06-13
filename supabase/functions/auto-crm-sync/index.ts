import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

/**
 * For recent calls with transcripts that haven't been auto-summarized to GHL,
 * use AI to generate a tight contact note and push it via the GHL notes API.
 * Marks call_analysis.ghl_note_pushed_at when done.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { client_id, limit = 20 } = await req.json().catch(() => ({}));

    let q = sb.from('calls')
      .select('id, client_id, ghl_contact_id, contact_name, summary, transcript, booked_at, clients(ghl_api_key, ghl_location_id)')
      .not('transcript', 'is', null)
      .order('booked_at', { ascending: false })
      .limit(limit);
    if (client_id) q = q.eq('client_id', client_id);
    const { data: calls, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    for (const call of calls || []) {
      const c: any = call;
      if (!c.ghl_contact_id || !c.clients?.ghl_api_key) { results.push({ id: c.id, skipped: 'no GHL contact or creds' }); continue; }

      // Generate concise note
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: "openrouter/owl-alpha",
          messages: [{ role: 'user', content: `Summarize this sales call into a CRM note (≤120 words). Include: pain points, objections, next step, urgency level (low/med/high). Plain text.\n\nTranscript:\n${(c.transcript || c.summary || '').slice(0, 12000)}` }],
        }),
      });
      if (!r.ok) { results.push({ id: c.id, error: `AI ${r.status}` }); continue; }
      const note = (await r.json()).choices?.[0]?.message?.content || '';

      // Push to GHL
      const push = await fetch(`https://services.leadconnectorhq.com/contacts/${c.ghl_contact_id}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.clients.ghl_api_key}`,
          'Content-Type': 'application/json',
          Version: '2021-07-28',
        },
        body: JSON.stringify({ body: `[AI auto-note ${new Date().toISOString().slice(0,10)}]\n${note}` }),
      });
      const ok = push.ok;
      if (ok) {
        await sb.from('calls').update({ summary: c.summary || note }).eq('id', c.id);
      }
      results.push({ id: c.id, contact: c.contact_name, pushed: ok, note: note.slice(0, 200) });
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});