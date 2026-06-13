import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

/**
 * Smart cross-resource search. Uses AI to expand the natural query into
 * keywords, runs ILIKE across calls (transcripts), tasks, contacts, deals,
 * client_assets, then ranks with AI.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { query, client_id } = await req.json();
    if (!query) throw new Error('query required');

    // 1) Expand query to keywords via AI
    let keywords: string[] = [query];
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: "openrouter/owl-alpha",
          messages: [{ role: 'user', content: `Return JSON {"keywords": ["..."]} of 3–6 alternative phrasings and synonyms for: ${query}` }],
          response_format: { type: 'json_object' },
        }),
      });
      if (r.ok) {
        const k = JSON.parse((await r.json()).choices[0].message.content).keywords;
        if (Array.isArray(k)) keywords = [query, ...k].slice(0, 6);
      }
    } catch {}

    const orFilter = (col: string) => keywords.map(k => `${col}.ilike.%${k.replace(/[%,]/g, '')}%`).join(',');

    const calls = sb.from('calls').select('id, client_id, contact_name, contact_email, booked_at, summary, transcript').or(`${orFilter('summary')},${orFilter('transcript')},${orFilter('contact_name')}`).limit(15);
    const tasks = sb.from('tasks').select('id, client_id, title, description, status, due_date').or(`${orFilter('title')},${orFilter('description')}`).limit(15);
    const deals = sb.from('deals').select('id, client_id, name, notes, stage, value').or(`${orFilter('name')},${orFilter('notes')}`).limit(10);
    const assets = sb.from('client_assets').select('id, client_id, kind, title, content').or(`${orFilter('title')},${orFilter('content')}`).limit(10);

    let [c, t, d, a]: any[] = await Promise.all([calls, tasks, deals, assets]);
    if (client_id) {
      const f = (arr: any) => ({ ...arr, data: (arr.data || []).filter((x: any) => x.client_id === client_id) });
      c = f(c); t = f(t); d = f(d); a = f(a);
    }

    const results = {
      calls: c.data || [], tasks: t.data || [], deals: d.data || [], assets: a.data || [],
    };

    // 2) AI synthesis
    let answer = '';
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: "openrouter/owl-alpha",
          messages: [
            { role: 'system', content: 'You answer questions using only the JSON evidence provided. Cite source IDs.' },
            { role: 'user', content: `Question: ${query}\n\nEvidence:\n${JSON.stringify(results).slice(0, 30000)}` },
          ],
        }),
      });
      if (r.ok) answer = (await r.json()).choices?.[0]?.message?.content || '';
    } catch {}

    return new Response(JSON.stringify({ ok: true, keywords, answer, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});