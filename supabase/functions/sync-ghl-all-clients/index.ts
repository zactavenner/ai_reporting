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

  // Parse optional sinceDateDays from request body
  let sinceDateDays: number | undefined;
  try {
    const body = await req.json();
    if (body?.sinceDateDays) {
      sinceDateDays = Math.min(Math.max(parseInt(body.sinceDateDays) || 7, 1), 365);
    }
  } catch {}

  console.log(`[sync-ghl-all-clients] Starting GHL sync${sinceDateDays ? ` (${sinceDateDays} days back)` : ''}`);

  // Get all clients with valid GHL credentials (sync every credentialed client)
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, ghl_api_key, ghl_location_id, hubspot_portal_id")
    .not("ghl_api_key", "is", null)
    .not("ghl_location_id", "is", null);

  if (error || !clients) {
    console.error("Failed to fetch clients:", error);
    return new Response(JSON.stringify({ success: false, error: "Failed to fetch clients" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Use ALL clients with GHL credentials - do NOT exclude clients that also have HubSpot
  const ghlClients = clients;
  console.log(`[sync-ghl-all-clients] Found ${ghlClients.length} GHL clients to sync`);

  // Helper: fetch with a per-request timeout to prevent stuck calls from blocking the pipeline
  async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number = 120000 // 2 minutes default
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  const doSync = async () => {
    const results: Array<{ clientId: string; name: string; contacts: boolean; calendar: boolean; pipelines: boolean; errors: string[] }> = [];

    // Clean up stuck sync_logs (running for > 15 min) before starting
    try {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      await supabase
        .from("sync_logs")
        .update({ status: "failed", error_message: "Watchdog: stuck >15min", completed_at: new Date().toISOString() })
        .eq("status", "running")
        .lt("started_at", fifteenMinAgo);
      console.log(`[sync-ghl-all-clients] Cleaned up stuck sync_logs`);
    } catch (err) {
      console.warn(`[sync-ghl-all-clients] Failed to clean stuck sync_logs:`, err);
    }

    // Update ghl_sync_status for clients whose last sync was > 48 hours ago
    try {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("clients")
        .update({ ghl_sync_status: "stale" })
        .not("ghl_api_key", "is", null)
        .not("last_ghl_sync_at", "is", null)
        .lt("last_ghl_sync_at", twoDaysAgo)
        .neq("ghl_sync_status", "error");
    } catch {}

    const PER_STEP_TIMEOUT = 120000; // 2 minutes per sync step

    for (let i = 0; i < ghlClients.length; i++) {
      const client = ghlClients[i];
      const clientResult = { clientId: client.id, name: client.name, contacts: false, calendar: false, pipelines: false, errors: [] as string[] };
      console.log(`[sync-ghl-all-clients] (${i + 1}/${ghlClients.length}) Syncing ${client.name}...`);

      // 1. Sync contacts (leads) - pass sinceDateDays if provided
      try {
        const contactsBody: Record<string, unknown> = { client_id: client.id, syncType: "contacts" };
        if (sinceDateDays) contactsBody.sinceDateDays = sinceDateDays;

        const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/sync-ghl-contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify(contactsBody),
        }, PER_STEP_TIMEOUT);
        const data = await res.json();
        clientResult.contacts = !data.error;
        if (data.error) clientResult.errors.push(`contacts: ${data.error}`);
        else console.log(`[sync-ghl-all-clients] ✓ ${client.name} contacts synced`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        const isTimeout = msg.includes("abort") || msg.includes("signal");
        clientResult.errors.push(`contacts: ${isTimeout ? "Timeout after 2min" : msg}`);
        console.error(`[sync-ghl-all-clients] ✗ ${client.name} contacts: ${msg}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));

      // 2. Sync calendar appointments
      try {
        const calendarBody: Record<string, unknown> = { clientId: client.id };
        if (sinceDateDays) calendarBody.sinceDateDays = sinceDateDays;

        const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/sync-calendar-appointments`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify(calendarBody),
        }, PER_STEP_TIMEOUT);
        const data = await res.json();
        clientResult.calendar = !data.error;
        if (data.error) clientResult.errors.push(`calendar: ${data.error}`);
        else console.log(`[sync-ghl-all-clients] ✓ ${client.name} calendar synced`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        const isTimeout = msg.includes("abort") || msg.includes("signal");
        clientResult.errors.push(`calendar: ${isTimeout ? "Timeout after 2min" : msg}`);
        console.error(`[sync-ghl-all-clients] ✗ ${client.name} calendar: ${msg}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));

      // 3. Sync pipelines (committed + funded from pipeline stages)
      try {
        const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/sync-ghl-pipelines`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ client_id: client.id }),
        }, PER_STEP_TIMEOUT);
        const data = await res.json();
        clientResult.pipelines = !data.error;
        if (data.error) clientResult.errors.push(`pipelines: ${data.error}`);
        else console.log(`[sync-ghl-all-clients] ✓ ${client.name} pipelines synced`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown";
        const isTimeout = msg.includes("abort") || msg.includes("signal");
        clientResult.errors.push(`pipelines: ${isTimeout ? "Timeout after 2min" : msg}`);
      }

      // Update client sync status immediately after processing
      try {
        const hasErrors = clientResult.errors.length > 0;
        const allFailed = !clientResult.contacts && !clientResult.calendar && !clientResult.pipelines;
        await supabase
          .from("clients")
          .update({
            last_ghl_sync_at: new Date().toISOString(),
            ghl_sync_status: allFailed ? "error" : hasErrors ? "partial" : "healthy",
            ghl_sync_error: hasErrors ? clientResult.errors.slice(0, 3).join("; ") : null,
          })
          .eq("id", client.id);
      } catch {}

      results.push(clientResult);

      // Reduced delay between clients (was 30-45s, now 15-25s)
      if (i < ghlClients.length - 1) {
        const hasErrors = clientResult.errors.length > 0;
        const delay = hasErrors ? 25000 : 15000;
        console.log(`[sync-ghl-all-clients] Waiting ${delay / 1000}s before next client...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const successCount = results.filter(r => r.errors.length === 0).length;
    console.log(`[sync-ghl-all-clients] Complete: ${successCount}/${results.length} clients fully synced`);

    // Trigger daily metrics recalculation for all clients after sync
    // recalculate-daily-metrics expects { startDate, endDate } (YYYY-MM-DD strings)
    const daysBack = sinceDateDays || 7;
    const recalcEnd = new Date();
    const recalcStart = new Date();
    recalcStart.setUTCDate(recalcStart.getUTCDate() - daysBack);
    const recalcStartStr = recalcStart.toISOString().split("T")[0];
    const recalcEndStr = recalcEnd.toISOString().split("T")[0];
    console.log(`[sync-ghl-all-clients] Triggering daily metrics recalculation for ${recalcStartStr} to ${recalcEndStr}...`);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/recalculate-daily-metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
        body: JSON.stringify({ startDate: recalcStartStr, endDate: recalcEndStr }),
      });
      const data = await res.json();
      console.log(`[sync-ghl-all-clients] Metrics recalculation result:`, JSON.stringify(data));
    } catch (err) {
      console.error(`[sync-ghl-all-clients] Metrics recalculation failed:`, err);
    }

    return results;
  };

  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(doSync());
    return new Response(JSON.stringify({
      success: true,
      message: `GHL sync started for ${ghlClients.length} clients (background)${sinceDateDays ? `, ${sinceDateDays} days back` : ''}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } else {
    const results = await doSync();
    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
