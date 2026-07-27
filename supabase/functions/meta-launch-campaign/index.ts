// End-to-end Meta campaign launcher. Creates campaign + adset + creatives + ads,
// all PAUSED. Optionally creates a lead form. Rolls back the campaign on hard
// failure so we don't leave orphans.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const V = "v21.0";
const G = `https://graph.facebook.com/${V}`;

type Creative = {
  fileUrl: string;
  fileType: "image" | "video";
  fileName?: string;
  name?: string;
  message?: string;
  headline?: string;
  description?: string;
  linkUrl?: string;
  callToActionType?: string;
  videoThumbnailUrl?: string;
};

// Objective → (campaign objective, optimization_goal, billing_event)
const OBJECTIVE_MAP: Record<string, { obj: string; goal: string; billing: string; cta: string }> = {
  leads:       { obj: "OUTCOME_LEADS",      goal: "LEAD_GENERATION",     billing: "IMPRESSIONS", cta: "SIGN_UP" },
  conversions: { obj: "OUTCOME_SALES",      goal: "OFFSITE_CONVERSIONS", billing: "IMPRESSIONS", cta: "LEARN_MORE" },
  traffic:     { obj: "OUTCOME_TRAFFIC",    goal: "LINK_CLICKS",         billing: "IMPRESSIONS", cta: "LEARN_MORE" },
  awareness:   { obj: "OUTCOME_AWARENESS",  goal: "REACH",               billing: "IMPRESSIONS", cta: "LEARN_MORE" },
  engagement:  { obj: "OUTCOME_ENGAGEMENT", goal: "POST_ENGAGEMENT",     billing: "IMPRESSIONS", cta: "LEARN_MORE" },
};

