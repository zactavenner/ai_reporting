// Nightly anomaly detector. Compares each active client's last 7d vs prior 28d on
// CPL, lead volume, show rate, and funded volume. Writes findings to ai_insights.
// Optionally Slack-pings clients with a risk score >= 70.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouterJSON } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pct(curr: number, prior: number) {
  if (!prior) return curr ? 100 : 0;
  return ((curr - prior) / prior) * 100;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SB_URL, SB_KEY);

    const today = new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const recentStart = new Date(today); recentStart.setDate(today.getDate() - 7);
    const priorStart = new Date(today); priorStart.setDate(today.getDate() - 35);
    const priorEnd = new Date(today); priorEnd.setDate(today.getDate() - 8);

    const { data: clients = [] } = await supabase
      .from("clients").select("id,name").in("status", ["active", "onboarding"]);

    const insights: any[] = [];
    const inserts: any[] = [];

    for (const c of clients || []) {
      const [recent, prior] = await Promise.all([
        supabase.rpc("get_client_source_metrics", {
          p_start_date: recentStart.toISOString(), p_end_date: today.toISOString(),
        }).then((r: any) => (r.data || []).find((x: any) => x.client_id === c.id)),
        supabase.rpc("get_client_source_metrics", {
          p_start_date: priorStart.toISOString(), p_end_date: priorEnd.toISOString(),
        }).then((r: any) => (r.data || []).find((x: any) => x.client_id === c.id)),
      ]);
      if (!recent || !prior) continue;

      const findings: any[] = [];
      const leadsCurr = Number(recent.total_leads || 0);
      const leadsPrior = Number(prior.total_leads || 0) / 4; // weekly-normalised prior
      const callsCurr = Number(recent.total_calls || 0);
      const callsPrior = Number(prior.total_calls || 0) / 4;
      const showCurr = callsCurr ? (Number(recent.showed_calls || 0) / callsCurr) * 100 : 0;
      const showPrior = callsPrior ? (Number(prior.showed_calls || 0) / callsPrior) * 100 : 0;
      const fundedCurr = Number(recent.funded_count || 0);
      const fundedPrior = Number(prior.funded_count || 0) / 4;

      const leadDelta = pct(leadsCurr, leadsPrior);
      const callDelta = pct(callsCurr, callsPrior);
      const showDelta = showCurr - showPrior;
      const fundedDelta = pct(fundedCurr, fundedPrior);

      let risk = 0;
      if (leadDelta < -50) { findings.push(`Leads down ${Math.abs(leadDelta).toFixed(0)}% vs 4-week avg`); risk += 30; }
      if (callDelta < -40) { findings.push(`Calls down ${Math.abs(callDelta).toFixed(0)}% vs 4-week avg`); risk += 25; }
      if (showDelta < -10) { findings.push(`Show rate dropped ${Math.abs(showDelta).toFixed(0)} points`); risk += 20; }
      if (fundedDelta < -50 && fundedPrior >= 1) { findings.push(`Funded volume down ${Math.abs(fundedDelta).toFixed(0)}%`); risk += 35; }
      if (leadDelta > 80) { findings.push(`Lead volume up ${leadDelta.toFixed(0)}% — scale opportunity`); }
      if (fundedDelta > 50 && fundedCurr >= 2) { findings.push(`Funded up ${fundedDelta.toFixed(0)}% — winners detected`); }

      if (!findings.length) continue;

      const severity = risk >= 50 ? "critical" : risk >= 25 ? "warning" : "info";
      insights.push({ client: c.name, risk, findings, recent, prior });
      inserts.push({
        client_id: c.id,
        category: risk > 0 ? "anomaly" : "commentary",
        severity,
        title: risk >= 50 ? `${c.name}: high-risk shift detected`
               : risk >= 25 ? `${c.name}: performance drift`
               : `${c.name}: notable change`,
        body: findings.map((f) => `• ${f}`).join("\n"),
        metrics: { risk_score: risk, lead_delta_pct: leadDelta, call_delta_pct: callDelta, show_delta_pts: showDelta, funded_delta_pct: fundedDelta },
      });
    }

    // Layer AI commentary on top of detections (one global pass)
    if (insights.length) {
      try {
        const { data } = await callOpenRouterJSON<{ commentary: string }>([
          { role: "system", content: "You are a sharp ad-ops analyst. Given anomaly findings for an investor-funnel agency, write 2-4 sentences of executive commentary. Compliance: no 'guaranteed'. JSON: {\"commentary\":\"...\"}." },
          { role: "user", content: JSON.stringify(insights).slice(0, 8000) },
        ], { temperature: 0.3 });
        if (data?.commentary) {
          inserts.push({
            client_id: null,
            category: "commentary",
            severity: "info",
            title: "Portfolio commentary",
            body: data.commentary,
            metrics: { client_count: insights.length },
          });
        }
      } catch (e) {
        console.warn("commentary AI failed", (e as Error).message);
      }
    }

    if (inserts.length) await supabase.from("ai_insights").insert(inserts);

    return new Response(JSON.stringify({ ok: true, generated: inserts.length, clients: insights.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});