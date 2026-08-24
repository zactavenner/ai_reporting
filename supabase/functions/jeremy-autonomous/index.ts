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
  persistPlannedActions,
  approvePlannedAction,
  rejectPlannedAction,
  prepareRecreations,
  rankCandidates,
  runCycle,
  dryRunProvider,
  prepareExternalGenerationJobs,
  launchReadiness,
  cycleExternalState,
  type MetaProvider,
} from "../_shared/jeremyAutonomy.ts";
import {
  approveJob,
  rejectJob,
  getJob,
  listJobs,
  quoteJob,
  costPosture,
  type JeremyJobKind,
} from "../_shared/jeremyExternalJobs.ts";
import {
  generationTarget,
  jobKindFor,
  loadModelRate,
  pickGenerationModel,
  quoteGenerationCostUsd,
  runGenerationJob,
  type GenerationKind,
} from "../_shared/jeremyGeneration.ts";
import { publishLaunch, publishTarget } from "../_shared/jeremyLaunch.ts";
import { makeGenerationExecutors, makePublishExecutor } from "../_shared/jeremyExecutors.ts";
import { readDashboardToken } from "../_shared/dashboardToken.ts";

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
        // Persisting is what makes a plan executable later; the response itself
        // is never accepted as authority for an execution.
        const persisted = body.persist === false
          ? []
          : await persistPlannedActions(supabase, clientId, (body.cycle_id as string) ?? null, null, plan);
        return json({ success: true, mode: policy.mode, basis: analysis.basis, coverage: analysis.coverage, plan, persisted_plans: persisted });
      }
      case "list_plans": {
        let q = supabase
          .from("jeremy_action_plans")
          .select("*")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(Math.min(100, Number(body.limit) || 50));
        if (typeof body.status === "string") q = q.eq("status", body.status);
        const { data } = await q;
        return json({ success: true, plans: data ?? [] });
      }
      case "approve_plan": {
        if (actor === "scheduler") return json({ success: false, error: "The scheduler may not approve actions." }, 403);
        const planId = String(body.plan_id ?? "");
        if (!planId) return json({ success: false, error: "plan_id required" }, 400);
        const result = await approvePlannedAction(supabase, planId, actor ?? "operator");
        return json(result, result.success ? 200 : 400);
      }
      case "reject_plan": {
        if (actor === "scheduler") return json({ success: false, error: "The scheduler may not reject actions." }, 403);
        const planId = String(body.plan_id ?? "");
        if (!planId) return json({ success: false, error: "plan_id required" }, 400);
        const result = await rejectPlannedAction(supabase, planId, actor ?? "operator");
        return json(result, result.success ? 200 : 400);
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
          planId: String(body.plan_id ?? ""),
          cycleId: (body.cycle_id as string) ?? null,
          recommendationId: (body.recommendation_id as string) ?? null,
          action: String(body.jeremy_action ?? "") as "pause" | "adjust_budget",
          entityType: String(body.entity_type ?? "campaign") as "campaign" | "adset" | "ad",
          metaEntityId: String(body.meta_entity_id ?? ""),
          proposedDailyBudget: body.proposed_daily_budget != null ? Number(body.proposed_daily_budget) : null,
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
          launchInputs: (body.launch_inputs as Record<string, unknown>) ?? {},
          imageModel: body.image_model as string,
          videoModel: body.video_model as string,
          aspectRatio: body.aspect_ratio as string,
          durationSeconds: Number(body.duration_seconds) || 5,
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
      // ── External job ledger ───────────────────────────────────────────────
      case "cost_posture":
        return json({ success: true, cost_posture: await costPosture(supabase, policy, clientId), policy });

      case "list_jobs": {
        const jobs = await listJobs(supabase, clientId, {
          kind: (body.kind as JeremyJobKind) ?? undefined,
          status: (body.status as never) ?? undefined,
          cycleId: (body.cycle_id as string) ?? undefined,
          limit: Number(body.limit) || 50,
        });
        return json({ success: true, jobs, cost_posture: await costPosture(supabase, policy, clientId) });
      }

      case "get_job": {
        const job = await getJob(supabase, String(body.job_id ?? ""));
        if (!job) return json({ success: false, error: "Job not found" }, 404);
        if (job.client_id !== clientId) return json({ success: false, error: "Job belongs to a different client" }, 403);
        return json({ success: true, job });
      }

      case "approve_job":
      case "reject_job": {
        if (actor === "scheduler") return json({ success: false, error: "The scheduler may not decide paid or external jobs." }, 403);
        const jobId = String(body.job_id ?? "");
        // Scope the decision to the caller's client: a job may only ever be
        // decided through its own client context.
        const target = jobId ? await getJob(supabase, jobId) : null;
        if (!target) return json({ success: false, error: "Job not found" }, 404);
        if (target.client_id !== clientId) return json({ success: false, error: "Job belongs to a different client" }, 403);
        const result = action === "approve_job"
          ? await approveJob(supabase, jobId, actor ?? "operator")
          : await rejectJob(supabase, jobId, actor ?? "operator");
        return json(result, result.success ? 200 : 400);
      }


      // ── Paid Apify discovery (quote → operator approval → run) ────────────
      case "quote_discovery":
      case "run_discovery": {
        const mode = action === "quote_discovery" ? "quote" : (body.approve_and_run === true ? "approve_and_run" : "run");
        if (mode !== "quote" && actor === "scheduler") {
          return json({ success: false, error: "The scheduler may quote discovery but never run paid discovery." }, 403);
        }
        const dashToken = readDashboardToken(req, body);
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-instagram-scrape`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            ...(dashToken ? { "x-dashboard-token": dashToken } : {}),
          },
          body: JSON.stringify({
            mode,
            client_id: clientId,
            cycle_id: body.cycle_id ?? null,
            job_id: body.job_id ?? null,
            scrapeType: body.scrape_type ?? body.scrapeType,
            targets: body.targets,
            resultsLimit: body.results_limit ?? body.resultsLimit,
            actor_id: body.actor_id,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        return json(payload, res.status);
      }

      // ── Paid generation (quote → operator approval → run) ─────────────────
      case "quote_generation": {
        const candidateId = String(body.candidate_id ?? "");
        if (!candidateId) return json({ success: false, error: "candidate_id required" }, 400);
        const { data: candidate } = await supabase
          .from("jeremy_creative_candidates")
          .select("id, generation_kind, client_id")
          .eq("id", candidateId)
          .eq("client_id", clientId)
          .maybeSingle();
        if (!candidate) return json({ success: false, error: "Candidate not found for this client" }, 404);
        const kind = (String(body.kind ?? candidate.generation_kind) === "video" ? "video" : "static_image") as GenerationKind;
        const model = await pickGenerationModel(supabase, kind, body.model);
        const aspectRatio = String(body.aspect_ratio ?? (kind === "video" ? "9:16" : "1:1"));
        const durationSeconds = Math.max(1, Math.min(30, Number(body.duration_seconds) || 5));
        const rate = model ? await loadModelRate(supabase, kind, model) : null;
        const cost = quoteGenerationCostUsd(rate, durationSeconds);
        if (!model || !rate || !Number.isFinite(cost)) {
          return json({ success: false, error: "No active configured price for this model in jeremy_model_costs; refusing to quote generation without a known cost." }, 400);
        }
        const quote = await quoteJob(supabase, policy, {
          clientId,
          kind: jobKindFor(kind),
          provider: "openrouter",
          target: generationTarget({ candidateId, kind, model, aspectRatio, durationSeconds }),
          estimatedCostUsd: cost,
          costSource: rate.source,
          costVersion: rate.version,
          cycleId: (body.cycle_id as string) ?? null,
          candidateId,
          requestedBy: actor ?? "operator",
          quoteDetail: { model, kind, aspect_ratio: aspectRatio, duration_seconds: kind === "video" ? durationSeconds : null },
        });
        return json({ success: quote.success, job: quote.job, policy_gate: quote.policy_gate, error: quote.error }, quote.success ? 200 : 400);
      }

      case "run_generation": {
        if (actor === "scheduler") return json({ success: false, error: "The scheduler may not run paid generation." }, 403);
        const jobId = String(body.job_id ?? "");
        const job = jobId ? await getJob(supabase, jobId) : null;
        if (!job) return json({ success: false, error: "An approved generation job id is required." }, 400);
        if (body.approve === true && job.status === "awaiting_approval") {
          const approved = await approveJob(supabase, jobId, actor ?? "operator");
          if (!approved.success) return json({ success: false, error: approved.error }, 400);
        }
        const target = (job.target ?? {}) as Record<string, unknown>;
        const kind = (String(target.kind) === "video" ? "video" : "static_image") as GenerationKind;
        const result = await runGenerationJob(supabase, policy, makeGenerationExecutors(supabase), {
          clientId,
          jobId,
          candidateId: String(target.candidate_id ?? job.candidate_id ?? ""),
          kind,
          model: String(target.model ?? ""),
          aspectRatio: String(target.aspect_ratio ?? "1:1"),
          durationSeconds: Number(target.duration_seconds) || 5,
          actor: actor ?? "operator",
          referenceImageUrls: Array.isArray(body.reference_image_urls) ? body.reference_image_urls.map(String) : [],
        });
        return json(result, result.success ? 200 : 400);
      }

      // ── Launch readiness + PAUSED publication ─────────────────────────────
      case "launch_readiness": {
        const ids = Array.isArray(body.candidate_ids) ? body.candidate_ids.map(String) : [];
        if (!ids.length) return json({ success: false, error: "candidate_ids required" }, 400);
        const readiness = await launchReadiness(supabase, clientId, ids, (body.inputs as Record<string, unknown>) ?? {});
        return json({ success: true, readiness });
      }

      case "quote_publish": {
        const launchId = String(body.launch_id ?? "");
        if (!launchId) return json({ success: false, error: "launch_id required" }, 400);
        const { data: launch } = await supabase
          .from("meta_campaign_launches")
          .select("id, client_id, status")
          .eq("id", launchId)
          .eq("client_id", clientId)
          .maybeSingle();
        if (!launch) return json({ success: false, error: "Launch draft not found for this client" }, 404);
        const quote = await quoteJob(supabase, policy, {
          clientId,
          kind: "meta_publish",
          provider: "meta",
          target: publishTarget(launchId),
          estimatedCostUsd: 0,
          costSource: "meta_publish_no_media_spend",
          costVersion: "1",
          cycleId: (body.cycle_id as string) ?? null,
          launchId,
          requestedBy: actor ?? "operator",
          quoteDetail: { action: "create campaign + ad set + ad, all PAUSED", spends_ad_budget_immediately: false },
        });
        return json({ success: quote.success, job: quote.job, error: quote.error }, quote.success ? 200 : 400);
      }

      case "publish_launch": {
        if (actor === "scheduler") return json({ success: false, error: "The scheduler may not publish Meta objects." }, 403);
        const jobId = String(body.job_id ?? "");
        const launchId = String(body.launch_id ?? "");
        if (!jobId || !launchId) return json({ success: false, error: "job_id and launch_id required" }, 400);
        if (body.approve === true) {
          const job = await getJob(supabase, jobId);
          if (job?.status === "awaiting_approval") {
            const approved = await approveJob(supabase, jobId, actor ?? "operator");
            if (!approved.success) return json({ success: false, error: approved.error }, 400);
          }
        }
        const dashToken = readDashboardToken(req, body);
        const result = await publishLaunch(supabase, policy, makePublishExecutor(dashToken), {
          clientId,
          jobId,
          launchId,
          actor: actor ?? "operator",
        });
        return json(result, result.success ? 200 : 400);
      }

      case "cycle_external_state": {
        const cycleId = String(body.cycle_id ?? "");
        if (!cycleId) return json({ success: false, error: "cycle_id required" }, 400);
        return json({ success: true, ...(await cycleExternalState(supabase, clientId, cycleId, policy)) });
      }

      case "prepare_external_jobs": {
        const ids = Array.isArray(body.candidate_ids) ? body.candidate_ids.map(String) : [];
        if (!ids.length) return json({ success: false, error: "candidate_ids required" }, 400);
        const jobs = await prepareExternalGenerationJobs(supabase, clientId, (body.cycle_id as string) ?? null, policy, ids, {
          imageModel: body.image_model as string,
          videoModel: body.video_model as string,
          aspectRatio: body.aspect_ratio as string,
          durationSeconds: Number(body.duration_seconds) || 5,
          requestedBy: actor ?? "operator",
        });
        return json({ success: true, external_jobs: jobs, note: "Quotes only — every job awaits explicit operator approval." });
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
