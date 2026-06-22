import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void } | undefined;

// Fire-and-forget invocation — does NOT wait for the child function to finish.
// This is the key change: each child runs in its own edge instance with its own timeout budget.
function fireAndForget(
  supabaseUrl: string,
  supabaseKey: string,
  functionName: string,
  body: Record<string, unknown>,
  label: string,
): void {
  fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify(body),
  })
    .then(() => console.log(`[daily-master-sync] dispatched ${label}`))
    .catch((err) => console.error(`[daily-master-sync] dispatch failed ${label}:`, err));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let skipSteps: string[] = [];
  let force = false;
  try {
    const body = await req.json();
    skipSteps = body.skipSteps || [];
    force = !!body.force;
  } catch {}

  // Dispatch lock: if another master run started <10min ago, skip.
  // Prevents the watchdog + cron from double-firing concurrent syncs.
  if (!force) {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("sync_runs")
      .select("id, started_at")
      .eq("function_name", "daily-master-sync")
      .eq("source", "master")
      .gte("started_at", tenMinAgo)
      .limit(1);
    if (recent && recent.length > 0) {
      console.log("[daily-master-sync] dispatch lock: recent run exists, skipping");
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "recent run <10min" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  const orchestrate = async () => {
    // Clean up stale "running" sync runs older than 2 hours
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("sync_runs")
        .update({ status: "timed_out", finished_at: new Date().toISOString() })
        .eq("status", "running")
        .lt("started_at", twoHoursAgo);
    } catch (e) {
      console.error("[daily-master-sync] stale cleanup error:", e);
    }

    // Rolling 7-day window ending yesterday
    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 29); // 30-day window for resilience
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, meta_ad_account_id, ghl_api_key, ghl_location_id, last_ghl_sync_at")
      .in("status", ["active", "onboarding"]);

    if (!clients?.length) {
      console.error("[daily-master-sync] no clients found");
      return;
    }

    console.log(`[daily-master-sync] dispatching syncs for ${clients.length} clients (window ${startStr} → ${endStr})`);

    const { data: masterRun } = await supabase.from("sync_runs").insert({
      function_name: "daily-master-sync",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "completed",
      source: "master",
      metadata: {
        source: "master",
        window: `${startStr}→${endStr}`,
        clientCount: clients.length,
        mode: "fire-and-forget",
        dispatched_at: new Date().toISOString(),
      },
    }).select("id").single();

    // Stagger dispatches by 2 seconds each to avoid hammering subfunction cold-starts
    let dispatchIdx = 0;
    for (const client of clients) {
      const delay = dispatchIdx * 2000;
      dispatchIdx++;

      setTimeout(() => {
        if (!skipSteps.includes("meta") && client.meta_ad_account_id) {
          fireAndForget(supabaseUrl, supabaseKey, "sync-meta-ads", {
            clientId: client.id,
            startDate: startStr,
            endDate: endStr,
          }, `${client.name}/meta`);
        }

        if (!skipSteps.includes("ghl") && client.ghl_api_key && client.ghl_location_id) {
          // Backfill detection: if no sync in last 24h (or never), pull a wider window
          const lastSync = client.last_ghl_sync_at ? new Date(client.last_ghl_sync_at).getTime() : 0;
          const hoursSinceSync = lastSync ? (Date.now() - lastSync) / (1000 * 60 * 60) : Infinity;
          let ghlDays = 30;
          if (!lastSync) ghlDays = 365;            // never synced → full backfill
          else if (hoursSinceSync > 168) ghlDays = 90;  // >1 week stale → 90d
          else if (hoursSinceSync > 24) ghlDays = 60;   // >24h stale → 60d

          fireAndForget(supabaseUrl, supabaseKey, "sync-ghl-contacts", {
            client_id: client.id,
            syncType: "contacts",
            sinceDateDays: ghlDays,
          }, `${client.name}/ghl-contacts(${ghlDays}d)`);

          // Pipelines a few seconds later, same client
          setTimeout(() => {
            fireAndForget(supabaseUrl, supabaseKey, "sync-ghl-pipelines", {
              client_id: client.id,
            }, `${client.name}/ghl-pipelines`);
          }, 8000);
        }

        // Recalculate metrics 60s after dispatch — gives sync functions time to write
        if (!skipSteps.includes("recalculate")) {
          setTimeout(() => {
            fireAndForget(supabaseUrl, supabaseKey, "recalculate-daily-metrics", {
              clientId: client.id,
              startDate: startStr,
              endDate: endStr,
            }, `${client.name}/recalculate`);
          }, 60000);
        }
      }, delay);
    }

    console.log(`[daily-master-sync] all dispatches scheduled (${clients.length} clients, ${dispatchIdx * 2}s spread)`);
  };

  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(orchestrate());
  } else {
    orchestrate().catch(console.error);
  }

  // Return immediately — orchestration runs in background
  return new Response(
    JSON.stringify({
      success: true,
      message: "Daily master sync dispatched (fire-and-forget mode)",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
