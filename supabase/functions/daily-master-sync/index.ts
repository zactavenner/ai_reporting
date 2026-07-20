import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void } | undefined;

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

    // Rolling 30-day window ending yesterday
    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 29);
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

    console.log(`[daily-master-sync] dispatching jobs for ${clients.length} clients (window ${startStr} → ${endStr})`);

    await supabase.from("sync_runs").insert({
      function_name: "daily-master-sync",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "completed",
      source: "master",
      metadata: {
        source: "master",
        window: `${startStr}→${endStr}`,
        clientCount: clients.length,
        mode: "direct_invoke",
        dispatched_at: new Date().toISOString(),
      },
    });

    // Direct invoke helper (fire-and-forget, but awaited so EdgeRuntime.waitUntil holds them)
    const invoke = async (fn: string, body: Record<string, unknown>, label: string) => {
      try {
        const { error } = await supabase.functions.invoke(fn, { body });
        if (error) console.error(`[daily-master-sync] ${label} error:`, error.message || error);
      } catch (e: any) {
        console.error(`[daily-master-sync] ${label} threw:`, e?.message || e);
      }
    };

    // 1) Meta insights — one call syncs all clients with meta_ad_account_id
    if (!skipSteps.includes("meta")) {
      await invoke("sync-meta-ad-daily-insights", { startDate: startStr, endDate: endStr }, "sync-meta-ad-daily-insights");
    }

    // 1b) Refresh Meta base tables (campaign/adset/ad names, status, budgets,
    // meta_reported_leads) — without this the Ads Manager tab shows stale
    // objects between manual syncs.
    if (!skipSteps.includes("meta")) {
      for (const client of clients) {
        if (!client.meta_ad_account_id) continue;
        await invoke(
          "sync-meta-ads",
          { clientId: client.id, startDate: startStr, endDate: endStr },
          `sync-meta-ads:${client.name}`,
        );
      }
    }

    // 2) Per-client GHL + recalc, awaited serially to keep the isolate alive
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const client of clients) {
      if (!skipSteps.includes("ghl") && client.ghl_api_key && client.ghl_location_id) {
        const lastSync = client.last_ghl_sync_at ? new Date(client.last_ghl_sync_at).getTime() : 0;
        const hoursSinceSync = lastSync ? (Date.now() - lastSync) / (1000 * 60 * 60) : Infinity;
        let ghlDays = 30;
        if (!lastSync) ghlDays = 365;
        else if (hoursSinceSync > 168) ghlDays = 90;
        else if (hoursSinceSync > 24) ghlDays = 60;

        await invoke("sync-ghl-contacts", { client_id: client.id, syncType: "all", sinceDateDays: ghlDays }, `ghl-contacts:${client.name}`);
        await invoke("sync-calendar-appointments", { clientId: client.id }, `ghl-calendar:${client.name}`);
        await invoke("sync-ghl-pipelines", { client_id: client.id, mode: "list" }, `ghl-pipelines:${client.name}`);
      }

      if (!skipSteps.includes("recalculate")) {
        await invoke("recalculate-daily-metrics", { client_id: client.id, startDate: startStr, endDate: endStr }, `recalc:${client.name}`);
      }

      // Run CRM→Ad attribution so ROAS / attributed_leads / attributed_funded
      // on the Ads Manager tab don't silently go stale.
      if (!skipSteps.includes("attribution")) {
        await invoke(
          "run-attribution",
          { clientId: client.id, startDate: startStr, endDate: endStr },
          `attribution:${client.name}`,
        );
      }

      await sleep(500);
    }

    console.log(`[daily-master-sync] finished dispatch for ${clients.length} clients`);
  };

  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(orchestrate());
  } else {
    orchestrate().catch(console.error);
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: "Daily master sync enqueued via sync_queue",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
