// Jeremy Autonomous Creative & Media Buyer — operator + scheduler endpoint.
//
// Auth is fail-closed and happens BEFORE any query or write:
//   • agency operator (dashboard admin token / allowlisted user / service role), or
//   • the scheduler secret (x-jeremy-cron-secret) for automated cycles.
//
// Nothing here activates a Meta object, and live provider mutations require an
// explicit dry_run:false from an authorized operator on an account whose policy
// permits it. Shadow mode (the default) records decisions only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeOperator } from "../_shared/operatorAuth.ts";
import { authorizeJeremyCron, readJeremyCronSecret } from "../_shared/jeremyCronSecret.ts";
import { META_GRAPH_BASE, metaFetch, resolveMetaToken } from "../_shared/meta.ts";
import { kpiContract } from "../_shared/jeremyKpiContract.ts";
import { loadPolicy, normalizePolicy, type JeremyPolicy } from "../_shared/jeremyPolicy.ts";
import {
  analyzeAccount,
  buildCoverage,
  createLaunchBatch,
  discoverWinners,
  executeApprovedAction,
  getCycle,
  planActions,
  prepareRecreations,
  rankCandidates,
  runCycle,
  dryRunProvider,
  type MetaProvider,
} from "../_shared/jeremyAutonomy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dashboard-token, x-jeremy-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Live Meta provider. Reads always allowed; mutations are the only spend path. */
function liveProvider(token: string): MetaProvider {
  return {
    async read(_entityType, entityId) {
      const url = `${META_GRAPH_BASE}/${entityId}?fields=id,name,status,effective_status,daily_budget&access_token=${encodeURIComponent(token)}`;
      const res = await metaFetch(url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Meta read failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
      return body;
    },
    async mutate(_entityType, entityId, params) {
      const form = new URLSearchParams({ ...params, access_token: token });
      const res = await metaFetch(`${META_GRAPH_BASE}/${entityId}`, {
        method: "POST",
        body: form,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Meta write failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
      return body;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // ── Auth first: no data is read before this resolves. ──────────────────
    const cronSecret = readJeremyCronSecret(req, body);
    let actor: string | null = null;
    if (cronSecret) {
      const okCron = await authorizeJeremyCron(supabase, cronSecret);
      if (!okCron) return json({ success: false, error: "Unauthorized scheduler request" }, 401);
      actor = "scheduler";
    } else {
      const auth = await authorizeOperator(req, supabase, createClient, body);
      if (!auth.ok) return json({ success: false, error: auth.error, code: auth.code }, auth.status);
      actor = auth.memberName ? `operator:${auth.memberName}` : `operator:${auth.via}`;
    }

    const action = String(body.action ?? "");
    const clientId = typeof body.client_id === "string" ? body.client_id : null;

    if (action === "get_kpi_contract") return json({ success: true, contract: kpiContract() });

    if (action === "get_policy") {
      if (!clientId) return json({ success: false, error: "client_id required" }, 400);
      return json({ success: true, policy: await loadPolicy(supabase, clientId) });
    }

    if (action === "update_policy") {
      if (!clientId) return json({ success: false, error: "client_id required" }, 400);
      if (actor === "scheduler") return json({ success: false, error: "The scheduler may not change policy." }, 403);
      const patch = normalizePolicy(clientId, {
        ...(await loadPolicy(supabase, clientId)) as unknown as Record<string, unknown>,
        ...(body.policy as Record<string, unknown> ?? {}),
      });
      const { error } = await supabase
        .from("jeremy_autonomy_policies")
        .upsert({ ...patch, updated_by: actor }, { onConflict: "client_id" });
      if (error) return json({ success: false, error: error.message }, 400);
      return json({ success: true, policy: patch });
    }

    if (!clientId) return json({ success: false, error: "client_id required" }, 400);
    const policy: JeremyPolicy = await loadPolicy(supabase, clientId);

    switch (action) {
      case "coverage": {
        const { coverage, totals } = await buildCoverage(supabase, clientId, policy, Number(body.window_days) || 30);
        return json({ success: true, coverage, totals, policy });
      }
      case "discover": {
        const result = await discoverWinners(supabase, clientId, policy, {
          includeApify: body.include_apify === true,
          apifyExpectedCostUsd: Number(body.apify_expected_cost_usd),
        });
        const { coverage } = await buildCoverage(supabase, clientId, policy);
        const ranked = rankCandidates(result.candidates, coverage);
        return json({ success: true, sources: result.sources, paid_discovery: result.paid_discovery, candidates: ranked.slice(0, 25), coverage });
      }
      case "prepare_recreations": {
        const discovery = await discoverWinners(supabase, clientId, policy, {});
        const { coverage } = await buildCoverage(supabase, clientId, policy);
        const ranked = rankCandidates(discovery.candidates, coverage);
        const prepared = await prepareRecreations(supabase, clientId, (body.cycle_id as string) ?? null, policy, ranked, {
          top: Number(body.top) || 5,
        });
        return json({ success: true, ...prepared });
      }
      case "create_launch_batch": {
        const ids = Array.isArray(body.candidate_ids) ? body.candidate_ids.map(String) : [];
        if (!ids.length) return json({ success: false, error: "candidate_ids required" }, 400);
        const batch = await createLaunchBatch(supabase, clientId, ids, (body.inputs as Record<string, unknown>) ?? {});
        return json({ success: true, ...batch, note: "All launches are PAUSED drafts; publishing stays an explicit operator action." });
      }
      case "analyze": {
        const analysis = await analyzeAccount(supabase, clientId, policy, Number(body.window_days) || 30);
        return json({ success: true, ...analysis });
      }
      case "plan_actions": {
        const analysis = await analyzeAccount(supabase, clientId, policy, Number(body.window_days) || 30);
        const plan = await planActions(supabase, clientId, policy, analysis);
        return json({ success: true, mode: policy.mode, basis: analysis.basis, coverage: analysis.coverage, plan });
      }
      case "execute_action": {
        if (actor === "scheduler" && policy.mode !== "autopilot") {
          return json({ success: false, error: "The scheduler may only execute on autopilot accounts." }, 403);
        }
        const dryRun = body.dry_run !== false;
        let provider = dryRunProvider;
        if (!dryRun) {
          const { data: client } = await supabase
            .from("clients")
            .select("id, meta_system_user_token, meta_access_token, meta_token_type")
            .eq("id", clientId)
            .maybeSingle();
          const { token } = resolveMetaToken(client);
          if (!token) return json({ success: false, error: "No Meta access token available for this client." }, 400);
          provider = liveProvider(token);
        }
        const result = await executeApprovedAction(supabase, policy, provider, {
          clientId,
          cycleId: (body.cycle_id as string) ?? null,
          recommendationId: (body.recommendation_id as string) ?? null,
          action: String(body.jeremy_action ?? "") as "pause" | "adjust_budget",
          entityType: String(body.entity_type ?? "campaign") as "campaign" | "adset" | "ad",
          metaEntityId: String(body.meta_entity_id ?? ""),
          proposedDailyBudget: body.proposed_daily_budget != null ? Number(body.proposed_daily_budget) : null,
          humanApproved: body.human_approved === true,
          executedBy: actor ?? "unknown",
          dryRun,
        });
        return json({ success: result.success, ...result }, result.success ? 200 : 400);
      }
      case "run_cycle": {
        const result = await runCycle(supabase, clientId, {
          windowDays: Number(body.window_days) || 30,
          includeApify: body.include_apify === true,
          apifyExpectedCostUsd: Number(body.apify_expected_cost_usd),
          topCandidates: Number(body.top) || 5,
          createLaunches: body.create_launches === true,
          triggeredBy: actor ?? "manual",
        });
        return json(result, result.success ? 200 : 500);
      }
      case "get_cycle": {
        const cycleId = String(body.cycle_id ?? "");
        if (!cycleId) return json({ success: false, error: "cycle_id required" }, 400);
        return json({ success: true, ...(await getCycle(supabase, cycleId)) });
      }
      case "list_cycles": {
        const { data } = await supabase
          .from("jeremy_cycles")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(Math.min(50, Number(body.limit) || 10));
        return json({ success: true, cycles: data ?? [] });
      }
      case "list_executions": {
        const { data } = await supabase
          .from("jeremy_action_executions")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(Math.min(100, Number(body.limit) || 25));
        return json({ success: true, executions: data ?? [] });
      }
      default:
        return json({ success: false, error: `Unknown action: ${action || "(none)"}` }, 400);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("jeremy-autonomous failed:", message);
    return json({ success: false, error: message }, 500);
  }
});
