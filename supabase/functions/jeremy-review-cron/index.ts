// Automatic Media Buyer (JEREMY) review cadence for Reporting 5.0.
//
// Runs once each business morning AFTER the Meta/CRM sync, for every eligible
// active client that has synced Meta entities. DST-safe: pg_cron fires at both
// 14:00 and 15:00 UTC and only the invocation that lands on local hour 07 in
// America/Los_Angeles proceeds. Idempotent per client + local date via the
// unique (client_id, run_date) key on jeremy_review_runs.
//
// This job creates recommendations only. It never writes to Meta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runJeremyReview } from "../_shared/jeremyReview.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "America/Los_Angeles";
const RUN_HOUR_LOCAL = 7;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function laParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", weekday: "short", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === "24" ? "00" : parts.hour),
    weekday: String(parts.weekday),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const force = body.force === true;
  const { date: runDate, hour, weekday } = laParts();

  // DST-safe hour gate + business-morning gate.
  if (body.source === "cron" && !force) {
    if (hour !== RUN_HOUR_LOCAL) {
      return json({ ok: true, skipped: true, reason: `local hour ${hour} != ${RUN_HOUR_LOCAL}`, tz: TZ });
    }
    if (weekday === "Sat" || weekday === "Sun") {
      return json({ ok: true, skipped: true, reason: `weekend (${weekday})`, tz: TZ });
    }
  }

  let clientQuery = supabase.from("clients").select("id, name, status").eq("status", "active");
  if (typeof body.client_id === "string") {
    clientQuery = supabase.from("clients").select("id, name, status").eq("id", body.client_id);
  }
  const { data: clients, error: clientsErr } = await clientQuery;
  if (clientsErr) return json({ ok: false, error: clientsErr.message }, 500);

  const results: Array<Record<string, unknown>> = [];

  for (const client of clients || []) {
    // Idempotency claim: the unique (client_id, run_date) index makes a second
    // invocation for the same local day fail here instead of re-reviewing.
    const { data: claim, error: claimErr } = await supabase
      .from("jeremy_review_runs")
      .insert({ client_id: client.id, run_date: runDate, status: "processing", source: "cron" })
      .select("id")
      .maybeSingle();
    if (claimErr || !claim) {
      results.push({ client: client.name, status: "already_ran" });
      continue;
    }

    const finish = (status: string, patch: Record<string, unknown>) =>
      supabase.from("jeremy_review_runs")
        .update({ status, updated_at: new Date().toISOString(), ...patch })
        .eq("id", claim.id);

    // Skip clients without usable synced Meta data or config.
    const { count } = await supabase
      .from("meta_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id);
    if (!count) {
      await finish("skipped", { error_message: "No synced Meta campaigns" });
      results.push({ client: client.name, status: "skipped", reason: "no synced Meta campaigns" });
      continue;
    }

    try {
      const result = await runJeremyReview(supabase, client.id, "cron");
      if (!result.success) {
        await finish(result.skipped ? "skipped" : "failed", { error_message: result.error });
        results.push({ client: client.name, status: result.skipped ? "skipped" : "failed", error: result.error });
        continue;
      }
      await finish("completed", {
        result_summary: {
          run_id: result.runId,
          created: result.created,
          reviewed: result.reviewed,
          health_score: result.healthScore,
          summary: result.summary,
        },
      });
      results.push({ client: client.name, status: "completed", created: result.created });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`jeremy-review-cron failed for ${client.name}:`, message);
      await finish("failed", { error_message: message });
      results.push({ client: client.name, status: "failed", error: message });
    }
  }

  return json({ ok: true, run_date: runDate, tz: TZ, clients: results.length, results });
});