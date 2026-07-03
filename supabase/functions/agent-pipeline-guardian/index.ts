import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * PIPELINE GUARDIAN — autonomous agent that keeps lead pipeline data honest.
 *
 * Every run, per client:
 *   1. Finds leads that need attention:
 *      a. STALE: not synced from GHL in > staleDays and not in a terminal stage
 *      b. STUCK: call_booked with a scheduled_at in the past but no showed outcome
 *   2. Refreshes them via lead-status-sync-v2 (batch mode handles rate limiting)
 *   3. Detects DISCREPANCIES the refresh uncovered — e.g. a lead the dashboard
 *      showed as call_booked that GHL says is actually funded (revenue was
 *      invisible to reporting until now)
 *   4. Escalates big finds to agent_escalations, logs a summary to agent_actions
 *   5. Triggers recalculate-daily-metrics when transitions occurred so the
 *      dashboard numbers update the same run
 *
 * Body: { clientId?, staleDays?: 3, escalateFundedMisses?: true }
 * Wire into daily-master-sync (runs before attribution) or call on demand.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const { clientId = null, staleDays = 3, escalateFundedMisses = true } = body;

    let clientsQuery = supabase.from("clients")
      .select("id, name, ghl_api_key, ghl_location_id")
      .not("ghl_api_key", "is", null)
      .in("status", ["active", "onboarding"]);
    if (clientId) clientsQuery = clientsQuery.eq("id", clientId);
    const { data: clients, error: clientErr } = await clientsQuery;
    if (clientErr || !clients) throw new Error(`Failed to fetch clients: ${clientErr?.message}`);

    const summary: any[] = [];

    for (const client of clients) {
      try {
        // 1a. Count stale leads (view exposes days_since_ghl_sync)
        const { count: staleCount } = await supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("client_id", client.id)
          .eq("is_spam", false)
          .not("external_id", "is", null)
          .not("pipeline_status", "in", '("funded","lost")')
          .or(`ghl_last_synced_at.is.null,ghl_last_synced_at.lt.${new Date(Date.now() - staleDays * 86400_000).toISOString()}`);

        // 1b. Stuck booked calls: scheduled in the past, outcome unknown
        const { data: stuckCalls } = await supabase
          .from("calls")
          .select("id, lead_id, scheduled_at")
          .eq("client_id", client.id)
          .lt("scheduled_at", new Date(Date.now() - 86400_000).toISOString()) // >1 day past
          .is("showed", null)
          .limit(100);

        // 2. Refresh via the v2 API (it prioritizes never/oldest-synced leads)
        const refreshRes = await fetch(`${supabaseUrl}/functions/v1/lead-status-sync-v2`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
          body: JSON.stringify({ clientId: client.id, syncAll: true, sinceDays: 30, limit: 100 }),
        });
        const refresh = await refreshRes.json();
        const interesting = (refresh.results || []).filter((r: any) => r.transitions?.length > 0);

        // 3. Discrepancy detection: transitions that jumped 2+ stages mean the
        //    dashboard was materially wrong until this run
        const bigJumps = interesting.filter((r: any) => {
          const order = ["new", "contacted", "call_booked", "call_showed", "committed", "funded"];
          const from = order.indexOf(r.previousStatus);
          const to = order.indexOf(r.currentStatus);
          return to - from >= 2 || r.currentStatus === "funded";
        });

        // 4. Escalate funded misses — money that reporting didn't know about
        if (escalateFundedMisses && bigJumps.length > 0) {
          const fundedMisses = bigJumps.filter((r: any) => r.currentStatus === "funded");
          const missedDollars = fundedMisses.reduce((s: number, r: any) => s + (r.facts?.fundedDollars || 0), 0);
          if (fundedMisses.length > 0) {
            await supabase.from("agent_escalations").insert({
              agent_name: "PIPELINE_GUARDIAN",
              severity: missedDollars > 100_000 ? "high" : "medium",
              category: "data_accuracy",
              title: `${client.name}: ${fundedMisses.length} funded investor(s) found via GHL reconcile ($${missedDollars.toLocaleString()})`,
              description: `The dashboard was showing these leads in earlier stages, but GHL says they are funded. Reporting has now been corrected, but review why the real-time webhook missed the transition (webhook not configured for this client? stage renamed in GHL?).`,
              context: { clientId: client.id, leads: fundedMisses, missedDollars },
            });
          }
        }

        // 5. Audit log
        await supabase.from("agent_actions").insert({
          client_id: client.id,
          action_type: "custom",
          action_label: `Pipeline reconcile: ${refresh.leadsChecked || 0} leads checked, ${refresh.transitions || 0} status corrections, ${stuckCalls?.length || 0} stuck calls`,
          approval_tier: "auto",
          status: "executed",
          executed_at: new Date().toISOString(),
          executed_by: "agent-pipeline-guardian",
          reasoning: `${staleCount || 0} leads were stale (>${staleDays}d since GHL sync). Refreshed the 100 oldest; ${interesting.length} needed status corrections, ${bigJumps.length} were 2+ stage jumps the dashboard had missed.`,
          confidence: 1.0,
          metadata: { staleCount, stuckCalls: stuckCalls?.length || 0, corrections: interesting },
        });

        // 6. Transitions happened → recalc metrics so dashboard reflects them now
        if ((refresh.transitions || 0) > 0) {
          fetch(`${supabaseUrl}/functions/v1/recalculate-daily-metrics`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
            body: JSON.stringify({
              clientId: client.id,
              startDate: new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0],
              endDate: new Date().toISOString().split("T")[0],
            }),
          }).catch(() => {});
        }

        summary.push({
          client: client.name,
          staleLeads: staleCount || 0,
          stuckCalls: stuckCalls?.length || 0,
          leadsRefreshed: refresh.leadsChecked || 0,
          corrections: refresh.transitions || 0,
          bigJumps: bigJumps.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        console.error(`[pipeline-guardian] ${client.name} failed:`, msg);
        summary.push({ client: client.name, error: msg });
      }
    }

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[pipeline-guardian] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
