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

  const doSync = async () => {
    const results: Array<{ clientId: string; name: string; contacts: boolean; calendar: boolean; pipelines: boolean; errors: string[] }> = [];

    for (let i = 0; i < ghlClients.length; i++) {
      const client = ghlClients[i];
      const clientResult = { clientId: client.id, name: client.name, contacts: false, calendar: false, pipelines: false, errors: [] as string[] };
      console.log(`[sync-ghl-all-clients] (${i + 1}/${ghlClients.length}) Syncing ${client.name}...`);

      // 1. Sync contacts (leads) - pass sinceDateDays if provided
      try {
        const contactsBody: Record<string, unknown> = { client_id: client.id, syncType: "contacts" };
        if (sinceDateDays) contactsBody.sinceDateDays = sinceDateDays;

        const res = await fetch(`${supabaseUrl}/functions/v1/sync-ghl-contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify(contactsBody),
        });
        const data = await res.json();
        clientResult.contacts = !data.error;
        if (data.error) clientResult.errors.push(`contacts: ${data.error}`);
        else console.log(`[sync-ghl-all-clients] ✓ ${client.name} contacts synced`);
      } catch (err) {
        clientResult.errors.push(`contacts: ${err instanceof Error ? err.message : "Unknown"}`);
      }

      // Update GHL sync status on client after contacts sync
      if (clientResult.contacts) {
        await supabase
          .from("clients")
          .update({ ghl_sync_status: "healthy", last_ghl_sync_at: new Date().toISOString(), ghl_sync_error: null })
          .eq("id", client.id);
      }

      await new Promise(resolve => setTimeout(resolve, 10000));

      // 2. Sync calendar appointments
      try {
        const calendarBody: Record<string, unknown> = { clientId: client.id };
        if (sinceDateDays) calendarBody.sinceDateDays = sinceDateDays;
        
        const res = await fetch(`${supabaseUrl}/functions/v1/sync-calendar-appointments`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify(calendarBody),
        });
        const data = await res.json();
        clientResult.calendar = !data.error;
        if (data.error) clientResult.errors.push(`calendar: ${data.error}`);
        else console.log(`[sync-ghl-all-clients] ✓ ${client.name} calendar synced`);
      } catch (err) {
        clientResult.errors.push(`calendar: ${err instanceof Error ? err.message : "Unknown"}`);
      }

      await new Promise(resolve => setTimeout(resolve, 10000));

      // 3. Sync pipelines (committed + funded from pipeline stages)
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/sync-ghl-pipelines`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
          body: JSON.stringify({ client_id: client.id }),
        });
        const data = await res.json();
        clientResult.pipelines = !data.error;
        if (data.error) clientResult.errors.push(`pipelines: ${data.error}`);
        else console.log(`[sync-ghl-all-clients] ✓ ${client.name} pipelines synced`);
      } catch (err) {
        clientResult.errors.push(`pipelines: ${err instanceof Error ? err.message : "Unknown"}`);
      }

      // Update sync status to error if contacts sync failed
      if (!clientResult.contacts && clientResult.errors.length > 0) {
        const contactError = clientResult.errors.find(e => e.startsWith("contacts:"));
        await supabase
          .from("clients")
          .update({ ghl_sync_status: "error", ghl_sync_error: contactError || clientResult.errors[0] })
          .eq("id", client.id);
      }

      results.push(clientResult);

      // 30-second delay between clients to avoid GHL 429 rate limits
      if (i < ghlClients.length - 1) {
        const hasErrors = clientResult.errors.length > 0;
        const delay = hasErrors ? 45000 : 30000; // Extra delay after errors (rate limit cooldown)
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
