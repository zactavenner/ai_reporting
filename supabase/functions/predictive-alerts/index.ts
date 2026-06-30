import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

// Linear regression slope on the last 14 daily points to predict next 7 days.
function slope(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (values[i] - yMean); den += (i - xMean) ** 2; }
  return den === 0 ? 0 : num / den;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { data: clients } = await sb.from('clients').select('id, name').eq('status', 'active');
    const alerts: any[] = [];
    const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);

    for (const c of clients || []) {
      const { data: metrics } = await sb
        .from('daily_metrics')
        .select('date, spend, leads_count, calls_booked, calls_showed, funded_count, funded_dollars')
        .eq('client_id', c.id)
        .gte('date', since)
        .order('date', { ascending: true });
      if (!metrics || metrics.length < 5) continue;

      const series = {
        cpl: metrics.map((m: any) => (m.leads_count > 0 ? Number(m.spend) / Number(m.leads_count) : 0)),
        leads: metrics.map((m: any) => Number(m.leads_count || 0)),
        show_rate: metrics.map((m: any) => (m.calls_booked > 0 ? Number(m.calls_showed) / Number(m.calls_booked) : 0)),
        funded: metrics.map((m: any) => Number(m.funded_dollars || 0)),
      };

      const checks: Array<{ key: string; label: string; severity: string; risk: number; forecast: string }> = [];

      const cplSlope = slope(series.cpl.filter(v => v > 0));
      const recentCpl = series.cpl.slice(-3).reduce((a, b) => a + b, 0) / 3;
      if (cplSlope > 0 && recentCpl > 0) {
        const pct = (cplSlope * 7) / recentCpl;
        if (pct > 0.15) checks.push({
          key: 'cpl_rising', label: 'CPL rising fast', severity: pct > 0.35 ? 'critical' : 'warning',
          risk: Math.min(100, Math.round(pct * 200)),
          forecast: `CPL projected to rise ~${Math.round(pct * 100)}% over next 7 days (now $${recentCpl.toFixed(2)})`,
        });
      }

      const leadsSlope = slope(series.leads);
      const recentLeads = series.leads.slice(-3).reduce((a, b) => a + b, 0) / 3;
      if (leadsSlope < 0 && recentLeads > 0) {
        const pct = Math.abs(leadsSlope * 7) / recentLeads;
        if (pct > 0.2) checks.push({
          key: 'leads_dropping', label: 'Lead volume dropping', severity: pct > 0.4 ? 'critical' : 'warning',
          risk: Math.min(100, Math.round(pct * 150)),
          forecast: `Daily leads projected to drop ~${Math.round(pct * 100)}% over next 7 days`,
        });
      }

      const showSlope = slope(series.show_rate.filter(v => v > 0));
      const recentShow = series.show_rate.slice(-3).reduce((a, b) => a + b, 0) / 3;
      if (showSlope < 0 && recentShow > 0) {
        const pct = Math.abs(showSlope * 7) / recentShow;
        if (pct > 0.1) checks.push({
          key: 'show_rate_declining', label: 'Show rate declining', severity: 'warning',
          risk: Math.min(100, Math.round(pct * 150)),
          forecast: `Show rate trending down (~${Math.round(pct * 100)}% over next week)`,
        });
      }

      for (const ck of checks) {
        alerts.push({ client_id: c.id, client_name: c.name, ...ck });
        await sb.from('ai_insights').insert({
          client_id: c.id,
          category: 'prediction',
          severity: ck.severity,
          title: `${ck.label} — ${c.name}`,
          body: ck.forecast,
          metrics: { risk_score: ck.risk, key: ck.key },
        });
      }
    }

    // Generate plain-English summary
    let summary = '';
    if (alerts.length && KEY) {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: "nvidia/nemotron-3-ultra-550b-a55b:free",
          messages: [
            { role: 'system', content: 'You are an investment marketing analyst. Be terse and executive.' },
            { role: 'user', content: `Summarize these predictive risks in 4 bullet points for the CEO:\n${JSON.stringify(alerts, null, 2)}` },
          ],
        }),
      });
      if (r.ok) summary = (await r.json()).choices?.[0]?.message?.content || '';
    }

    return new Response(JSON.stringify({ ok: true, count: alerts.length, alerts, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});