async function post(url: string, params: Record<string, string>) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url.split("?")[0]} ${r.status}: ${JSON.stringify(j).slice(0, 500)}`);
  return j;
}

async function uploadCreative(actId: string, token: string, c: Creative) {
  const fileRes = await fetch(c.fileUrl);
  if (!fileRes.ok) throw new Error(`Download failed for ${c.fileUrl}: ${fileRes.status}`);
  const blob = await fileRes.blob();
  const safeName = c.fileName || `creative-${Date.now()}`;
  const fd = new FormData();
  fd.append("access_token", token);
  if (c.fileType === "image") {
    fd.append("filename", new File([blob], safeName, { type: blob.type || "image/jpeg" }));
    const r = await fetch(`${G}/${actId}/adimages`, { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(`image upload: ${JSON.stringify(j)}`);
    const k = Object.keys(j.images || {})[0];
    return { imageHash: k ? j.images[k].hash : null, imageUrl: k ? j.images[k].url : null };
  } else {
    fd.append("source", new File([blob], safeName, { type: blob.type || "video/mp4" }));
    if (c.fileName) fd.append("name", c.fileName);
    const r = await fetch(`${G}/${actId}/advideos`, { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(`video upload: ${JSON.stringify(j)}`);
    return { videoId: j.id as string };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let campaignId: string | null = null;
  let accessToken = "";

  try {
    const body = await req.json();
    const {
      clientId,
      campaignName,
      objective = "leads",
      dailyBudgetDollars,
      adSetName,
      pageId,
      instagramActorId,
      pixelId,
      customEventType, // for conversions
      leadFormId,      // existing lead form
      newLeadForm,     // { name, questions, privacy_policy_url, thank_you_page, locale, intro }
      targeting = { geo_locations: { countries: ["US"] } },
      creatives = [] as Creative[],
      specialAdCategories = [] as string[],
    } = body;

    if (!clientId) throw new Error("clientId required");
    if (!campaignName) throw new Error("campaignName required");
    if (!adSetName) throw new Error("adSetName required");
    if (!pageId) throw new Error("pageId required");
    if (!dailyBudgetDollars || Number(dailyBudgetDollars) < 1) throw new Error("dailyBudgetDollars must be ≥ 1");
    if (!creatives.length) throw new Error("At least one creative required");

    const map = OBJECTIVE_MAP[objective];
    if (!map) throw new Error(`Unsupported objective: ${objective}`);

    const { data: client } = await supabase
      .from("clients")
      .select("meta_access_token, meta_ad_account_id, name")
      .eq("id", clientId).single();
    if (!client?.meta_ad_account_id) throw new Error("Client missing Meta ad account");
    accessToken = client.meta_access_token || Deno.env.get("META_SHARED_ACCESS_TOKEN") || "";
    if (!accessToken) throw new Error("No Meta access token");
    const actId = client.meta_ad_account_id.startsWith("act_") ? client.meta_ad_account_id : `act_${client.meta_ad_account_id}`;

    // 1. Optionally create lead form on the page
    let resolvedLeadFormId: string | undefined = leadFormId;
    if (objective === "leads" && !resolvedLeadFormId && newLeadForm) {
      const lfPayload: Record<string, string> = {
        name: newLeadForm.name || campaignName,
        access_token: accessToken,
        follow_up_action_url: newLeadForm.thank_you_url || "https://facebook.com",
        privacy_policy: JSON.stringify({ url: newLeadForm.privacy_policy_url || "https://facebook.com/privacy" }),
        questions: JSON.stringify(newLeadForm.questions || [
          { type: "FULL_NAME" }, { type: "EMAIL" }, { type: "PHONE" },
        ]),
        locale: newLeadForm.locale || "en_US",
      };
      if (newLeadForm.intro) lfPayload.question_page_custom_headline = newLeadForm.intro;
      const lf = await post(`${G}/${pageId}/leadgen_forms`, lfPayload);
      resolvedLeadFormId = lf.id;
    }

    // 2. Campaign
    const camp = await post(`${G}/${actId}/campaigns`, {
      name: campaignName,
      objective: map.obj,
      buying_type: "AUCTION",
      status: "PAUSED",
      special_ad_categories: JSON.stringify(specialAdCategories),
      access_token: accessToken,
    });
    campaignId = camp.id;

    // 3. Ad Set
    const promoted: Record<string, any> = {};
    if (objective === "leads" && pageId) promoted.page_id = pageId;
    if (objective === "conversions") {
      if (!pixelId) throw new Error("pixelId required for conversions objective");
      promoted.pixel_id = pixelId;
      promoted.custom_event_type = customEventType || "LEAD";
    }

    const adSetParams: Record<string, string> = {
      name: adSetName,
      campaign_id: campaignId!,
      status: "PAUSED",
      billing_event: map.billing,
      optimization_goal: map.goal,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      daily_budget: String(Math.round(Number(dailyBudgetDollars) * 100)),
      targeting: JSON.stringify(targeting),
      start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      access_token: accessToken,
    };
    if (Object.keys(promoted).length) adSetParams.promoted_object = JSON.stringify(promoted);
    const adset = await post(`${G}/${actId}/adsets`, adSetParams);
    const adSetId = adset.id;

    // 4. Upload creatives + create ads
    const createdAds: any[] = [];
    for (let i = 0; i < creatives.length; i++) {
      const c = creatives[i];
      const up = await uploadCreative(actId, accessToken, c);
      const cta = c.callToActionType || map.cta;
      const linkUrl = c.linkUrl || (newLeadForm?.thank_you_url) || "https://facebook.com";

      const objectStorySpec: any = { page_id: pageId };
      if (instagramActorId) objectStorySpec.instagram_actor_id = instagramActorId;

      const ctaObj: any = { type: cta };
      if (objective === "leads" && resolvedLeadFormId) {
        ctaObj.value = { lead_gen_form_id: resolvedLeadFormId };
      } else {
        ctaObj.value = { link: linkUrl };
      }

      if ((up as any).videoId) {
        objectStorySpec.video_data = {
          video_id: (up as any).videoId,
          title: c.headline || c.name || campaignName,
          message: c.message || "",
          call_to_action: ctaObj,
          ...(c.videoThumbnailUrl ? { image_url: c.videoThumbnailUrl } : {}),
        };
      } else {
        objectStorySpec.link_data = {
          link: linkUrl,
          message: c.message || "",
          name: c.headline || c.name || campaignName,
          description: c.description || "",
          image_hash: (up as any).imageHash,
          call_to_action: ctaObj,
        };
      }

      const creative = await post(`${G}/${actId}/adcreatives`, {
        name: `${c.name || campaignName} creative ${i + 1}`,
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token: accessToken,
      });

      const ad = await post(`${G}/${actId}/ads`, {
        name: c.name || `${campaignName} - ad ${i + 1}`,
        adset_id: adSetId,
        creative: JSON.stringify({ creative_id: creative.id }),
        status: "PAUSED",
        access_token: accessToken,
      });
      createdAds.push({ adId: ad.id, creativeId: creative.id, ...up });
    }

    // 5. Cache locally so the ads table shows them immediately
    await supabase.from("meta_campaigns").upsert({
      client_id: clientId,
      meta_campaign_id: campaignId,
      name: campaignName,
      status: "PAUSED",
      objective: map.obj,
      buying_type: "AUCTION",
      synced_at: new Date().toISOString(),
    }, { onConflict: "client_id,meta_campaign_id" });

    const { data: localCamp } = await supabase
      .from("meta_campaigns").select("id")
      .eq("client_id", clientId).eq("meta_campaign_id", campaignId!).single();

    await supabase.from("meta_ad_sets").upsert({
      client_id: clientId,
      campaign_id: localCamp?.id,
      meta_adset_id: adSetId,
      meta_campaign_id: campaignId,
      name: adSetName,
      status: "PAUSED",
      daily_budget: Number(dailyBudgetDollars),
      optimization_goal: map.goal,
      billing_event: map.billing,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting,
      synced_at: new Date().toISOString(),
    }, { onConflict: "client_id,meta_adset_id" });

    return new Response(JSON.stringify({
      success: true,
      campaignId,
      adSetId,
      leadFormId: resolvedLeadFormId,
      ads: createdAds,
      message: `Created campaign + ${createdAds.length} ad(s) in PAUSED state`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("meta-launch-campaign error:", e);
    // Rollback: delete campaign if it was created
    if (campaignId && accessToken) {
      try { await fetch(`${G}/${campaignId}?access_token=${accessToken}`, { method: "DELETE" }); } catch {}
    }
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});