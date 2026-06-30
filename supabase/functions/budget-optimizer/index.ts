import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

/**
 * For a client, look at active campaigns' last 14d performance, compute CoC,
 * and propose daily budget reallocation. Returns recommendations only (no auto-push).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { client_id } = await req.json();
    if (!client_id) throw new Error('client_id required');

    const { data: campaigns } = await sb
      .from('meta_campaigns')
      .select('id, name, status, daily_budget, spend, attributed_leads, attributed_funded, attributed_funded_dollars, cost_per_lead, cost_per_funded')
      .eq('client_id', client_id)
      .order('spend', { ascending: false })
      .limit(50);

    const active = (campaigns || []).filter((c: any) => c.status === 'ACTIVE' || c.status === 'active');
    if (!active.length) return new Response(JSON.stringify({ ok: true, recommendations: [], summary: 'No active campaigns.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Score each campaign by CoC% (funded_dollars / spend), default to 0
    const totalSpend = active.reduce((s, c: any) => s + Number(c.spend || 0), 0);
    const scored = active.map((c: any) => {
      const coc = c.spend > 0 ? Number(c.attributed_funded_dollars || 0) / Number(c.spend) : 0;
      return { id: c.id, name: c.name, daily_budget: Number(c.daily_budget || 0), spend: Number(c.spend || 0), coc, cpl: Number(c.cost_per_lead || 0), cpf: Number(c.cost_per_funded || 0) };
    });

    const prompt = `You are a senior media buyer. Given these Meta campaigns (last 14d), propose a daily budget reallocation that improves overall CoC. Keep total daily budget within ±10% of current. Return JSON.

Current campaigns:
${JSON.stringify(scored, null, 2)}

Return: { "recommendations": [ { "campaign_id": "...", "name": "...", "current_daily_budget": N, "recommended_daily_budget": N, "delta": N, "rationale": "..." } ], "summary": "1-paragraph executive summary" }`;

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra:free",
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) throw new Error(`AI ${r.status}: ${await r.text()}`);
    const parsed = JSON.parse((await r.json()).choices[0].message.content);

    return new Response(JSON.stringify({ ok: true, total_current_spend: totalSpend, ...parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});