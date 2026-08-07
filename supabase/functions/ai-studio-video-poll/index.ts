// Standalone AI Studio video reaper.
//
// Video completion used to depend entirely on the in-request
// EdgeRuntime.waitUntil worker inside `ai-studio`. When that instance was
// recycled (or the SSE request hit the 150s idle timeout), a finished render
// stayed "processing" on the canvas until the user happened to start another
// chat turn — which is what made production look slow and inaccurate.
//
// This function runs on pg_cron every minute, polls OpenRouter for every
// pending scene_video card that has a persisted polling_url, rehosts the MP4
// into the `creatives` bucket, and writes the terminal payload. It is
// idempotent and safe to run concurrently with the chat worker.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Hard ceiling: a card older than this with no provider result is dead.
const MAX_AGE_MS = 75 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const result = { scanned: 0, completed: 0, failed: 0, in_flight: 0 };

  try {
    if (!OPENROUTER_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rows, error } = await supa
      .from("ai_studio_canvas_items")
      .select("id, payload, created_at, conversation_id, user_id")
      .eq("kind", "scene_video")
      .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    for (const row of rows || []) {
      const p: any = row.payload || {};
      if (p?.status !== "processing" || p?.video_url) continue;
      const pollingUrl: string | undefined = p.polling_url
        || (p.provider_job_id ? `https://openrouter.ai/api/v1/videos/${p.provider_job_id}` : undefined);
      const ageMs = Date.now() - new Date(row.created_at as string).getTime();
      result.scanned++;

      if (!pollingUrl) {
        if (ageMs > MAX_AGE_MS) {
          await supa.from("ai_studio_canvas_items").update({
            placeholder_until: null,
            payload: { ...p, status: "failed", failed_at: new Date().toISOString(), reaper: true,
              error: `${p.requested_model || p.model || "Video"} render was submitted without a provider handle and cannot be recovered. Re-submit to retry.` },
          }).eq("id", row.id);
          result.failed++;
        }
        continue;
      }

      let pj: any = null;
      try {
        const r = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
        if (r.ok) pj = await r.json();
        else console.warn(`poll ${row.id} -> ${r.status}`);
      } catch (e) {
        console.warn(`poll ${row.id} threw`, String(e));
      }

      const status = String(pj?.status || "").toLowerCase();

      if (status === "completed") {
        const urls: string[] = pj.unsigned_urls || pj.signed_urls || pj.urls || (pj.video?.url ? [pj.video.url] : []);
        const providerUrl = urls.find((u: unknown) => typeof u === "string" && /^https?:\/\//.test(u));
        if (!providerUrl) {
          await supa.from("ai_studio_canvas_items").update({
            placeholder_until: null,
            payload: { ...p, status: "failed", failed_at: new Date().toISOString(), reaper: true,
              error: "Provider reported completed but returned no video URL. Re-submit to retry." },
          }).eq("id", row.id);
          result.failed++;
          continue;
        }
        // Rehost so the canvas never points at an expiring provider URL.
        let storedUrl = providerUrl;
        let storagePath: string | null = null;
        try {
          const dl = await fetch(providerUrl, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
          if (!dl.ok) throw new Error(`download ${dl.status}`);
          const bytes = new Uint8Array(await dl.arrayBuffer());
          if (bytes.byteLength < 1024) throw new Error("file too small");
          const jobId = p.provider_job_id || p.job_id || row.id;
          const folder = String(p.model || "").includes("hailuo") ? "hailuo" : "seedance";
          const path = `ai-studio/${p.client_id || "shared"}/${folder}/${jobId}-${Date.now()}.mp4`;
          const up = await supa.storage.from("creatives").upload(path, bytes, { contentType: "video/mp4", upsert: false });
          if (up.error) throw new Error(up.error.message);
          const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);
          storedUrl = pub.publicUrl;
          storagePath = path;
        } catch (e) {
          console.warn(`rehost failed for ${row.id}, keeping provider url`, String(e));
        }
        await supa.from("ai_studio_canvas_items").update({
          placeholder_until: null,
          payload: {
            ...p,
            status: "completed",
            video_url: storedUrl,
            storage_path: storagePath ?? p.storage_path ?? null,
            completed_at: new Date().toISOString(),
            completed_by: "cron_reaper",
          },
        }).eq("id", row.id);
        result.completed++;
        continue;
      }

      if (status === "failed" || status === "cancelled") {
        const msg = pj?.error?.message || pj?.error || `Provider reported ${status}`;
        await supa.from("ai_studio_canvas_items").update({
          placeholder_until: null,
          payload: { ...p, status: "failed", failed_at: new Date().toISOString(), reaper: true,
            error: `${p.requested_model || p.model || "Video"}: ${String(msg).slice(0, 300)}` },
        }).eq("id", row.id);
        result.failed++;
        continue;
      }

      if (ageMs > MAX_AGE_MS) {
        await supa.from("ai_studio_canvas_items").update({
          placeholder_until: null,
          payload: { ...p, status: "failed", failed_at: new Date().toISOString(), reaper: true,
            error: `${p.requested_model || p.model || "Video"} render is still ${status || "queued"} at the provider after 75 minutes. Re-submit to retry.` },
        }).eq("id", row.id);
        result.failed++;
        continue;
      }

      // Still rendering — keep the card alive so no sweep kills it.
      await supa.from("ai_studio_canvas_items").update({
        placeholder_until: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        payload: { ...p, provider_status: status || "in_progress", last_polled_at: new Date().toISOString(), progress: pj?.progress ?? p.progress ?? null },
      }).eq("id", row.id);
      result.in_flight++;
    }

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-studio-video-poll error", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message || e), ...result }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
