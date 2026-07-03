import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Weekly Report Generator v2 — replaces the Google Sheets weekly reporting
 * with DB-accurate numbers while keeping the sheet's editability.
 *
 * For a client + week (Mon–Sun), computes from the source-of-truth tables:
 *   ad_spend, leads, cpl, booked_calls, cost_per_booked, showed_calls,
 *   cost_per_showed, show_rate_pct, committed, commitment_dollars,
 *   funded, funded_dollars, cost_of_capital_pct
 * Plus:
 *   question_breakdown  — GHL form answers (leads.questions jsonb) aggregated
 *   disposition_breakdown — pipeline_status counts for leads created that week
 *
 * Upserts into weekly_reports. Human overrides are PRESERVED on regeneration:
 * only the `computed` value of each metric is refreshed; `override` and `note`
 * survive. Custom rows are never touched.
 *
 * Body: { clientId, weekStart? (Monday yyyy-mm-dd; default last Monday),
 *         allClients?: true, weeks?: 1 }
 */

function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  const m = new Date(d);
  m.setUTCDate(m.getUTCDate() - diff);
  m.setUTCHours(0, 0, 0, 0);
  return m;
}
const iso = (d: Date) => d.toISOString().split("T")[0];

async function generateForWeek(supabase: any, clientId: string, weekStartStr: string) {
  const weekStart = new Date(`${weekStartStr}T00:00:00Z`);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekEndStr = iso(weekEnd);
  const rangeStart = `${weekStartStr}T00:00:00Z`;
  const rangeEnd = `${weekEndStr}T23:59:59Z`;

  // ── 1. daily_metrics aggregation (Meta spend is already synced here) ──
  const { data: dm, error: dmErr } = await supabase
    .from("daily_metrics")
    .select("ad_spend, leads, calls, showed_calls, commitments, commitment_dollars, funded_investors, funded_dollars")
    .eq("client_id", clientId)
    .gte("date", weekStartStr)
    .lte("date", weekEndStr);
  if (dmErr) throw new Error(`daily_metrics: ${dmErr.message}`);

  const t = (dm || []).reduce((a: any, r: any) => ({
    spend: a.spend + (Number(r.ad_spend) || 0),
    leads: a.leads + (Number(r.leads) || 0),
    calls: a.calls + (Number(r.calls) || 0),
    showed: a.showed + (Number(r.showed_calls) || 0),
    commits: a.commits + (Number(r.commitments) || 0),
    commitDollars: a.commitDollars + (Number(r.commitment_dollars) || 0),
    funded: a.funded + (Number(r.funded_investors) || 0),
    fundedDollars: a.fundedDollars + (Number(r.funded_dollars) || 0),
  }), { spend: 0, leads: 0, calls: 0, showed: 0, commits: 0, commitDollars: 0, funded: 0, fundedDollars: 0 });

  // ── 2. Question + disposition breakdowns from leads created this week ──
  const questionBreakdown: Record<string, Record<string, number>> = {};
  const dispositionBreakdown: Record<string, number> = {};
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: leads, error: lErr } = await supabase
      .from("leads")
      .select("questions, custom_fields, pipeline_status, is_spam")
      .eq("client_id", clientId)
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .range(from, from + PAGE - 1);
    if (lErr) throw new Error(`leads: ${lErr.message}`);
    for (const lead of leads || []) {
      if (lead.is_spam) {
        dispositionBreakdown["spam"] = (dispositionBreakdown["spam"] || 0) + 1;
        continue;
      }
      const status = lead.pipeline_status || "new";
      dispositionBreakdown[status] = (dispositionBreakdown[status] || 0) + 1;

      // questions may be [{question, answer}] (webhook shape) or custom_fields {name: value}
      const qa: Array<{ q: string; a: string }> = [];
      if (Array.isArray(lead.questions)) {
        for (const item of lead.questions) {
          const q = item?.question || item?.q || item?.name;
          const a = item?.answer || item?.a || item?.value;
          if (q && a !== undefined && a !== null && `${a}`.trim() !== "") qa.push({ q: `${q}`, a: `${a}` });
        }
      }
      if (lead.custom_fields && typeof lead.custom_fields === "object" && !Array.isArray(lead.custom_fields)) {
        for (const [q, a] of Object.entries(lead.custom_fields)) {
          if (a !== undefined && a !== null && `${a}`.trim() !== "") qa.push({ q, a: `${a}` });
        }
      }
      for (const { q, a } of qa) {
        if (!questionBreakdown[q]) questionBreakdown[q] = {};
        questionBreakdown[q][a] = (questionBreakdown[q][a] || 0) + 1;
      }
    }
    if (!leads || leads.length < PAGE) break;
    from += PAGE;
  }

  // ── 3. Build metric set with cost-per-each ──
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const computedMetrics: Record<string, number> = {
    ad_spend: round2(t.spend),
    leads: t.leads,
    cpl: t.leads > 0 ? round2(t.spend / t.leads) : 0,
    booked_calls: t.calls,
    cost_per_booked: t.calls > 0 ? round2(t.spend / t.calls) : 0,
    showed_calls: t.showed,
    cost_per_showed: t.showed > 0 ? round2(t.spend / t.showed) : 0,
    show_rate_pct: t.calls > 0 ? round2((t.showed / t.calls) * 100) : 0,
    committed: t.commits,
    commitment_dollars: round2(t.commitDollars),
    funded: t.funded,
    funded_dollars: round2(t.fundedDollars),
    cost_per_funded: t.funded > 0 ? round2(t.spend / t.funded) : 0,
    cost_of_capital_pct: t.fundedDollars > 0 ? round2((t.spend / t.fundedDollars) * 100) : 0,
  };

  // ── 4. Upsert, preserving human overrides/notes/custom rows ──
  const { data: existing } = await supabase
    .from("weekly_reports")
    .select("id, metrics, custom_rows, status")
    .eq("client_id", clientId)
    .eq("week_start", weekStartStr)
    .maybeSingle();

  const prevMetrics = (existing?.metrics || {}) as Record<string, any>;
  const mergedMetrics: Record<string, any> = {};
  for (const [key, computed] of Object.entries(computedMetrics)) {
    mergedMetrics[key] = {
      computed,
      override: prevMetrics[key]?.override ?? null,
      note: prevMetrics[key]?.note ?? null,
    };
  }
  // Keep any metric keys that only exist as prior overrides (user-added metrics)
  for (const [key, val] of Object.entries(prevMetrics)) {
    if (!(key in mergedMetrics)) mergedMetrics[key] = val;
  }

  const payload = {
    client_id: clientId,
    week_start: weekStartStr,
    week_end: weekEndStr,
    metrics: mergedMetrics,
    question_breakdown: questionBreakdown,
    disposition_breakdown: dispositionBreakdown,
    custom_rows: existing?.custom_rows || [],
    status: existing?.status || "draft",
    generated_at: new Date().toISOString(),
  };

  const { error: upErr } = await supabase
    .from("weekly_reports")
    .upsert(payload, { onConflict: "client_id,week_start" });
  if (upErr) throw new Error(`weekly_reports upsert: ${upErr.message}`);

  return {
    weekStart: weekStartStr,
    weekEnd: weekEndStr,
    metrics: computedMetrics,
    questionCount: Object.keys(questionBreakdown).length,
    dispositions: dispositionBreakdown,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { clientId, weekStart, allClients, weeks = 1 } = body;

    // Default: last completed week's Monday
    const defaultMonday = mondayOf(new Date(Date.now() - 7 * 86400_000));
    const baseMonday = weekStart ? new Date(`${weekStart}T00:00:00Z`) : defaultMonday;

    let clientIds: Array<{ id: string; name: string }> = [];
    if (allClients) {
      const { data } = await supabase.from("clients").select("id, name")
        .in("status", ["active", "onboarding"]);
      clientIds = data || [];
    } else if (clientId) {
      const { data } = await supabase.from("clients").select("id, name").eq("id", clientId).maybeSingle();
      if (data) clientIds = [data];
    }
    if (clientIds.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "clientId or allClients required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    for (const c of clientIds) {
      for (let w = 0; w < Math.min(weeks, 12); w++) {
        const monday = new Date(baseMonday);
        monday.setUTCDate(monday.getUTCDate() - w * 7);
        try {
          const r = await generateForWeek(supabase, c.id, iso(monday));
          results.push({ client: c.name, ...r });
        } catch (err) {
          results.push({ client: c.name, weekStart: iso(monday), error: err instanceof Error ? err.message : "unknown" });
        }
      }
      await supabase.from("sync_runs").insert({
        client_id: c.id,
        source: "reconciliation",
        function_name: "weekly-report-generator-v2",
        finished_at: new Date().toISOString(),
        status: "success",
        rows_written: results.filter(r => r.client === c.name && !r.error).length,
        metadata: { weeks },
      }).then(() => {});
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[weekly-report-generator-v2] Error:", error);
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
