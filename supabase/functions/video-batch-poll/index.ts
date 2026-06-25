// Polls outstanding video_batch_scenes (status='processing'),
// rehosts finished MP4s into the creatives bucket, registers a client_assets row,
// and updates parent batch counters. Invoked by pg_cron every 30s.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";

const MAX_POLL_ATTEMPTS = 90; // ~45 min at 30s cadence

function extractProviderModel(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p: any = payload;
  const candidates = [p.model, p.model_id, p.provider_model, p.downstream_model, p.request?.model, p.video?.model, p.output?.model, p.data?.model, p.data?.model_id, p.result?.model, p.result?.model_id, p.provider?.model, p.provider?.model_id];
  for (const v of candidates) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function logVideoModelDecision(event: string, details: Record<string, unknown>) {
  try { console.log(`[video-model-decision] ${JSON.stringify({ event, ts: new Date().toISOString(), ...details })}`); }
  catch { console.log(`[video-model-decision] ${event}`, details); }
}

async function recordVideoModelDecision(supa: any, event: string, details: Record<string, unknown>) {
  logVideoModelDecision(event, details);
  try {
    const asText = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
    await supa.from("ai_studio_video_model_decision_logs").insert({
      event,
      conversation_id: null,
      client_id: asText(details.client_id),
      user_id: asText(details.user_id),
      requested_model: asText(details.requested_model) || asText(details.raw_model) || asText(details.from_model),
      chosen_model: asText(details.chosen_model) || asText(details.effective_model) || asText(details.to_model),
      downstream_model: asText(details.downstream_model) || asText(details.provider_model),
      override_reason: asText(details.model_override_reason) || asText(details.routing_reason) || asText(details.reason),
      details,
    });
  } catch (e) {
    console.warn("[video-model-decision] persistent insert failed", e);
  }
}

async function pollOnce(pollingUrl: string, isOpenRouter: boolean): Promise<{ status: "processing" | "succeeded" | "failed"; videoUrl?: string; error?: string; providerModel?: string | null }> {
  const headers: Record<string, string> = {};
  if (isOpenRouter) headers.Authorization = `Bearer ${OPENROUTER_API_KEY}`;
  const res = await fetch(pollingUrl, { headers });
  if (!res.ok) {
    if (res.status === 404) return { status: "failed", error: `Poll 404 — upstream job missing` };
    return { status: "processing" }; // transient
  }
  const j = await res.json();
  const providerModel = extractProviderModel(j);
  if (isOpenRouter) {
    const status = String(j.status || "").toLowerCase();
    if (status === "succeeded" || status === "completed") {
      const videoUrl = j.video?.url
        || j.output?.[0]?.url
        || j.url
        || (Array.isArray(j.unsigned_urls) ? j.unsigned_urls[0] : null)
        || (Array.isArray(j.urls) ? j.urls[0] : null)
        || (Array.isArray(j.videos) ? j.videos[0]?.url : null);
      if (videoUrl) return { status: "succeeded", videoUrl, providerModel };
      return { status: "failed", error: `succeeded with no video url: ${JSON.stringify(j).slice(0, 200)}`, providerModel };
    }
    if (status === "failed" || status === "error" || status === "canceled") {
      return { status: "failed", error: j.error?.message || j.error || "upstream failed", providerModel };
    }
    return { status: "processing", providerModel };
  }
  // Veo (Gemini long-running operation)
  if (j.done === true) {
    if (j.error) return { status: "failed", error: j.error.message || JSON.stringify(j.error).slice(0, 200), providerModel: "veo-3.1-fast-generate-preview" };
    const fileUri = j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      || j.response?.videos?.[0]?.video?.uri
      || j.response?.predictions?.[0]?.videoUri;
    if (fileUri) {
      // Gemini file URIs need the API key appended.
      const key = Deno.env.get("GEMINI_API_KEY") || "";
      const url = fileUri.includes("?") ? `${fileUri}&key=${key}` : `${fileUri}?key=${key}`;
      return { status: "succeeded", videoUrl: url, providerModel: "veo-3.1-fast-generate-preview" };
    }
    return { status: "failed", error: "Veo done with no video uri", providerModel: "veo-3.1-fast-generate-preview" };
  }
  return { status: "processing", providerModel: isOpenRouter ? providerModel : "veo-3.1-fast-generate-preview" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: scenes, error: selErr } = await supa
      .from("video_batch_scenes")
      .select("id, batch_id, script_id, user_id, scene_order, polling_url, poll_attempts, prompt, duration")
      .eq("status", "processing")
      .order("created_at", { ascending: true })
      .limit(50);
    if (selErr) throw selErr;

    const batchTouched = new Set<string>();
    let processed = 0, finished = 0, failed = 0;

    for (const sc of scenes || []) {
      if (!sc.polling_url) continue;
      processed++;
      const isOpenRouter = sc.polling_url.includes("openrouter.ai");
      const { data: batchData } = await supa
        .from("video_batch_jobs").select("client_id, model, aspect_ratio").eq("id", sc.batch_id).single();
      let result;
      try {
        result = await pollOnce(sc.polling_url, isOpenRouter);
      } catch (e) {
        result = { status: "processing" as const };
      }
      const nextAttempts = (sc.poll_attempts || 0) + 1;
      if (result.providerModel && batchData?.model && result.providerModel !== batchData.model) {
        await recordVideoModelDecision(supa, "video_batch_poll.downstream_override", {
          user_id: sc.user_id,
          client_id: batchData.client_id || null,
          batch_id: sc.batch_id,
          scene_id: sc.id,
          phase: "polling",
          provider: isOpenRouter ? "openrouter" : "google",
          chosen_model: batchData.model,
          downstream_model: result.providerModel,
          model_override_reason: "provider_returned_different_model_while_polling",
          poll_attempts: nextAttempts,
        });
        if (String(batchData.model).startsWith("alibaba/happyhorse") && /seedance/i.test(result.providerModel)) {
          await supa.from("video_batch_scenes").update({
            status: "failed", error: `HappyHorse downstream override blocked: provider returned ${result.providerModel}`, poll_attempts: nextAttempts,
          }).eq("id", sc.id);
          failed++;
          batchTouched.add(sc.batch_id);
          continue;
        }
      }

      if (result.status === "processing") {
        if (nextAttempts >= MAX_POLL_ATTEMPTS) {
          await supa.from("video_batch_scenes").update({
            status: "failed", error: "Timed out", poll_attempts: nextAttempts,
          }).eq("id", sc.id);
          failed++;
          batchTouched.add(sc.batch_id);
        } else {
          await supa.from("video_batch_scenes").update({ poll_attempts: nextAttempts }).eq("id", sc.id);
        }
        continue;
      }

      if (result.status === "failed") {
        await supa.from("video_batch_scenes").update({
          status: "failed", error: result.error || "failed", poll_attempts: nextAttempts,
        }).eq("id", sc.id);
        failed++;
        batchTouched.add(sc.batch_id);
        continue;
      }

      // succeeded — download + rehost
      try {
        const vr = await fetch(result.videoUrl!, isOpenRouter ? { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } } : undefined);
        if (!vr.ok) throw new Error(`download ${vr.status}`);
        const bytes = new Uint8Array(await vr.arrayBuffer());
        const path = `ai-studio/batch/${sc.batch_id}/${sc.id}.mp4`;
        const up = await supa.storage.from("creatives").upload(path, bytes, {
          contentType: "video/mp4", upsert: true,
        });
        if (up.error) throw up.error;
        const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);

        // Register in client_assets (best-effort)
        let assetId: string | null = null;
        if (batchData?.client_id) {
          const { data: assetRow } = await supa.from("client_assets").insert({
            client_id: batchData.client_id,
            asset_type: "scene_video",
            title: `Batch scene ${sc.scene_order}`,
            status: "completed",
            content: {
              video_url: pub.publicUrl,
              storage_path: path,
              source: "ai_studio_batch",
              batch_id: sc.batch_id,
              scene_id: sc.id,
              model: batchData.model,
              aspect_ratio: batchData.aspect_ratio,
              duration: sc.duration,
              prompt: sc.prompt,
            },
          }).select("id").maybeSingle();
          assetId = assetRow?.id || null;
        }

        await supa.from("video_batch_scenes").update({
          status: "done",
          raw_video_url: result.videoUrl,
          stored_video_url: pub.publicUrl,
          asset_id: assetId,
          poll_attempts: nextAttempts,
        }).eq("id", sc.id);
        finished++;
        batchTouched.add(sc.batch_id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supa.from("video_batch_scenes").update({
          status: "failed", error: `Rehost: ${msg}`, poll_attempts: nextAttempts,
        }).eq("id", sc.id);
        failed++;
        batchTouched.add(sc.batch_id);
      }
    }

    // Update parent batch counters/status
    for (const bid of batchTouched) {
      const { data: scenesForBatch } = await supa
        .from("video_batch_scenes")
        .select("status")
        .eq("batch_id", bid);
      const total = scenesForBatch?.length || 0;
      const done = scenesForBatch?.filter(r => r.status === "done").length || 0;
      const fail = scenesForBatch?.filter(r => r.status === "failed").length || 0;
      const open = total - done - fail;
      const status = open > 0 ? "processing" : (done > 0 ? (fail > 0 ? "completed_with_errors" : "completed") : "failed");
      await supa.from("video_batch_jobs").update({
        completed_scenes: done, failed_scenes: fail, status,
      }).eq("id", bid);
    }

    return new Response(JSON.stringify({ processed, finished, failed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("video-batch-poll error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});