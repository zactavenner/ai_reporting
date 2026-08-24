// Instagram/Apify discovery — the ONLY server path that spends Apify credits.
//
// Auth is fail-closed and resolved BEFORE any secret or client data is read:
//   • an agency reporting operator (dashboard admin token / allowlisted user), or
//   • the service role / Jeremy scheduler secret, which may QUOTE but never approve.
//
// Spend is gated twice, and both gates must pass immediately before the call:
//   1. the Jeremy policy paid-discovery capability (enabled + positive per-run and
//      monthly caps, month-to-date usage), and
//   2. the Apify account's own monthly spend limit.
//
// Nothing runs without a persisted, approved, unexpired cost quote whose
// fingerprint matches the request exactly. The Apify token never leaves here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeOperator } from "../_shared/operatorAuth.ts";
import { authorizeJeremyCron, readJeremyCronSecret } from "../_shared/jeremyCronSecret.ts";
import { loadPolicy } from "../_shared/jeremyPolicy.ts";
import {
  approveJob,
  authorizeJobExecution,
  claimJob,
  completeJob,
  failJob,
  markJobRunning,
  quoteJob,
} from "../_shared/jeremyExternalJobs.ts";
import {
  checkApifyMonthlyLimit,
  costPerResultUsd,
  estimateApifyCostUsd,
  fetchDatasetItems,
  ingestCreatives,
  normalizeDiscoveryTarget,
  recordApifySpend,
  resolveApifySettings,
  runApifyActor,
} from "../_shared/jeremyApify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dashboard-token, x-jeremy-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // ── 1. Auth first. No secrets, tokens or client rows are read before this. ──
    const cronSecret = readJeremyCronSecret(req, body);
    let actor: string;
    let isOperator = false;
    if (cronSecret) {
      if (!(await authorizeJeremyCron(supabase, cronSecret))) {
        return json({ success: false, error: "Unauthorized scheduler request" }, 401);
      }
      actor = "scheduler";
    } else {
      const auth = await authorizeOperator(req, supabase, createClient, body);
      if (!auth.ok) return json({ success: false, error: auth.error, code: auth.code }, auth.status);
      isOperator = auth.via !== "service_role";
      actor = isOperator ? `operator:${auth.memberName ?? auth.via}` : "service_role";
    }

    const mode = String(body.mode ?? (body.job_id ? "run" : "quote"));
    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    if (!clientId) {
      return json({ success: false, error: "client_id is required: discovery spend is always attributed to a client." }, 400);
    }

    const normalized = normalizeDiscoveryTarget({
      scrapeType: body.scrapeType ?? body.scrape_type,
      targets: body.targets,
      resultsLimit: body.resultsLimit ?? body.results_limit,
      actorId: body.actor_id,
    });
    if (!normalized.ok) return json({ success: false, error: normalized.error }, 400);
    const target = normalized.target;

    const policy = await loadPolicy(supabase, clientId);
    const settings = await resolveApifySettings(supabase, clientId);
    const unit = configuredCostPerResult(settings);
    const estimated = estimateApifyCostUsd(target, unit.usd);
    if (!Number.isFinite(estimated)) {
      return json(
        {
          success: false,
          error: "No Apify per-result price is configured (apify_settings.config.cost_per_result_usd); refusing to quote or spend without a known cost.",
        },
        400,
      );
    }
    const apifyGate = checkApifyMonthlyLimit(settings, estimated);

    const quoteDetail = {
      provider: "apify",
      actor_id: target.actorId,
      scrape_type: target.scrapeType,
      target_count: target.targets.length,
      targets: target.targets,
      results_limit_per_target: target.resultsLimit,
      maximum_results: target.max_results,
      cost_per_result_usd: unit.usd,
      apify_monthly_limit_gate: apifyGate,
    };

    // ── 2. Quote — never spends, never takes the live key. ────────────────────
    if (mode === "quote") {
      const quote = await quoteJob(supabase, policy, {
        clientId,
        kind: "apify_discovery",
        provider: "apify",
        target: { ...target },
        estimatedCostUsd: estimated,
        costSource: unit.source,
        costVersion: unit.version,
        cycleId: (body.cycle_id as string) ?? null,
        requestedBy: actor,
        quoteDetail,
      });
      if (!quote.success) return json({ success: false, error: quote.error }, 400);

      return json({
        success: true,
        mode: "quote",
        job: quote.job,
        policy_gate: quote.policy_gate,
        apify_gate: apifyGate,
        note: "Awaiting explicit operator approval; no Apify credits have been spent.",
      });
    }

    // ── 3. One-click operator confirmation: approve then run. ─────────────────
    let jobId = String(body.job_id ?? "");
    if (mode === "approve_and_run") {
      if (!isOperator) return json({ success: false, error: "Only an authenticated operator may approve paid discovery." }, 403);
      if (!jobId) return json({ success: false, error: "job_id required" }, 400);
      const approved = await approveJob(supabase, jobId, actor);
      if (!approved.success) return json({ success: false, error: approved.error }, 400);
    } else if (mode !== "run") {
      return json({ success: false, error: `Unknown mode: ${mode}` }, 400);
    }
    if (!jobId) return json({ success: false, error: "job_id required: an approved quote is mandatory before spending." }, 400);

    // ── 4. Revalidate every gate against the persisted approval. ─────────────
    const auth = await authorizeJobExecution(supabase, policy, jobId, {
      clientId,
      kind: "apify_discovery",
      target: { ...target },
      actor,
    });
    if (!auth.allowed) return json({ success: false, error: auth.reason, gates: auth.gates }, 400);
    if (!apifyGate.allowed) return json({ success: false, error: apifyGate.reason, gates: auth.gates }, 400);

    const token = String(settings?.api_token ?? "");
    if (!token) return json({ success: false, error: "No Apify API token is configured." }, 400);

    // ── 5. Atomic claim: a second concurrent run loses the race. ─────────────
    const claimed = await claimJob(supabase, jobId, actor);
    if (!claimed) return json({ success: false, error: "Job already claimed or executed (idempotency)." }, 409);

    const { data: jobRow } = await supabase
      .from("instagram_scrape_jobs")
      .insert({
        client_id: clientId,
        target_handle: target.targets.join(", ").slice(0, 200),
        status: "running",
        started_at: new Date().toISOString(),
        input_params: { ...target, external_job_id: jobId, estimated_cost_usd: auth.job?.estimated_cost_usd ?? estimated },
      })
      .select("id")
      .maybeSingle();

    try {
      const run = await runApifyActor(fetch, token, target, { timeoutSecs: Number(body.timeout_secs) || 120 });
      await markJobRunning(supabase, jobId, run.runId || null);

      // Provider truthfulness: only a terminal SUCCEEDED run with a dataset may
      // be ingested. Spend is still recorded, since Apify bills started runs.
      const ingestible = assertRunIngestible(run);
      if (!ingestible.ok) {
        const spent = Number.isFinite(Number(run.usageUsd)) ? Number(run.usageUsd) : 0;
        if (spent > 0) await recordApifySpend(supabase, settings, spent);
        throw new Error(ingestible.error);
      }

      const items = await fetchDatasetItems(fetch, token, run.datasetId!, target.max_results);
      const ingest = await ingestCreatives(supabase, clientId, items);

      const authorized = Number(auth.job?.estimated_cost_usd ?? estimated);
      const reported = Number(run.usageUsd);
      const actualCost = Number.isFinite(reported) ? reported : authorized;
      await recordApifySpend(supabase, settings, actualCost);

      // A provider-reported cost above the approved maximum is a verification
      // failure: the spend is recorded truthfully, but the job is not "clean".
      if (Number.isFinite(reported) && reported > authorized + 0.01) {
        await completeJob(supabase, jobId, {
          status: "verification_failed",
          actualCostUsd: actualCost,
          providerJobId: run.runId || null,
          providerResponse: { run_id: run.runId, dataset_id: run.datasetId, status: run.status },
          verification: {
            cost_overrun: true,
            approved_maximum_usd: authorized,
            provider_reported_usd: reported,
            fetched: ingest.fetched,
            ingested: ingest.ingested,
          },
        });
        return json(
          {
            success: false,
            error: `Apify reported $${reported} against an approved maximum of $${authorized}; job marked verification_failed.`,
            job_id: jobId,
            ingested: ingest.ingested,
          },
          409,
        );
      }


      if (jobRow?.id) {
        await supabase
          .from("instagram_scrape_jobs")
          .update({
            status: "completed",
            posts_found: ingest.fetched,
            posts_processed: ingest.ingested,
            results_count: ingest.ingested,
            cost_usd: actualCost,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobRow.id);
      }

      await completeJob(supabase, jobId, {
        status: "succeeded",
        actualCostUsd: actualCost,
        providerJobId: run.runId || null,
        providerResponse: { run_id: run.runId, dataset_id: run.datasetId, status: run.status },
        verification: { fetched: ingest.fetched, ingested: ingest.ingested, duplicates: ingest.duplicates },
        resultSummary: { ...ingest, scrape_job_id: jobRow?.id ?? null },
      });

      return json({
        success: true,
        jobId: jobRow?.id ?? null,
        external_job_id: jobId,
        status: "completed",
        resultsCount: ingest.ingested,
        fetched: ingest.fetched,
        duplicates: ingest.duplicates,
        costUsd: actualCost,
        gates: auth.gates,
      });
    } catch (providerError) {
      const message = providerError instanceof Error ? providerError.message : String(providerError);
      await failJob(supabase, jobId, message);
      if (jobRow?.id) {
        await supabase
          .from("instagram_scrape_jobs")
          .update({ status: "failed", error_message: message.slice(0, 1000), completed_at: new Date().toISOString() })
          .eq("id", jobRow.id);
      }
      return json({ success: false, error: message, external_job_id: jobId }, 502);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("run-instagram-scrape failed:", message);
    return json({ success: false, error: message }, 500);
  }
});
