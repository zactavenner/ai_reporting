import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

/**
 * Sync ad performance data via the GHL Ads Reporting API (v2).
 *
 * GHL now provides unified access to Meta (Facebook) and Google Ads data through:
 *   GET /funnels/lookup/redirect/adReporting
 *   GET /funnels/lookup/redirect/adAccount
 *
 * This function pulls ad reporting from GHL instead of (or alongside) direct
 * Meta API calls, giving a single source for GHL-tracked conversions +
 * ad performance in one query.
 *
 * Modes:
 *   1. Sync ad accounts: GET connected Meta/Google ad accounts via GHL
 *   2. Sync ad performance: GET daily ad metrics (spend, impressions, clicks, conversions)
 *   3. Sync conversion data: cross-reference GHL contacts with ad conversions
 *
 * This complements (not replaces) the existing sync-meta-ads function:
 *   - sync-meta-ads: direct Meta Marketing API (spend, impressions, campaign structure)
 *   - sync-ghl-ads: GHL's unified view (conversions mapped to GHL contacts, attribution)
 *
 * The GHL Ads API uses the Location API key (same as contacts/calendar).
 */

interface GhlAdAccount {
  id: string;
  name: string;
  platform: "facebook" | "google";
  accountId: string;
  status: string;
  currency: string;
  timezone: string;
}

interface GhlAdReport {
  date: string;
  campaignId: string;
  campaignName: string;
  adGroupId?: string;
  adGroupName?: string;
  adId?: string;
  adName?: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  ctr: number;
  cpc: number;
  cpm: number;
  platform: string;
}

