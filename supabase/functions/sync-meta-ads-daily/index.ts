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

  // Compute yesterday's date (UTC to avoid off-by-one timezone issues)
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  console.log(`[sync-meta-ads-daily] Starting daily sync for ${yesterdayStr}`);

  // Get all active/onboarding/paused clients with a meta_ad_account_id
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .not("meta_ad_account_id", "is", null)
    .in("status", ["active", "onboarding", "paused"]);

  if (error || !clients) {
    console.error("Failed to fetch clients:", error);
    return new Response(JSON.stringify({ success: false, error: "Failed to fetch clients" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[sync-meta-ads-daily] Found ${clients.length} clients with ad accounts`);

  const doSync = async () => {
    const results: Array<{ clientId: string; name: string; success: boolean; error?: string; backfilledDays?: string[] }> = [];

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      console.log(`[sync-meta-ads-daily] (${i + 1}/${clients.length}) Processing ${client.name}...`);

      try {
        // ── Fix 1: Gap detection & backfill for last 14 days ──
        const backfilledDays: string[] = [];
        try {
          const fourteenDaysAgo = new Date();
          fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 14);
          const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().split("T")[0];

          // Query existing daily_metrics for this client in the last 14 days
          const { data: existingMetrics } = await supabase
            .from("daily_metrics")
            .select("date, ad_spend")
            .eq("client_id", client.id)
            .gte("date", fourteenDaysAgoStr)
            .lte("date", yesterdayStr);

          // Dates with confirmed ad spend (> 0) are considered synced.
          // Dates with ad_spend = 0 may be from recalculate-daily-metrics
          // creating placeholder rows before Meta sync runs, so treat them
          // as missing if within the last 3 days.
          const threeDaysAgo = new Date();
          threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);
          const threeDaysAgoStr = threeDaysAgo.toISOString().split("T")[0];

          const existingDates = new Set(
            (existingMetrics || [])
              .filter((m: any) => {
                if (m.ad_spend === null || m.ad_spend === undefined) return false;
                // For recent dates (last 3 days), only trust rows with actual spend
                if (m.date >= threeDaysAgoStr && Number(m.ad_spend) === 0) return false;
                return true;
              })
              .map((m: any) => m.date)
          );

          // Find missing days
          const missingDays: string[] = [];
          const checkDate = new Date(fourteenDaysAgo);
          const yesterdayDate = new Date(yesterday);
          while (checkDate <= yesterdayDate) {
            const dateStr = checkDate.toISOString().split("T")[0];
            if (!existingDates.has(dateStr)) {
              missingDays.push(dateStr);
            }
            checkDate.setUTCDate(checkDate.getUTCDate() + 1);
          }

          if (missingDays.length > 0) {
            console.log(`[sync-meta-ads-daily] ${client.name}: Found ${missingDays.length} missing days to backfill: ${missingDays.join(", ")}`);

            // Group consecutive missing days into ranges for efficient API calls
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

            // Backfill each range
            for (const range of ranges) {
              try {
                console.log(`[sync-meta-ads-daily] ${client.name}: Backfilling ${range.start} to ${range.end}`);
                const response = await fetch(`${supabaseUrl}/functions/v1/sync-meta-ads`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${supabaseKey}`,
                  },
                  body: JSON.stringify({
                    clientId: client.id,
                    startDate: range.start,
                    endDate: range.end,
                  }),
                });

                const data = await response.json();
                if (data.success) {
                  console.log(`[sync-meta-ads-daily] ✓ ${client.name}: Backfilled ${range.start}-${range.end}`);
                  backfilledDays.push(`${range.start}-${range.end}`);
                } else {
                  console.error(`[sync-meta-ads-daily] ✗ ${client.name}: Backfill failed ${range.start}-${range.end}: ${data.error}`);
                }
              } catch (backfillErr) {
                console.error(`[sync-meta-ads-daily] ✗ ${client.name}: Backfill error ${range.start}-${range.end}:`, backfillErr);
              }

              // Small delay between backfill calls
              await new Promise(resolve => setTimeout(resolve, 5000));
            }
          } else {
            console.log(`[sync-meta-ads-daily] ${client.name}: No gaps found in last 14 days`);
          }
        } catch (gapErr) {
          console.error(`[sync-meta-ads-daily] ${client.name}: Gap detection error (non-fatal):`, gapErr);
        }

        // ── Standard yesterday sync ──
        const response = await fetch(`${supabaseUrl}/functions/v1/sync-meta-ads`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            clientId: client.id,
            startDate: yesterdayStr,
            endDate: yesterdayStr,
          }),
        });

        const data = await response.json();
        if (data.success) {
          console.log(`[sync-meta-ads-daily] ✓ ${client.name}: ${data.campaigns} campaigns, ${data.adSets} ad sets, ${data.ads} ads`);
          results.push({ clientId: client.id, name: client.name, success: true, backfilledDays });
        } else {
          console.error(`[sync-meta-ads-daily] ✗ ${client.name}: ${data.error}`);
          results.push({ clientId: client.id, name: client.name, success: false, error: data.error, backfilledDays });
        }
      } catch (err) {
        // Fix 1: If one client fails, log error and continue to next
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[sync-meta-ads-daily] ✗ ${client.name}: ${errMsg}`);
        results.push({ clientId: client.id, name: client.name, success: false, error: errMsg });
      }

      // 30-second delay between clients to respect rate limits
      if (i < clients.length - 1) {
        console.log(`[sync-meta-ads-daily] Waiting 30s before next client...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalBackfilled = results.reduce((s, r) => s + (r.backfilledDays?.length || 0), 0);
    console.log(`[sync-meta-ads-daily] Complete: ${succeeded} succeeded, ${failed} failed, ${totalBackfilled} backfill ranges processed`);
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
