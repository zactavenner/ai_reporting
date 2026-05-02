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

  console.log(`[sync-hubspot-all-clients] Starting 6-hour HubSpot sync`);

  // Get all active HubSpot clients
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, hubspot_portal_id, hubspot_access_token")
    .not("hubspot_portal_id", "is", null)
    .not("hubspot_access_token", "is", null)
    .in("status", ["active", "onboarding"]);

  if (error || !clients) {
    console.error("Failed to fetch clients:", error);
    return new Response(JSON.stringify({ success: false, error: "Failed to fetch clients" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[sync-hubspot-all-clients] Found ${clients.length} HubSpot clients`);

  const doSync = async () => {
    const results: Array<{ clientId: string; name: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      console.log(`[sync-hubspot-all-clients] (${i + 1}/${clients.length}) Syncing ${client.name}...`);

      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/sync-hubspot-contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ client_id: client.id, mode: "sync" }),
        });
        const data = await res.json();
        if (data.success) {
          console.log(`[sync-hubspot-all-clients] ✓ ${client.name}: ${data.summary?.contacts || 0} contacts, ${data.summary?.deals || 0} deals, ${data.summary?.meetings || 0} meetings`);
          results.push({ clientId: client.id, name: client.name, success: true });
        } else {
          console.error(`[sync-hubspot-all-clients] ✗ ${client.name}: ${data.error}`);
          results.push({ clientId: client.id, name: client.name, success: false, error: data.error });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[sync-hubspot-all-clients] ✗ ${client.name}: ${errMsg}`);
        results.push({ clientId: client.id, name: client.name, success: false, error: errMsg });
      }

      // 15-second delay between clients
      if (i < clients.length - 1) {
        console.log(`[sync-hubspot-all-clients] Waiting 15s before next client...`);
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }

    const succeeded = results.filter(r => r.success).length;
    console.log(`[sync-hubspot-all-clients] Complete: ${succeeded}/${results.length} clients synced`);

    // Trigger daily metrics recalculation so CRM data (leads, calls) appears in daily_metrics
    if (succeeded > 0) {
      const recalcEnd = new Date();
      const recalcStart = new Date();
      recalcStart.setUTCDate(recalcStart.getUTCDate() - 7);
      const recalcStartStr = recalcStart.toISOString().split("T")[0];
      const recalcEndStr = recalcEnd.toISOString().split("T")[0];
      console.log(`[sync-hubspot-all-clients] Triggering daily metrics recalculation for ${recalcStartStr} to ${recalcEndStr}...`);
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/recalculate-daily-metrics`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ startDate: recalcStartStr, endDate: recalcEndStr }),
        });
        const data = await res.json();
        console.log(`[sync-hubspot-all-clients] Metrics recalculation result:`, JSON.stringify(data));
      } catch (err) {
        console.error(`[sync-hubspot-all-clients] Metrics recalculation failed:`, err);
      }
    }

    return results;
  };

  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(doSync());
    return new Response(JSON.stringify({
      success: true,
      message: `HubSpot sync started for ${clients.length} clients (background)`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } else {
    const results = await doSync();
    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