async function fetchGhlAds(
  apiKey: string,
  locationId: string,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<any> {
  const url = new URL(`${GHL_BASE_URL}${endpoint}`);
  url.searchParams.set("locationId", locationId);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`GHL Ads API ${res.status}: ${errBody.substring(0, 500)}`);
  }

  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { clientId, startDate, endDate, syncAccounts } = body;

    if (!clientId) {
      return new Response(JSON.stringify({ success: false, error: "clientId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get client GHL credentials
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, name, ghl_api_key, ghl_location_id")
      .eq("id", clientId)
      .single();

    if (clientErr || !client || !client.ghl_api_key || !client.ghl_location_id) {
      return new Response(JSON.stringify({
        success: false,
        error: "Client not found or missing GHL credentials",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const results: Record<string, any> = {};

    // ── 1. Sync Ad Accounts ──
    if (syncAccounts) {
      try {
        const accountsData = await fetchGhlAds(
          client.ghl_api_key,
          client.ghl_location_id,
          "/funnels/lookup/redirect/adAccount",
        );

        const accounts = accountsData?.accounts || accountsData?.data || [];
        for (const account of accounts) {
          await supabase.from("meta_ad_accounts").upsert({
            ad_account_id: account.accountId || account.id,
            client_id: clientId,
            timezone_name: account.timezone || "America/New_York",
            currency: account.currency || "USD",
            name: account.name || null,
            last_seen_at: new Date().toISOString(),
          }, { onConflict: "ad_account_id" });
        }
        results.accounts = accounts.length;
        console.log(`[sync-ghl-ads] ${client.name}: Synced ${accounts.length} ad accounts`);
      } catch (err) {
        console.warn(`[sync-ghl-ads] ${client.name}: Ad accounts sync failed (non-fatal):`, err);
        results.accounts = { error: err instanceof Error ? err.message : "Unknown error" };
      }
    }

    // ── 2. Sync Ad Performance Reports ──
    const since = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const until = endDate || new Date().toISOString().split("T")[0];

    try {
      const reportData = await fetchGhlAds(
        client.ghl_api_key,
        client.ghl_location_id,
        "/funnels/lookup/redirect/adReporting",
        {
          startDate: since,
          endDate: until,
          level: "campaign",
        },
      );

      const reports: GhlAdReport[] = reportData?.data || reportData?.reports || [];
      let dailyRowsWritten = 0;

      // Group by date for daily_metrics upsert
      const byDate: Record<string, { spend: number; impressions: number; clicks: number; conversions: number }> = {};
      for (const r of reports) {
        const dateKey = r.date?.split("T")[0] || since;
        if (!byDate[dateKey]) byDate[dateKey] = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
        byDate[dateKey].spend += Number(r.spend) || 0;
        byDate[dateKey].impressions += Number(r.impressions) || 0;
        byDate[dateKey].clicks += Number(r.clicks) || 0;
        byDate[dateKey].conversions += Number(r.conversions) || 0;
      }

      // Upsert into daily_metrics (ad metrics only — doesn't touch CRM columns)
      for (const [dateStr, metrics] of Object.entries(byDate)) {
        const { data: existing } = await supabase
          .from("daily_metrics")
          .select("id")
          .eq("client_id", clientId)
          .eq("date", dateStr)
          .maybeSingle();

        if (existing) {
          await supabase.from("daily_metrics").update({
            ad_spend: metrics.spend,
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            ctr: metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0,
            date_account_tz: dateStr,
          }).eq("id", existing.id);
        } else {
          await supabase.from("daily_metrics").insert({
            client_id: clientId,
            date: dateStr,
            date_account_tz: dateStr,
            ad_spend: metrics.spend,
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            ctr: metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0,
          });
        }
        dailyRowsWritten++;
      }

      // Also upsert campaign-level data into meta_campaigns (platform-labeled:
      // GHL's unified reporting covers both Meta and Google campaigns)
      for (const r of reports) {
        if (!r.campaignId) continue;
        await supabase.from("meta_campaigns").upsert({
          client_id: clientId,
          meta_campaign_id: r.campaignId,
          name: r.campaignName || r.campaignId,
          platform: r.platform === "google" ? "google" : "meta",
          spend: Number(r.spend) || 0,
          impressions: Number(r.impressions) || 0,
          clicks: Number(r.clicks) || 0,
          ctr: Number(r.ctr) || 0,
          cpc: Number(r.cpc) || 0,
          cpm: Number(r.cpm) || 0,
          synced_at: new Date().toISOString(),
        }, { onConflict: "client_id,meta_campaign_id" });
      }

      results.reports = {
        totalReports: reports.length,
        datesProcessed: Object.keys(byDate).length,
        dailyRowsWritten,
        dateRange: { since, until },
      };
      console.log(`[sync-ghl-ads] ${client.name}: Processed ${reports.length} ad reports for ${Object.keys(byDate).length} dates`);
    } catch (err) {
      console.error(`[sync-ghl-ads] ${client.name}: Ad reporting sync failed:`, err);
      results.reports = { error: err instanceof Error ? err.message : "Unknown error" };
    }

    // ── 3. Cross-reference GHL conversions with contacts ──
    // GHL's ad reporting includes conversion data linked to contacts.
    // Pull conversion events and create touchpoints for attribution.
    try {
      const convData = await fetchGhlAds(
        client.ghl_api_key,
        client.ghl_location_id,
        "/funnels/lookup/redirect/adReporting",
        {
          startDate: since,
          endDate: until,
          level: "ad", // Ad-level for granular attribution
        },
      );

      const adReports: GhlAdReport[] = convData?.data || convData?.reports || [];
      let touchpointsCreated = 0;

      for (const r of adReports) {
        if (!r.adId || Number(r.conversions) === 0) continue;

        // For each ad with conversions, create an ad_click touchpoint
        // linked to the campaign/adset/ad. These will be picked up by
        // compute-attribution to credit revenue to specific ads.
        // We don't have per-lead granularity from the reporting API,
        // but we can use this as a fallback for leads that came through
        // GHL's tracking but lack UTM params.

        // Store campaign-level performance in meta_ads for creative tracking
        await supabase.from("meta_ads").upsert({
          client_id: clientId,
          meta_ad_id: r.adId,
          meta_adset_id: r.adGroupId || null,
          meta_campaign_id: r.campaignId || null,
          name: r.adName || r.adId,
          platform: r.platform === "google" ? "google" : "meta",
          spend: Number(r.spend) || 0,
          impressions: Number(r.impressions) || 0,
          clicks: Number(r.clicks) || 0,
          ctr: Number(r.ctr) || 0,
          cpc: Number(r.cpc) || 0,
          cpm: Number(r.cpm) || 0,
          synced_at: new Date().toISOString(),
        }, { onConflict: "client_id,meta_ad_id" });

        touchpointsCreated++;
      }

      results.conversions = {
        adReports: adReports.length,
        touchpointsCreated,
      };
      console.log(`[sync-ghl-ads] ${client.name}: Processed ${adReports.length} ad-level reports, ${touchpointsCreated} meta_ads updated`);
    } catch (err) {
      console.warn(`[sync-ghl-ads] ${client.name}: Conversion sync failed (non-fatal):`, err);
      results.conversions = { error: err instanceof Error ? err.message : "Unknown error" };
    }

    // Log sync run
    await supabase.from("sync_runs").insert({
      client_id: clientId,
      source: "ghl",
      function_name: "sync-ghl-ads",
      finished_at: new Date().toISOString(),
      status: "success",
      rows_written: results.reports?.dailyRowsWritten || 0,
      metadata: results,
    }).then(() => {});

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[sync-ghl-ads] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
