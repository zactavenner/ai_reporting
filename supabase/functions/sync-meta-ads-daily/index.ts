import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void } | undefined;

// ── Retry helper with exponential backoff ──
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  label: string,
  maxRetries = 3,
  baseDelayMs = 5000,
): Promise<{ data: any; ok: boolean }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      const data = await res.json();
      
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 2000;
          console.warn(`[sync-meta-ads-daily] ${label}: ${res.status} error, retry ${attempt}/${maxRetries} in ${Math.round(delay / 1000)}s`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      
      return { data, ok: data.success !== false && res.ok };
    } catch (err) {
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[sync-meta-ads-daily] ${label}: Network error, retry ${attempt}/${maxRetries}:`, err);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return { data: { error: err instanceof Error ? err.message : "Unknown" }, ok: false };
    }
  }
  return { data: { error: "Max retries exceeded" }, ok: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Compute yesterday's date
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  console.log(`[sync-meta-ads-daily] Starting daily sync for ${yesterdayStr}`);

  // ── Create a sync_run for the orchestrator ──
  const { data: orchestratorRun } = await supabase.from("sync_runs").insert({
    function_name: "sync-meta-ads-daily",
    started_at: new Date().toISOString(),
    status: "running",
    metadata: { date: yesterdayStr },
  }).select("id").single();
  const orchestratorRunId = orchestratorRun?.id;

  // Get all active clients with a meta_ad_account_id
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .not("meta_ad_account_id", "is", null)
    .in("status", ["active", "onboarding"]);

  if (error || !clients) {
    console.error("Failed to fetch clients:", error);
    if (orchestratorRunId) {
      await supabase.from("sync_runs").update({
        finished_at: new Date().toISOString(),
        status: "failed",
        error_message: "Failed to fetch clients",
      }).eq("id", orchestratorRunId);
    }
    return new Response(JSON.stringify({ success: false, error: "Failed to fetch clients" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[sync-meta-ads-daily] Found ${clients.length} clients with ad accounts`);

  const doSync = async () => {
    const results: Array<{ clientId: string; name: string; success: boolean; error?: string; backfilledDays?: string[] }> = [];
    let totalRowsWritten = 0;

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      console.log(`[sync-meta-ads-daily] (${i + 1}/${clients.length}) Processing ${client.name}...`);

      try {
        // ── Gap detection & backfill for last 14 days ──
        const backfilledDays: string[] = [];
        try {
          const fourteenDaysAgo = new Date();
          fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
          const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split("T")[0];

          const { data: existingMetrics } = await supabase
            .from("daily_metrics")
            .select("date, ad_spend")
            .eq("client_id", client.id)
            .gte("date", fourteenDaysAgoStr)
            .lte("date", yesterdayStr);

          const existingDates = new Set(
            (existingMetrics || [])
              .filter((m: any) => m.ad_spend !== null && m.ad_spend !== undefined)
              .map((m: any) => m.date)
          );

          const missingDays: string[] = [];
          const checkDate = new Date(fourteenDaysAgo);
          const yesterdayDate = new Date(yesterday);
          while (checkDate <= yesterdayDate) {
            const dateStr = checkDate.toISOString().split("T")[0];
            if (!existingDates.has(dateStr)) {
              missingDays.push(dateStr);
            }
            checkDate.setDate(checkDate.getDate() + 1);
          }

          if (missingDays.length > 0) {
            console.log(`[sync-meta-ads-daily] ${client.name}: Found ${missingDays.length} missing days to backfill`);

            // Consolidate consecutive days into ranges
            const ranges: Array<{ start: string; end: string }> = [];
            let rangeStart = missingDays[0];
            let rangeEnd = missingDays[0];

            for (let j = 1; j < missingDays.length; j++) {
              const prevDate = new Date(rangeEnd);
              const currDate = new Date(missingDays[j]);
              const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

              if (diffDays === 1) {
                rangeEnd = missingDays[j];
              } else {
                ranges.push({ start: rangeStart, end: rangeEnd });
                rangeStart = missingDays[j];
                rangeEnd = missingDays[j];
              }
            }
            ranges.push({ start: rangeStart, end: rangeEnd });

            for (const range of ranges) {
              console.log(`[sync-meta-ads-daily] ${client.name}: Backfilling ${range.start} to ${range.end}`);
              const backfillResult = await fetchWithRetry(
                `${supabaseUrl}/functions/v1/sync-meta-ads`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
                  body: JSON.stringify({ clientId: client.id, startDate: range.start, endDate: range.end }),
                },
                `${client.name}/backfill/${range.start}`,
              );

              if (backfillResult.ok) {
                console.log(`[sync-meta-ads-daily] ✓ ${client.name}: Backfilled ${range.start}-${range.end}`);
                backfilledDays.push(`${range.start}-${range.end}`);
                totalRowsWritten += (backfillResult.data.dailyMetrics || 0);
              } else {
                console.error(`[sync-meta-ads-daily] ✗ ${client.name}: Backfill failed ${range.start}-${range.end}: ${backfillResult.data?.error}`);
              }

              // 5s between backfill ranges
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          } else {
            console.log(`[sync-meta-ads-daily] ${client.name}: No gaps found in last 14 days`);
          }
        } catch (gapErr) {
          console.error(`[sync-meta-ads-daily] ${client.name}: Gap detection error (non-fatal):`, gapErr);
        }

        // ── Standard yesterday sync with retry ──
        const syncResult = await fetchWithRetry(
          `${supabaseUrl}/functions/v1/sync-meta-ads`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
            body: JSON.stringify({ clientId: client.id, startDate: yesterdayStr, endDate: yesterdayStr }),
          },
          `${client.name}/yesterday`,
        );

        if (syncResult.ok) {
          console.log(`[sync-meta-ads-daily] ✓ ${client.name}: ${syncResult.data.campaigns} campaigns, ${syncResult.data.adSets} ad sets, ${syncResult.data.ads} ads`);
          totalRowsWritten += (syncResult.data.dailyMetrics || 0);
          results.push({ clientId: client.id, name: client.name, success: true, backfilledDays });
        } else {
          console.error(`[sync-meta-ads-daily] ✗ ${client.name}: ${syncResult.data?.error}`);
          results.push({ clientId: client.id, name: client.name, success: false, error: syncResult.data?.error, backfilledDays });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[sync-meta-ads-daily] ✗ ${client.name}: ${errMsg}`);
        results.push({ clientId: client.id, name: client.name, success: false, error: errMsg });
      }

      // 30-second delay between clients (respect Meta rate limits)
      if (i < clients.length - 1) {
        console.log(`[sync-meta-ads-daily] Waiting 30s before next client...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalBackfilled = results.reduce((s, r) => s + (r.backfilledDays?.length || 0), 0);
    console.log(`[sync-meta-ads-daily] Complete: ${succeeded} succeeded, ${failed} failed, ${totalBackfilled} backfill ranges processed`);

    // ── ADDITIVE: fire ad-level daily insights sync (trailing 7d). ──
    // Wrapped so any failure NEVER affects the existing sync behavior or return value.
    try {
      const insightsRes = await fetch(`${supabaseUrl}/functions/v1/sync-meta-ad-daily-insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseKey}` },
        body: JSON.stringify({ days: 3 }),
      });
      console.log(`[sync-meta-ads-daily] insights kickoff status=${insightsRes.status}`);
    } catch (e) {
      console.warn(`[sync-meta-ads-daily] insights kickoff failed (non-fatal):`, e);
      try {
        await supabase.from("sync_errors").insert({
          integration_name: "sync-meta-ads-daily",
          endpoint: "sync-meta-ad-daily-insights kickoff",
          error_message: (e as Error)?.message?.slice(0, 1000) ?? "unknown",
        });
      } catch { /* ignore */ }
    }

    // ── Update orchestrator sync_run ──
    if (orchestratorRunId) {
      await supabase.from("sync_runs").update({
        finished_at: new Date().toISOString(),
        status: failed > 0 ? "partial" : "completed",
        rows_written: totalRowsWritten,
        metadata: { date: yesterdayStr, succeeded, failed, totalBackfilled, clients: results.length },
        error_message: failed > 0 ? `${failed} client(s) failed` : null,
      }).eq("id", orchestratorRunId);
    }

    return results;
  };

  // Run in background if possible
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(doSync());
    return new Response(JSON.stringify({
      success: true,
      message: `Daily Meta Ads sync started for ${clients.length} clients (background, with gap detection)`,
      date: yesterdayStr,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } else {
    const results = await doSync();
    return new Response(JSON.stringify({
      success: true,
      date: yesterdayStr,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
