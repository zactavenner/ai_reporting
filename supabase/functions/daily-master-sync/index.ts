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

    console.log(`[daily-master-sync] enqueuing jobs for ${clients.length} clients (window ${startStr} → ${endStr})`);

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
        mode: "sync_queue",
        dispatched_at: new Date().toISOString(),
      },
    });

    const now = Date.now();
    const rows: Record<string, unknown>[] = [];

    for (const client of clients) {
      // ── Meta Ads ──
      if (!skipSteps.includes("meta") && client.meta_ad_account_id) {
        rows.push({
          client_id: client.id,
          sync_type: "meta_ads_sync",
          priority: 2,
          status: "pending",
          payload: { startDate: startStr, endDate: endStr },
          // immediate
        });
      }

      // ── GHL ──
      if (!skipSteps.includes("ghl") && client.ghl_api_key && client.ghl_location_id) {
        const lastSync = client.last_ghl_sync_at ? new Date(client.last_ghl_sync_at).getTime() : 0;
        const hoursSinceSync = lastSync ? (Date.now() - lastSync) / (1000 * 60 * 60) : Infinity;
        let ghlDays = 30;
        if (!lastSync) ghlDays = 365;
        else if (hoursSinceSync > 168) ghlDays = 90;
        else if (hoursSinceSync > 24) ghlDays = 60;

        // Contacts — immediate
        rows.push({
          client_id: client.id,
          sync_type: "ghl_contacts_sync",
          priority: 2,
          status: "pending",
          payload: { syncType: "contacts", sinceDateDays: ghlDays },
        });

        // Calendar — run after contacts (~15 s) so lead UTM map is warm
        rows.push({
          client_id: client.id,
          sync_type: "ghl_calendar_sync",
          priority: 3,
          status: "pending",
          next_retry_at: new Date(now + 15_000).toISOString(),
          payload: { sinceDateDays: ghlDays },
        });

        // Pipelines — slightly after calendar
        rows.push({
          client_id: client.id,
          sync_type: "ghl_pipelines_sync",
          priority: 3,
          status: "pending",
          next_retry_at: new Date(now + 25_000).toISOString(),
          payload: {},
        });
      }

      // ── Recalculate metrics — after syncs complete (~60 s) ──
      if (!skipSteps.includes("recalculate")) {
        rows.push({
          client_id: client.id,
          sync_type: "recalculate_metrics",
          priority: 5,
          status: "pending",
          next_retry_at: new Date(now + 60_000).toISOString(),
          payload: { startDate: startStr, endDate: endStr },
        });
      }
    }

    if (rows.length > 0) {
      const { error: insertErr } = await supabase.from("sync_queue").insert(rows);
      if (insertErr) {
        console.error("[daily-master-sync] sync_queue insert error:", insertErr);
      } else {
        console.log(`[daily-master-sync] enqueued ${rows.length} jobs for ${clients.length} clients`);
      }
    }
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
