import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const FIRECRAWL = Deno.env.get('FIRECRAWL_API_KEY');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

/**
 * Pull a competitor's landing page (via Firecrawl), summarize positioning,
 * offer, hooks, CTAs, and ad angles vs. a given client. Stores result in ai_insights.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { client_id, competitor_url, competitor_name } = await req.json();
    if (!competitor_url) throw new Error('competitor_url required');

    // Scrape
    let pageContent = '';
    if (FIRECRAWL) {
      const fr = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FIRECRAWL}` },
        body: JSON.stringify({ url: competitor_url, formats: ['markdown'] }),
      });
      if (fr.ok) pageContent = ((await fr.json()).data?.markdown || '').slice(0, 20000);
    }
    if (!pageContent) {
      const direct = await fetch(competitor_url).then(r => r.text()).catch(() => '');
      pageContent = direct.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 12000);
    }

    // Client context for comparison
    let clientOffer = '';
    if (client_id) {
      const { data: client } = await sb.from('clients').select('name, niche, target_audience').eq('id', client_id).maybeSingle();
      const { data: offers } = await sb.from('client_offers').select('name, hook, headline, body').eq('client_id', client_id).limit(3);
      clientOffer = JSON.stringify({ client, offers });
    }

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        messages: [{ role: 'user', content: `Analyze this competitor's landing page and produce a strategic intel report.

Competitor: ${competitor_name || competitor_url}
Page content:
${pageContent}

Our client (for comparison): ${clientOffer || '(not specified)'}

Return JSON: {
  "positioning": "...",
  "primary_offer": "...",
  "hooks": ["..."],
  "ctas": ["..."],
  "social_proof": ["..."],
  "risk_disclaimers": "present|absent|partial",
  "swot_vs_client": { "their_strength": "...", "their_weakness": "...", "our_opportunity": "..." },
  "recommended_counter_angles": ["..."]
}` }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) throw new Error(`AI ${r.status}: ${await r.text()}`);
    const intel = JSON.parse((await r.json()).choices[0].message.content);

    if (client_id) {
      await sb.from('ai_insights').insert({
        client_id,
        category: 'competitive',
        severity: 'info',
        title: `Competitor intel: ${competitor_name || competitor_url}`,
        body: intel.positioning || '',
        metrics: { url: competitor_url, intel },
      });
    }

    return new Response(JSON.stringify({ ok: true, intel }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});