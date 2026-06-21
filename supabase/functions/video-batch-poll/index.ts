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

async function pollOnce(pollingUrl: string, isOpenRouter: boolean): Promise<{ status: "processing" | "succeeded" | "failed"; videoUrl?: string; error?: string }> {
  const headers: Record<string, string> = {};
  if (isOpenRouter) headers.Authorization = `Bearer ${OPENROUTER_API_KEY}`;
  const res = await fetch(pollingUrl, { headers });
  if (!res.ok) {
    if (res.status === 404) return { status: "failed", error: `Poll 404 — upstream job missing` };
    return { status: "processing" }; // transient
  }
  const j = await res.json();
  if (isOpenRouter) {
    const status = String(j.status || "").toLowerCase();
    if (status === "succeeded" || status === "completed") {
      const videoUrl = j.video?.url || j.output?.[0]?.url || j.url || (Array.isArray(j.videos) ? j.videos[0]?.url : null);
      if (videoUrl) return { status: "succeeded", videoUrl };
      return { status: "failed", error: `succeeded with no video url: ${JSON.stringify(j).slice(0, 200)}` };
    }
    if (status === "failed" || status === "error" || status === "canceled") {
      return { status: "failed", error: j.error?.message || j.error || "upstream failed" };
    }
    return { status: "processing" };
  }
  // Veo (Gemini long-running operation)
  if (j.done === true) {
    if (j.error) return { status: "failed", error: j.error.message || JSON.stringify(j.error).slice(0, 200) };
    const fileUri = j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
      || j.response?.videos?.[0]?.video?.uri
      || j.response?.predictions?.[0]?.videoUri;
    if (fileUri) {
      // Gemini file URIs need the API key appended.
      const key = Deno.env.get("GEMINI_API_KEY") || "";
      const url = fileUri.includes("?") ? `${fileUri}&key=${key}` : `${fileUri}?key=${key}`;
      return { status: "succeeded", videoUrl: url };
    }
    return { status: "failed", error: "Veo done with no video uri" };
  }
  return { status: "processing" };
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
      let result;
      try {
        result = await pollOnce(sc.polling_url, isOpenRouter);
      } catch (e) {
        result = { status: "processing" as const };
      }
      const nextAttempts = (sc.poll_attempts || 0) + 1;

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
        const vr = await fetch(result.videoUrl!);
        if (!vr.ok) throw new Error(`download ${vr.status}`);
        const bytes = new Uint8Array(await vr.arrayBuffer());
        const path = `ai-studio/batch/${sc.batch_id}/${sc.id}.mp4`;
        const up = await supa.storage.from("creatives").upload(path, bytes, {
          contentType: "video/mp4", upsert: true,
        });
        if (up.error) throw up.error;
        const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);

        // Pull client_id from parent batch
        const { data: batchData } = await supa
          .from("video_batch_jobs").select("client_id, model, aspect_ratio").eq("id", sc.batch_id).single();

        // Register in client_assets (best-effort)
        let assetId: string | null = null;
        if (batchData?.client_id) {
          const { data: assetRow } = await supa.from("client_assets").insert({
            client_id: batchData.client_id,
            user_id: sc.user_id,
            type: "video",
            url: pub.publicUrl,
            metadata: {
              source: "video_batch",
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