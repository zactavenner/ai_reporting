import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void } | undefined;

interface StepResult {
  step: string;
  success: boolean;
  duration_ms: number;
  details?: string;
  error?: string;
}

async function callFunction(
  supabaseUrl: string,
  supabaseKey: string,
  functionName: string,
  body: Record<string, unknown> = {}
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return { success: !data.error && response.ok, data, error: data.error };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown" };
  }
}

async function createAlertTask(
  supabase: any,
  title: string,
  description: string,
  priority: string = "high"
) {
  try {
    await supabase.from("tasks").insert({
      title,
      description,
      priority,
      status: "todo",
      stage: "backlog",
      created_by: "system",
    });
    console.log(`[daily-master-sync] Created alert task: ${title}`);
  } catch (err) {
    console.error(`[daily-master-sync] Failed to create alert task:`, err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let skipSteps: string[] = [];
  try {
    const body = await req.json();
    skipSteps = body.skipSteps || [];
  } catch {}

  console.log(`[daily-master-sync] Starting daily master sync pipeline`);

  const doSync = async () => {
    const results: StepResult[] = [];

    // ── Step 1: Meta Ads Daily (campaigns, ad sets, ads + backfill) ──
    if (!skipSteps.includes("meta")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 1: sync-meta-ads-daily`);
      const res = await callFunction(supabaseUrl, supabaseKey, "sync-meta-ads-daily");
      const duration = Date.now() - start;
      results.push({
        step: "sync-meta-ads-daily",
        success: res.success,
        duration_ms: duration,
        details: res.data?.message,
        error: res.error,
      });
      if (!res.success) {
        await createAlertTask(supabase,
          "⚠️ Meta Ads daily sync failed",
          `The daily Meta Ads sync failed with error: ${res.error}. Check the META_SHARED_ACCESS_TOKEN and client ad account configurations.`
        );
      }
      // Wait for Meta to finish processing in background
      await new Promise(r => setTimeout(r, 10000));
    }

    // ── Step 1b: GHL Ads Reporting (unified Meta/Google via GHL) ──
    if (!skipSteps.includes("ghl_ads")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 1b: sync-ghl-ads (all clients)`);
      // Get all clients with GHL credentials
      const { data: ghlClients } = await supabase
        .from("clients")
        .select("id")
        .not("ghl_api_key", "is", null)
        .not("ghl_location_id", "is", null)
        .in("status", ["active", "onboarding"]);

      let ghlAdsSucceeded = 0;
      let ghlAdsFailed = 0;
      for (const c of ghlClients || []) {
        const res = await callFunction(supabaseUrl, supabaseKey, "sync-ghl-ads", {
          clientId: c.id,
          syncAccounts: true,
        });
        if (res.success) ghlAdsSucceeded++; else ghlAdsFailed++;
      }
      const duration = Date.now() - start;
      results.push({
        step: "sync-ghl-ads",
        success: ghlAdsFailed === 0,
        duration_ms: duration,
        details: `${ghlAdsSucceeded} succeeded, ${ghlAdsFailed} failed out of ${(ghlClients || []).length} clients`,
        error: ghlAdsFailed > 0 ? `${ghlAdsFailed} client(s) failed` : undefined,
      });
      await new Promise(r => setTimeout(r, 5000));
    }

    // ── Step 2: GHL All Clients (contacts, calendar, pipelines) ──
    if (!skipSteps.includes("ghl")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 2: sync-ghl-all-clients`);
      const res = await callFunction(supabaseUrl, supabaseKey, "sync-ghl-all-clients");
      const duration = Date.now() - start;
      results.push({
        step: "sync-ghl-all-clients",
        success: res.success,
        duration_ms: duration,
        details: res.data?.message,
        error: res.error,
      });
      if (!res.success) {
        await createAlertTask(supabase,
          "⚠️ GHL sync failed",
          `The daily GHL all-clients sync failed: ${res.error}. Check GHL API keys.`
        );
      }
      await new Promise(r => setTimeout(r, 10000));
    }

    // ── Step 2b: Process GHL enrichment queue (durable sync-back) ──
    if (!skipSteps.includes("ghl_enrich")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 2b: ghl-lead-enrich-sync (process queue)`);
      const res = await callFunction(supabaseUrl, supabaseKey, "ghl-lead-enrich-sync", {
        processQueue: true,
        limit: 50,
      });
      const duration = Date.now() - start;
      results.push({
        step: "ghl-lead-enrich-sync",
        success: res.success,
        duration_ms: duration,
        details: `Processed ${res.data?.processed || 0} jobs (${res.data?.succeeded || 0} succeeded, ${res.data?.failed || 0} failed)`,
        error: res.error,
      });
      await new Promise(r => setTimeout(r, 5000));
    }

    // ── Step 2c: Pipeline Guardian (reconcile lead statuses vs GHL) ──
    // Refreshes stale leads via lead-status-sync-v2, escalates funded misses,
    // and triggers per-client recalcs — so Steps 4/5b see corrected stages.
    if (!skipSteps.includes("pipeline_guardian")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 2c: agent-pipeline-guardian`);
      const res = await callFunction(supabaseUrl, supabaseKey, "agent-pipeline-guardian", {});
      const duration = Date.now() - start;
      const guardSummary = res.data?.summary || [];
      const totalCorrections = guardSummary.reduce((s: number, r: any) => s + (r.corrections || 0), 0);
      results.push({
        step: "agent-pipeline-guardian",
        success: res.success,
        duration_ms: duration,
        details: `${guardSummary.length} clients reconciled, ${totalCorrections} lead status corrections`,
        error: res.error,
      });
      await new Promise(r => setTimeout(r, 5000));
    }

    // ── Step 3: HubSpot All Clients ──
    if (!skipSteps.includes("hubspot")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 3: sync-hubspot-all-clients`);
      const res = await callFunction(supabaseUrl, supabaseKey, "sync-hubspot-all-clients");
      const duration = Date.now() - start;
      results.push({
        step: "sync-hubspot-all-clients",
        success: res.success,
        duration_ms: duration,
        details: res.data?.message,
        error: res.error,
      });
      if (!res.success) {
        await createAlertTask(supabase,
          "⚠️ HubSpot sync failed",
          `The daily HubSpot sync failed: ${res.error}. Check HubSpot access tokens.`
        );
      }
      await new Promise(r => setTimeout(r, 5000));
    }

    // ── Step 4: Recalculate Daily Metrics ──
    if (!skipSteps.includes("recalculate")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 4: recalculate-daily-metrics`);
      const res = await callFunction(supabaseUrl, supabaseKey, "recalculate-daily-metrics");
      const duration = Date.now() - start;
      results.push({
        step: "recalculate-daily-metrics",
        success: res.success,
        duration_ms: duration,
        details: `${res.data?.totalUpdated || 0} days updated`,
        error: res.error,
      });
      await new Promise(r => setTimeout(r, 5000));
    }

    // ── Step 5: Daily Accuracy Check ──
    if (!skipSteps.includes("accuracy")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 5: daily-accuracy-check`);
      const res = await callFunction(supabaseUrl, supabaseKey, "daily-accuracy-check");
      const duration = Date.now() - start;
      const discrepancies = res.data?.discrepanciesFound || 0;
      results.push({
        step: "daily-accuracy-check",
        success: res.success,
        duration_ms: duration,
        details: `${discrepancies} discrepancies, ${res.data?.autoFixedClients || 0} auto-fixed`,
        error: res.error,
      });
      if (discrepancies > 0) {
        await createAlertTask(supabase,
          `📊 ${discrepancies} data discrepancies auto-fixed`,
          `The daily accuracy check found ${discrepancies} discrepancies across ${res.data?.clientsWithIssues || 0} clients and auto-fixed ${res.data?.autoFixedClients || 0}. Review sync_accuracy_log for details.`,
          "medium"
        );
      }
    }

    // ── Step 5b: Compute Attribution (Hyros engine) ──
    // Runs all 5 attribution models for the last 30 days. Writes to attribution_results.
    if (!skipSteps.includes("attribution")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 5b: compute-attribution`);
      const periodEnd = new Date().toISOString().split("T")[0];
      const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const attrRes = await callFunction(supabaseUrl, supabaseKey, "compute-attribution", {
        periodStart,
        periodEnd,
        // Run all models so RevenueAttributionPanel can switch between them instantly
        models: ["first_touch", "last_touch", "linear", "time_decay", "position_based"],
      });
      const duration = Date.now() - start;
      const modelCount = (attrRes.data?.results || []).length;
      results.push({
        step: "compute-attribution",
        success: attrRes.success,
        duration_ms: duration,
        details: `${modelCount} model/client combinations computed (${periodStart} to ${periodEnd})`,
        error: attrRes.error,
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    // ── Step 5c: Creative Performance Loop (scale winners, propose pausing losers) ──
    if (!skipSteps.includes("creative_loop")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 5c: creative-loop`);
      const loopRes = await callFunction(supabaseUrl, supabaseKey, "creative-loop", {});
      const duration = Date.now() - start;
      const loopResults = loopRes.data?.results || [];
      const totalVariants = loopResults.reduce((s: number, r: any) => s + (r.variantsQueued || 0), 0);
      const totalPauses = loopResults.reduce((s: number, r: any) => s + (r.pausesProposed || 0), 0);
      results.push({
        step: "creative-loop",
        success: loopRes.success,
        duration_ms: duration,
        details: `${totalVariants} variant generations triggered, ${totalPauses} pause proposals queued for approval`,
        error: loopRes.error,
      });
      await new Promise(r => setTimeout(r, 2000));
    }

    // ── Step 6: Meta Token Expiry Check ──
    if (!skipSteps.includes("token_check")) {
      const start = Date.now();
      console.log(`[daily-master-sync] Step 6: Meta token health check`);
      try {
        const metaToken = Deno.env.get("META_SHARED_ACCESS_TOKEN");
        if (metaToken) {
          // Call Meta debug_token to check expiry
          const debugRes = await fetch(
            `https://graph.facebook.com/v21.0/debug_token?input_token=${metaToken}&access_token=${metaToken}`
          );
          const debugData = await debugRes.json();
          const expiresAt = debugData?.data?.expires_at;

          if (expiresAt && expiresAt > 0) {
            const expiryDate = new Date(expiresAt * 1000);
            const daysUntilExpiry = Math.round((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

            results.push({
              step: "meta-token-check",
              success: daysUntilExpiry > 7,
              duration_ms: Date.now() - start,
              details: `Token expires in ${daysUntilExpiry} days (${expiryDate.toISOString().split("T")[0]})`,
            });

            if (daysUntilExpiry <= 7) {
              await createAlertTask(supabase,
                `🔑 Meta token expires in ${daysUntilExpiry} days`,
                `The META_SHARED_ACCESS_TOKEN expires on ${expiryDate.toISOString().split("T")[0]}. Generate a new long-lived token via Graph API Explorer (App ID: 815113834838322) and update the secret.`,
                daysUntilExpiry <= 3 ? "urgent" : "high"
              );
            }
          } else if (debugData?.data?.is_valid === false) {
            results.push({
              step: "meta-token-check",
              success: false,
              duration_ms: Date.now() - start,
              error: "Token is invalid or expired",
            });
            await createAlertTask(supabase,
              "🚨 Meta token is EXPIRED",
              "The META_SHARED_ACCESS_TOKEN is invalid. All Meta Ads syncs are broken. Generate a new token immediately.",
              "urgent"
            );
          } else {
            // Token doesn't expire (app token) or unknown
            results.push({
              step: "meta-token-check",
              success: true,
              duration_ms: Date.now() - start,
              details: "Token is valid (no expiry or long-lived)",
            });
          }
        } else {
          results.push({
            step: "meta-token-check",
            success: false,
            duration_ms: Date.now() - start,
            error: "META_SHARED_ACCESS_TOKEN not configured",
          });
        }
      } catch (err) {
        results.push({
          step: "meta-token-check",
          success: false,
          duration_ms: Date.now() - start,
          error: err instanceof Error ? err.message : "Unknown",
        });
      }
    }

    // ── Summary ──
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalDuration = results.reduce((s, r) => s + r.duration_ms, 0);

    console.log(`[daily-master-sync] Pipeline complete: ${succeeded}/${results.length} steps succeeded in ${Math.round(totalDuration / 1000)}s`);

    // Log to sync_logs
    await supabase.from("sync_logs").insert({
      client_id: "00000000-0000-0000-0000-000000000000", // System-level
      sync_type: "daily-master-sync",
      status: failed === 0 ? "completed" : "partial",
      records_synced: succeeded,
      error_message: failed > 0 ? results.filter(r => !r.success).map(r => `${r.step}: ${r.error}`).join("; ") : null,
      completed_at: new Date().toISOString(),
    });

    return { success: failed === 0, steps: results, totalDuration_ms: totalDuration };
  };

  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(doSync());
    return new Response(
      JSON.stringify({ success: true, message: "Daily master sync started (background)" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } else {
    const result = await doSync();
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
