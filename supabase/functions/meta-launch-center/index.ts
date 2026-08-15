// Ads Launch Center — publishes a full Meta hierarchy (campaign → ad set →
// media upload → creative → ad), everything PAUSED. Resumable: each stage is
// persisted, so a retry skips already-created objects instead of duplicating.
//
// Auth: the dashboard's server-verifiable signed session token only.
// Meta access tokens never leave this function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyDashboardToken, readDashboardToken } from "../_shared/dashboardToken.ts";
import { GRAPH, META_VERSION, OBJECTIVES, validateLaunch } from "../_shared/metaLaunchValidation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dashboard-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function graphPost(path: string, params: Record<string, string>) {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error?.error_user_msg || body?.error?.message || JSON.stringify(body).slice(0, 400);
    throw new Error(`Meta ${path} failed (${res.status}): ${detail}`);
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let launchId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const member = await verifyDashboardToken(readDashboardToken(req, body));
    if (!member) return json({ success: false, error: "Session expired — please sign in again." }, 401);

    launchId = typeof body.launch_id === "string" ? body.launch_id : null;
    if (!launchId) return json({ success: false, error: "launch_id required" }, 400);

    const { data: launch, error: loadErr } = await supabase
      .from("meta_campaign_launches")
      .select("*")
      .eq("id", launchId)
      .maybeSingle();
    if (loadErr || !launch) return json({ success: false, error: "Launch draft not found" }, 404);
    if (launch.status === "published") {
      return json({ success: true, alreadyPublished: true, launch });
    }

    const errors = validateLaunch(launch as never);
    if (errors.length) return json({ success: false, error: "Validation failed", errors }, 400);

    const { data: client } = await supabase
      .from("clients")
      .select("id, name, meta_ad_account_id, meta_access_token, meta_system_user_token")
      .eq("id", launch.client_id)
      .maybeSingle();
    if (!client?.meta_ad_account_id) return json({ success: false, error: "Client has no Meta ad account configured" }, 400);

    const token =
      (client.meta_system_user_token || "").trim() ||
      (client.meta_access_token || "").trim() ||
      (Deno.env.get("META_SHARED_ACCESS_TOKEN") || "").trim();
    if (!token) return json({ success: false, error: "No Meta access token available for this client" }, 400);

    const actId = String(client.meta_ad_account_id).startsWith("act_")
      ? String(client.meta_ad_account_id)
      : `act_${client.meta_ad_account_id}`;

    const map = OBJECTIVES[launch.objective as keyof typeof OBJECTIVES];
    const patch: Record<string, unknown> = {
      status: "publishing",
      error_detail: null,
      retry_count: (launch.retry_count ?? 0) + (launch.status === "failed" ? 1 : 0),
    };
    await supabase.from("meta_campaign_launches").update(patch).eq("id", launchId);

    let campaignId: string | null = launch.meta_campaign_id;
    let adsetId: string | null = launch.meta_adset_id;
    let imageHash: string | null = launch.meta_image_hash;
    let videoId: string | null = launch.meta_video_id;
    let creativeMetaId: string | null = launch.meta_creative_id;
    let adId: string | null = launch.meta_ad_id;

    const save = (fields: Record<string, unknown>) =>
      supabase.from("meta_campaign_launches").update(fields).eq("id", launchId!);

    // Stage 1 — campaign
    if (!campaignId) {
      const campaign = await graphPost(`/${actId}/campaigns`, {
        name: launch.name,
        objective: map.obj,
        buying_type: "AUCTION",
        status: "PAUSED",
        special_ad_categories: JSON.stringify(
          launch.special_ad_category === "NONE" ? [] : [launch.special_ad_category],
        ),
        access_token: token,
      });
      campaignId = campaign.id;
      await save({ meta_campaign_id: campaignId, stage: "campaign" });
    }

    // Stage 2 — ad set. Restricted special ad categories reject operator-chosen
    // age targeting, so buildTargeting omits the age fields for those.
    if (!adsetId) {
      const targeting = buildTargeting(launch);
      const params: Record<string, string> = {
        name: `${launch.name} — Ad Set`,
        campaign_id: campaignId!,
        status: "PAUSED",
        billing_event: map.billing,
        optimization_goal: map.goal,
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        daily_budget: String(launch.daily_budget_cents),
        targeting: JSON.stringify(targeting),
        start_time: new Date(Date.now() + 3600_000).toISOString(),
        access_token: token,
      };
      if (launch.objective === "leads") {
        params.promoted_object = JSON.stringify({ pixel_id: launch.pixel_id, custom_event_type: "LEAD" });
      }
      const adset = await graphPost(`/${actId}/adsets`, params);
      adsetId = adset.id;
      await save({ meta_adset_id: adsetId, stage: "adset" });
    }

    // Stage 3 — media upload
    if (!imageHash && !videoId) {
      const fileRes = await fetch(launch.creative_url);
      if (!fileRes.ok) throw new Error(`Could not download creative asset (${fileRes.status})`);
      const blob = await fileRes.blob();
      const fd = new FormData();
      fd.append("access_token", token);
      if (launch.creative_type === "image") {
        fd.append("filename", new File([blob], "creative.jpg", { type: blob.type || "image/jpeg" }));
        const res = await fetch(`${GRAPH}/${actId}/adimages`, { method: "POST", body: fd });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Image upload failed: ${JSON.stringify(out).slice(0, 300)}`);
        const key = Object.keys(out.images || {})[0];
        imageHash = key ? out.images[key].hash : null;
        if (!imageHash) throw new Error("Meta returned no image hash");
        await save({ meta_image_hash: imageHash, stage: "media" });
      } else {
        fd.append("source", new File([blob], "creative.mp4", { type: blob.type || "video/mp4" }));
        const res = await fetch(`${GRAPH}/${actId}/advideos`, { method: "POST", body: fd });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Video upload failed: ${JSON.stringify(out).slice(0, 300)}`);
        videoId = out.id;
        if (!videoId) throw new Error("Meta returned no video id");
        await save({ meta_video_id: videoId, stage: "media" });
      }
    }

    // Stage 4 — creative
    if (!creativeMetaId) {
      const cta = { type: launch.cta, value: { link: launch.destination_url } };
      const objectStorySpec: Record<string, unknown> = { page_id: launch.page_id };
      if (videoId) {
        objectStorySpec.video_data = {
          video_id: videoId,
          title: launch.headline,
          message: launch.primary_text,
          link_description: launch.description || "",
          call_to_action: cta,
        };
      } else {
        objectStorySpec.link_data = {
          link: launch.destination_url,
          message: launch.primary_text,
          name: launch.headline,
          description: launch.description || "",
          image_hash: imageHash,
          call_to_action: cta,
        };
      }
      const creative = await graphPost(`/${actId}/adcreatives`, {
        name: `${launch.name} — Creative`,
        object_story_spec: JSON.stringify(objectStorySpec),
        access_token: token,
      });
      creativeMetaId = creative.id;
      await save({ meta_creative_id: creativeMetaId, stage: "creative" });
    }

    // Stage 5 — ad
    if (!adId) {
      const ad = await graphPost(`/${actId}/ads`, {
        name: `${launch.name} — Ad`,
        adset_id: adsetId!,
        creative: JSON.stringify({ creative_id: creativeMetaId }),
        status: "PAUSED",
        access_token: token,
      });
      adId = ad.id;
      await save({ meta_ad_id: adId, stage: "ad" });
    }

    await save({
      status: "published",
      stage: "done",
      published_at: new Date().toISOString(),
      error_detail: null,
    });

    if (launch.creative_id) {
      await supabase.from("creatives").update({ status: "launched" }).eq("id", launch.creative_id);
    }

    return json({
      success: true,
      graphVersion: META_VERSION,
      launchId,
      campaignId,
      adsetId,
      creativeId: creativeMetaId,
      adId,
      message: "Campaign, ad set, creative and ad created in PAUSED state",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("meta-launch-center failed:", message);
    if (launchId) {
      await supabase
        .from("meta_campaign_launches")
        .update({ status: "failed", error_detail: { message, at: new Date().toISOString() } })
        .eq("id", launchId);
    }
    return json({ success: false, launchId, error: message }, 500);
  }
});