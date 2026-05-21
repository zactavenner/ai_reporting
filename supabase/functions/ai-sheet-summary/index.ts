import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseSheetUrl(url?: string | null): { sheet_id: string; gid?: string } | null {
  if (!url) return null;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) return null;
  const g = url.match(/[#?&]gid=(\d+)/);
  return { sheet_id: m[1], gid: g?.[1] };
}

function shiftRange(start?: string, end?: string): { start?: string; end?: string } {
  if (!start || !end) return {};
  const s = new Date(start); const e = new Date(end);
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  const ps = new Date(s); ps.setDate(ps.getDate() - days);
  const pe = new Date(s); pe.setDate(pe.getDate() - 1);
  return { start: ps.toISOString().slice(0, 10), end: pe.toISOString().slice(0, 10) };
}

async function fetchAggregated(SUPABASE_URL: string, SERVICE_KEY: string, sheet_id: string, gid: string | undefined, start?: string, end?: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-sheet-metrics`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', apikey: SERVICE_KEY },
    body: JSON.stringify({ sheet_id, gid, start_date: start, end_date: end }),
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.aggregated ?? null;
}

async function fetchAudit(SUPABASE_URL: string, SERVICE_KEY: string, client_id: string) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/agent-sheet-audit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', apikey: SERVICE_KEY },
      body: JSON.stringify({ client_id, scope: 'client' }),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    return j ? { quality_score: j.quality_score, spam_count: j.spam_count, quality_issue_count: j.quality_issue_count, accuracy: j.accuracy } : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { client_id, start_date, end_date, include_audit = true } = body || {};
    const prior = shiftRange(start_date, end_date);

    type Pack = { name: string; current: any; prior: any; audit: any };
    const packs: Pack[] = [];

    if (client_id) {
      const { data: c } = await supabase.from('clients').select('id,name').eq('id', client_id).maybeSingle();
      const { data: s } = await supabase.from('client_settings').select('kpi_google_sheet_url').eq('client_id', client_id).maybeSingle();
      const parsed = parseSheetUrl((s as any)?.kpi_google_sheet_url);
      if (!parsed) return new Response(JSON.stringify({ error: 'No KPI sheet configured for this client' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const [current, priorAgg, audit] = await Promise.all([
        fetchAggregated(SUPABASE_URL, SERVICE_KEY, parsed.sheet_id, parsed.gid, start_date, end_date),
        prior.start ? fetchAggregated(SUPABASE_URL, SERVICE_KEY, parsed.sheet_id, parsed.gid, prior.start, prior.end) : Promise.resolve(null),
        include_audit ? fetchAudit(SUPABASE_URL, SERVICE_KEY, client_id) : Promise.resolve(null),
      ]);
      packs.push({ name: c?.name || 'Client', current, prior: priorAgg, audit });
    } else {
      const { data: clients } = await supabase.from('clients').select('id,name').in('status', ['active', 'onboarding', 'paused']);
      const { data: settings } = await supabase.from('client_settings').select('client_id,kpi_google_sheet_url').not('kpi_google_sheet_url', 'is', null);
      const sMap = new Map<string, string>();
      (settings || []).forEach((r: any) => sMap.set(r.client_id, r.kpi_google_sheet_url));
      const eligible = (clients || []).filter((c: any) => sMap.has(c.id)).slice(0, 25);
      const results = await Promise.all(eligible.map(async (c: any) => {
        const parsed = parseSheetUrl(sMap.get(c.id));
        if (!parsed) return null;
        const [current, priorAgg] = await Promise.all([
          fetchAggregated(SUPABASE_URL, SERVICE_KEY, parsed.sheet_id, parsed.gid, start_date, end_date),
          prior.start ? fetchAggregated(SUPABASE_URL, SERVICE_KEY, parsed.sheet_id, parsed.gid, prior.start, prior.end) : null,
        ]);
        return { name: c.name, current, prior: priorAgg, audit: null };
      }));
      results.forEach((r) => { if (r) packs.push(r as Pack); });
    }

    if (packs.length === 0) {
      return new Response(JSON.stringify({ error: 'No sheet data available' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const systemPrompt = `You are a performance analyst for a paid-ads & investor-funnel agency.
Analyze Google Sheet KPI data and produce a crisp executive summary in markdown.
Compliance: never use the word "guaranteed". Refer to investment outcomes as "targeted" / historical.
Always include these sections:
## TL;DR  (2-3 sentences)
## Performance Trends  (current vs prior period with % deltas; decreased cost = good, increased volume = good)
## Data Quality & Spam  (call out missing email/phone, spam %, accuracy delta if provided)
## Recommendations  (3-5 concrete actions: scale, kill, fix tracking, etc.)
Be specific with numbers. Skip filler.`;

    const userPayload = {
      date_range: { start: start_date, end: end_date },
      prior_range: prior,
      clients: packs,
    };

    const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
        temperature: 0.3,
      }),
    });
    if (aiRes.status === 429) return new Response(JSON.stringify({ error: 'Rate limit exceeded, please retry shortly.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (aiRes.status === 402) return new Response(JSON.stringify({ error: 'AI credits exhausted. Add funds in Settings → Workspace → Usage.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      throw new Error(`AI gateway error ${aiRes.status}: ${t}`);
    }
    const aiJson = await aiRes.json();
    const summary = aiJson?.choices?.[0]?.message?.content || '';

    return new Response(JSON.stringify({
      success: true,
      summary,
      clients_analyzed: packs.length,
      data: packs,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('ai-sheet-summary error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});