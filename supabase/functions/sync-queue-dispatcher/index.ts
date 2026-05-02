import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// sync-queue-dispatcher
// Cron-driven worker. Each invocation:
//   1. Sweeps stale `processing` jobs (>10 min) back to `pending`.
//   2. Pulls up to BATCH ready jobs (status pending/retrying, next_retry_at NULL or in past).
//   3. Marks them processing, dispatches to the right worker, records outcome.
//   4. On failure → exponential backoff or dead_letter when attempts >= max_attempts.
// ============================================================

const BATCH = 25;
const STALE_MINUTES = 10;

// Map sync_type → edge function name
const WORKER_MAP: Record<string, string> = {
  lead_upsert: "process-lead-upsert",
  // future: call_upsert, opportunity_upsert, backfill, etc.
};

function backoffSeconds(attempt: number): number {
  // 2^attempt minutes, capped at 2h
  return Math.min(Math.pow(2, attempt) * 60, 7200);
}

async function callWorker(
  supabaseUrl: string,
  serviceKey: string,
  workerName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const res = await fetch(`${supabaseUrl}/functions/v1/${workerName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  const bodyText = await res.text();
  return { ok: res.ok, status: res.status, bodyText };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const startedAt = Date.now();
  const stats = { swept: 0, dispatched: 0, succeeded: 0, failed: 0, dead_lettered: 0 };

  try {
    // 1. Stale sweeper
    const staleCutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();
    const { data: stale, error: staleErr } = await supabase
      .from("sync_queue")
      .update({ status: "pending", started_at: null })
      .eq("status", "processing")
      .lt("started_at", staleCutoff)
      .select("id");
    if (staleErr) {
      console.error("[dispatcher] stale sweep error:", staleErr);
    } else {
      stats.swept = stale?.length ?? 0;
    }

    // 2. Pull ready jobs
    const nowIso = new Date().toISOString();
    const { data: jobs, error: jobsErr } = await supabase
      .from("sync_queue")
      .select("*")
      .in("status", ["pending", "retrying"])
      .eq("dead_letter", false)
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(BATCH);

    if (jobsErr) {
      console.error("[dispatcher] fetch jobs error:", jobsErr);
      return new Response(JSON.stringify({ ok: false, error: jobsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!jobs?.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "no_ready_jobs", stats, ms: Date.now() - startedAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Process each job sequentially (cheap workers, keeps DB pressure low)
    for (const job of jobs) {
      // Atomic claim: only proceed if we successfully flip pending/retrying → processing
      const { data: claimed, error: claimErr } = await supabase
        .from("sync_queue")
        .update({
          status: "processing",
          started_at: new Date().toISOString(),
          last_attempted_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .in("status", ["pending", "retrying"])
        .select("id")
        .maybeSingle();

      if (claimErr || !claimed) {
        // Another dispatcher instance grabbed it — skip
        continue;
      }

      stats.dispatched++;
      const workerName = WORKER_MAP[job.sync_type];

      if (!workerName) {
        await supabase.from("sync_queue").update({
          status: "failed",
          error_message: `no_worker_for_sync_type:${job.sync_type}`,
          completed_at: new Date().toISOString(),
          dead_letter: true,
        }).eq("id", job.id);
        stats.failed++;
        stats.dead_lettered++;
        continue;
      }

      // Compose worker body
      const workerBody = {
        ...(job.payload ?? {}),
        client_id: job.client_id,
        external_id: job.external_id,
        job_id: job.id,
      };

      let outcome: { ok: boolean; status: number; bodyText: string };
      try {
        outcome = await callWorker(supabaseUrl, serviceKey, workerName, workerBody);
      } catch (e) {
        outcome = { ok: false, status: 0, bodyText: e instanceof Error ? e.message : "fetch_error" };
      }

      const newAttempts = (job.attempts ?? 0) + 1;

      if (outcome.ok) {
        await supabase.from("sync_queue").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          attempts: newAttempts,
          error_message: null,
          records_processed: 1,
        }).eq("id", job.id);
        stats.succeeded++;
      } else {
        const max = job.max_attempts ?? 5;
        if (newAttempts >= max) {
          await supabase.from("sync_queue").update({
            status: "failed",
            completed_at: new Date().toISOString(),
            attempts: newAttempts,
            dead_letter: true,
            error_message: `[${outcome.status}] ${outcome.bodyText}`.slice(0, 2000),
          }).eq("id", job.id);
          stats.failed++;
          stats.dead_lettered++;
        } else {
          const next = new Date(Date.now() + backoffSeconds(newAttempts) * 1000).toISOString();
          await supabase.from("sync_queue").update({
            status: "retrying",
            attempts: newAttempts,
            next_retry_at: next,
            started_at: null,
            error_message: `[${outcome.status}] ${outcome.bodyText}`.slice(0, 2000),
          }).eq("id", job.id);
          stats.failed++;
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, stats, ms: Date.now() - startedAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[dispatcher] unhandled:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg, stats }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
