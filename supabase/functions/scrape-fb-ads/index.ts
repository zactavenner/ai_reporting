import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Meta Marketing API configuration
const META_APP_ID = "815113834838322";
const META_GRAPH_API_VERSION = "v21.0";
const META_GRAPH_API_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

interface MetaAd {
  id: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  ad_delivery_start_time?: string;
  ad_snapshot_url?: string;
  bylines?: string;
  currency?: string;
  impressions?: { lower_bound?: string; upper_bound?: string };
  page_id?: string;
  page_name?: string;
  publisher_platforms?: string[];
  spend?: { lower_bound?: string; upper_bound?: string };
  eu_total_reach?: number;
  languages?: string[];
  target_ages?: string;
  target_gender?: string;
  target_locations?: { name: string }[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId, pageId, adsLibraryUrl } = await req.json();
    console.log("Meta Marketing API scrape request:", { clientId, pageId, adsLibraryUrl });

    if (!clientId) {
      return new Response(
        JSON.stringify({ success: false, error: "clientId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the Meta App Secret from environment
    const appSecret = Deno.env.get("META_APP_SECRET");
    if (!appSecret) {
      console.error("META_APP_SECRET not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Meta App Secret not configured. Please add your Meta App Secret in settings." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch client to get Meta access token if available
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("meta_access_token, meta_ad_account_id")
      .eq("id", clientId)
      .single();

    if (clientError) {
      console.error("Error fetching client:", clientError);
    }

    // Extract page ID from URL if needed
    let targetPageId = pageId;
    if (!targetPageId && adsLibraryUrl) {
      const urlMatch = adsLibraryUrl.match(/view_all_page_id=(\d+)/);
      if (urlMatch) {
        targetPageId = urlMatch[1];
      }
    }

    if (!targetPageId) {
      return new Response(
        JSON.stringify({ success: false, error: "Page ID is required. Provide either pageId or adsLibraryUrl with view_all_page_id parameter." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Target page ID:", targetPageId);

    // Generate app access token (app_id|app_secret format)
    const appAccessToken = `${META_APP_ID}|${appSecret}`;

    // Call Meta Ad Library API
    const adsLibraryParams = new URLSearchParams({
      access_token: appAccessToken,
      ad_reached_countries: "['US']",
      ad_active_status: "ACTIVE",
      ad_type: "ALL",
      search_page_ids: `[${targetPageId}]`,
      fields: [
        "id",
        "ad_creative_bodies",
        "ad_creative_link_titles",
        "ad_creative_link_descriptions",
        "ad_creative_link_captions",
        "ad_delivery_start_time",
        "ad_snapshot_url",
        "bylines",
        "currency",
        "impressions",
        "page_id",
        "page_name",
        "publisher_platforms",
        "spend",
        "eu_total_reach",
        "languages",
        "target_ages",
        "target_gender",
        "target_locations"
      ].join(","),
      limit: "50"
    });

    console.log("Calling Meta Ad Library API...");
    const adsResponse = await fetch(
      `${META_GRAPH_API_URL}/ads_archive?${adsLibraryParams.toString()}`,
      { method: "GET" }
    );

    if (!adsResponse.ok) {
      const errorText = await adsResponse.text();
      console.error("Meta API error:", adsResponse.status, errorText);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Meta API error: ${adsResponse.status}. ${errorText.substring(0, 500)}` 
        }),
        { status: adsResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adsData = await adsResponse.json();
    console.log("Meta API response received, data length:", JSON.stringify(adsData).length);

    const ads: MetaAd[] = adsData.data || [];
    console.log(`Found ${ads.length} ads from Meta Ad Library`);

    if (ads.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          adsCount: 0, 
          message: "No active ads found for this page" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Construct ads library URL for reference
    const adsLibraryBaseUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=${targetPageId}`;

    // Process and store ads
    const storedAds = [];
    
    for (const ad of ads) {
      try {
        // Extract media info from ad snapshot URL
        let thumbnailUrl: string | null = null;
        const mediaUrls: string[] = [];
        let mediaType = "image";

        // The ad_snapshot_url contains the preview of the ad
        if (ad.ad_snapshot_url) {
          thumbnailUrl = ad.ad_snapshot_url;
        }

        // If client has Meta access token, try to get more detailed media
        if (client?.meta_access_token && ad.id) {
          try {
            const creativeResponse = await fetch(
              `${META_GRAPH_API_URL}/${ad.id}?access_token=${client.meta_access_token}&fields=effective_object_story_id`,
              { method: "GET" }
            );
            
            if (creativeResponse.ok) {
              const creativeData = await creativeResponse.json();
              console.log("Additional creative data for ad", ad.id, ":", JSON.stringify(creativeData).substring(0, 200));
            }
          } catch (err) {
            console.log("Could not fetch additional creative data:", err);
          }
        }

        // Parse impressions bucket
        let impressionsBucket: string | null = null;
        if (ad.impressions) {
          const lower = ad.impressions.lower_bound || "0";
          const upper = ad.impressions.upper_bound || "";
          impressionsBucket = upper ? `${lower}-${upper}` : `${lower}+`;
        }

        // Determine platforms
        const platforms = ad.publisher_platforms || ["facebook"];

        const adRecord = {
          client_id: clientId,
          ad_library_id: ad.id,
          ad_library_url: ad.ad_snapshot_url || `${adsLibraryBaseUrl}&id=${ad.id}`,
          page_id: ad.page_id || targetPageId,
          page_name: ad.page_name || ad.bylines || "Unknown",
          primary_text: ad.ad_creative_bodies?.[0]?.substring(0, 2000) || null,
          headline: ad.ad_creative_link_titles?.[0]?.substring(0, 500) || null,
          description: ad.ad_creative_link_descriptions?.[0]?.substring(0, 500) || null,
          cta_type: null, // Not directly available in Ad Library API
          media_type: mediaType,
          media_urls: mediaUrls,
          thumbnail_url: thumbnailUrl,
          status: "active",
          platforms: platforms.map((p: string) => p.toLowerCase()),
          started_running_on: ad.ad_delivery_start_time || null,
          impressions_bucket: impressionsBucket,
          scraped_at: new Date().toISOString(),
          raw_markdown: JSON.stringify(ad),
        };

        const { data: insertedAd, error: insertError } = await supabase
          .from("client_live_ads")
          .upsert(adRecord, {
            onConflict: "ad_library_id",
            ignoreDuplicates: false,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error inserting ad:", insertError, "Ad ID:", ad.id);
        } else if (insertedAd) {
          storedAds.push(insertedAd);
        }
      } catch (adError) {
        console.error("Error processing ad:", adError);
      }
    }

    // Update client settings with the page ID for future use
    await supabase
      .from("client_settings")
      .upsert({
        client_id: clientId,
        ads_library_page_id: targetPageId,
        ads_library_url: adsLibraryBaseUrl,
      }, { onConflict: "client_id" });

    console.log(`Successfully stored ${storedAds.length} ads from Meta Marketing API`);

    return new Response(
      JSON.stringify({
        success: true,
        adsCount: storedAds.length,
        ads: storedAds,
        totalFromMeta: ads.length,
        message: `Synced ${storedAds.length} active ads from Meta Ad Library`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in Meta Marketing API scrape:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to scrape ads";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
