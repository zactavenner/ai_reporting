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
  let launchRowId: string | null = null;

  const logEvent = async (event: string, detail: Record<string, unknown> = {}) => {
    if (!launchRowId) return;
    try {
      await supabase.from("campaign_launch_events").insert({ launch_id: launchRowId, event, detail });
    } catch { /* best-effort */ }
  };

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
      idempotencyKey,
      offeringExemption,
      complianceApprovalId,
    } = body;

    if (!clientId) throw new Error("clientId required");
    if (!campaignName) throw new Error("campaignName required");
    if (!adSetName) throw new Error("adSetName required");
    if (!pageId) throw new Error("pageId required");
    if (!dailyBudgetDollars || Number(dailyBudgetDollars) < 1) throw new Error("dailyBudgetDollars must be ≥ 1");
    if (!creatives.length) throw new Error("At least one creative required");
    if (!idempotencyKey) throw new Error("idempotencyKey required");

    const map = OBJECTIVE_MAP[objective];
    if (!map) throw new Error(`Unsupported objective: ${objective}`);

    // 0. Idempotency — reuse existing launch row if the key was seen before.
    const { data: existing } = await supabase
      .from("campaign_launches")
      .select("id,status,meta_campaign_id,meta_adset_ids,meta_ad_ids,meta_lead_form_id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      // If we already produced Meta objects, return them and skip re-creation.
      if (existing.status === "created_paused" || existing.status === "active") {
        return new Response(JSON.stringify({
          success: true,
          launchId: existing.id,
          campaignId: existing.meta_campaign_id,
          adSetId: (existing.meta_adset_ids || [])[0],
          leadFormId: existing.meta_lead_form_id,
          ads: (existing.meta_ad_ids || []).map((id: string) => ({ adId: id, creativeId: null })),
          reused: true,
          message: "Idempotent replay — returning existing launch",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      launchRowId = existing.id;
      await supabase.from("campaign_launches").update({
        status: "in_progress", current_step: "restart", error_message: null,
      }).eq("id", launchRowId);
    } else {
      const { data: fresh, error: freshErr } = await supabase
        .from("campaign_launches")
        .insert({
          client_id: clientId,
          idempotency_key: idempotencyKey,
          status: "in_progress",
          current_step: "start",
          payload: body,
          offering_exemption: offeringExemption ?? null,
          compliance_approval_id: complianceApprovalId ?? null,
        })
        .select("id")
        .single();
      if (freshErr) throw new Error(`Failed to record launch: ${freshErr.message}`);
      launchRowId = fresh.id;
    }
    await logEvent("started", { objective, dailyBudgetDollars });

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
      await supabase.from("campaign_launches").update({ current_step: "lead_form" }).eq("id", launchRowId);
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
      await supabase.from("campaign_launch_objects").insert({
        launch_id: launchRowId, kind: "leadform", meta_id: lf.id, status: "created",
      });
      await logEvent("lead_form_created", { leadFormId: lf.id });
    }

    // 2. Campaign
    await supabase.from("campaign_launches").update({ current_step: "campaign" }).eq("id", launchRowId);
    const camp = await post(`${G}/${actId}/campaigns`, {
      name: campaignName,
      objective: map.obj,
      buying_type: "AUCTION",
      status: "PAUSED",
      special_ad_categories: JSON.stringify(specialAdCategories),
      access_token: accessToken,
    });
    campaignId = camp.id;
    await supabase.from("campaign_launch_objects").insert({
      launch_id: launchRowId, kind: "campaign", meta_id: campaignId, status: "created",
    });
    await logEvent("campaign_created", { campaignId });

    // 3. Ad Set
    await supabase.from("campaign_launches").update({ current_step: "ad_set" }).eq("id", launchRowId);
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
    await supabase.from("campaign_launch_objects").insert({
      launch_id: launchRowId, kind: "adset", meta_id: adSetId, status: "created",
    });
    await logEvent("adset_created", { adSetId });

    // 4. Upload creatives + create ads
    await supabase.from("campaign_launches").update({ current_step: "ads" }).eq("id", launchRowId);
    const createdAds: any[] = [];
    const creativeIds: string[] = [];
    const adIds: string[] = [];
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
      creativeIds.push(creative.id);
      await supabase.from("campaign_launch_objects").insert({
        launch_id: launchRowId, kind: "creative", ordinal: i, meta_id: creative.id, status: "created",
      });

      const ad = await post(`${G}/${actId}/ads`, {
        name: c.name || `${campaignName} - ad ${i + 1}`,
        adset_id: adSetId,
        creative: JSON.stringify({ creative_id: creative.id }),
        status: "PAUSED",
        access_token: accessToken,
      });
      adIds.push(ad.id);
      await supabase.from("campaign_launch_objects").insert({
        launch_id: launchRowId, kind: "ad", ordinal: i, meta_id: ad.id, status: "created",
      });
      createdAds.push({ adId: ad.id, creativeId: creative.id, ...up });
    }
    await logEvent("ads_created", { count: createdAds.length });

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

    await supabase.from("campaign_launches").update({
      status: "created_paused",
      current_step: "done",
      meta_campaign_id: campaignId,
      meta_adset_ids: [adSetId],
      meta_ad_ids: adIds,
      meta_creative_ids: creativeIds,
      meta_lead_form_id: resolvedLeadFormId ?? null,
    }).eq("id", launchRowId);
    await logEvent("completed", { campaignId, adSetId, adCount: adIds.length });

    return new Response(JSON.stringify({
      success: true,
      launchId: launchRowId,
      campaignId,
      adSetId,
      leadFormId: resolvedLeadFormId,
      ads: createdAds,
      message: `Created campaign + ${createdAds.length} ad(s) in PAUSED state`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("meta-launch-campaign error:", e);
    const errMsg = e instanceof Error ? e.message : String(e);
    if (launchRowId) {
      const partial = campaignId != null;
      await supabase.from("campaign_launches").update({
        status: partial ? "partial" : "failed",
        error_message: errMsg,
        meta_campaign_id: campaignId,
      }).eq("id", launchRowId);
      await logEvent("failed", { error: errMsg, partial });
    }
    // Rollback: delete campaign if it was created
    if (campaignId && accessToken) {
      try { await fetch(`${G}/${campaignId}?access_token=${accessToken}`, { method: "DELETE" }); } catch {}
    }
    return new Response(JSON.stringify({ success: false, launchId: launchRowId, error: errMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});