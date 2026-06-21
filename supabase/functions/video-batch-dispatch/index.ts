// Multi-script video batch dispatcher.
// Accepts 1..N scripts, segments each into model-appropriate scenes,
// fans out OpenRouter video submissions (concurrency cap), and returns a batchId.
// Actual polling + rehost is done by the cron-driven video-batch-poll function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

const MODEL_CAPS: Record<string, { durations: number[]; defaultDuration: number; maxRes: "720p" | "1080p" }> = {
  "bytedance/seedance-2.0-fast":  { durations: [4, 5, 8, 10, 12, 15], defaultDuration: 5,  maxRes: "720p" },
  "bytedance/seedance-2.0-pro":   { durations: [4, 5, 8, 10, 12, 15], defaultDuration: 10, maxRes: "1080p" },
  "kwaivgi/kling-v3.0-std":       { durations: [5, 10],                defaultDuration: 5,  maxRes: "1080p" },
  "kwaivgi/kling-v2.1-master":    { durations: [5, 10],                defaultDuration: 10, maxRes: "1080p" },
  "google/veo-3.1-fast":          { durations: [4, 6, 8],              defaultDuration: 8,  maxRes: "1080p" },
};

function estimateScriptSeconds(text: string): number {
  // ~2.5 words/sec speech default; respect explicit "(30s)" / "30 seconds" hints.
  const m = text.match(/(\d{1,3})\s*(?:s|sec|secs|seconds)\b/i);
  if (m) return Math.max(4, Math.min(180, Number(m[1])));
  const words = (text.trim().split(/\s+/).filter(Boolean).length) || 0;
  return Math.max(4, Math.round(words / 2.5));
}

function segmentScript(content: string, totalSeconds: number, sceneDuration: number) {
  const sceneCount = Math.max(1, Math.ceil(totalSeconds / sceneDuration));
  // Split content into approximately equal word chunks.
  const words = content.trim().split(/\s+/).filter(Boolean);
  const perScene = Math.max(1, Math.ceil(words.length / sceneCount));
  const scenes: { order: number; prompt: string; duration: number }[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const slice = words.slice(i * perScene, (i + 1) * perScene).join(" ") || content.slice(0, 200);
    scenes.push({ order: i + 1, prompt: slice, duration: sceneDuration });
  }
  return scenes;
}

async function submitOpenRouterVideo(opts: {
  model: string;
  prompt: string;
  aspect: string;
  duration: number;
  resolution: string;
}): Promise<{ pollingUrl: string; jobId: string }> {
  const isSeedance = opts.model.startsWith("bytedance/seedance");
  const isKling = opts.model.startsWith("kwaivgi/kling");
  const body: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
    aspect_ratio: opts.aspect,
    duration: opts.duration,
  };
  if (isSeedance) body.resolution = opts.resolution;
  // Kling rejects extra params; only prompt/aspect/duration.
  if (!isSeedance && !isKling) {
    // (unused — Veo handled separately below)
  }
  const res = await fetch("https://openrouter.ai/api/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://reporting.highperformanceads.com",
      "X-Title": "AI Studio Batch",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter submit ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  if (!j.polling_url) throw new Error(`No polling_url: ${JSON.stringify(j).slice(0, 200)}`);
  return { pollingUrl: j.polling_url as string, jobId: (j.id as string) || crypto.randomUUID() };
}

async function submitVeoVideo(opts: { prompt: string; aspect: string; duration: number }): Promise<{ pollingUrl: string; jobId: string }> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY required for Veo");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: opts.prompt }],
      parameters: { aspectRatio: opts.aspect, durationSeconds: opts.duration },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Veo submit ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  const opName: string = j.name;
  if (!opName) throw new Error(`Veo returned no operation name: ${JSON.stringify(j).slice(0, 200)}`);
  return { pollingUrl: `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${GEMINI_API_KEY}`, jobId: opName };
}

async function pMap<T, R>(items: T[], cap: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx]); } catch (e) { results[idx] = e as any; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => worker()));
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supaUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supaUser.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json();
    const {
      scripts,
      model,
      aspectRatio = "9:16",
      duration,
      resolution,
      clientId,
      characterDescription,
      offerDescription,
    } = body || {};

    if (!Array.isArray(scripts) || scripts.length === 0) {
      return new Response(JSON.stringify({ error: "scripts[] required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (scripts.length > 10) {
      return new Response(JSON.stringify({ error: "Maximum 10 scripts per batch" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const caps = MODEL_CAPS[model];
    if (!caps) {
      return new Response(JSON.stringify({ error: `Unsupported model: ${model}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const sceneDuration = caps.durations.includes(Number(duration)) ? Number(duration) : caps.defaultDuration;
    const effectiveRes = (resolution === "720p" || resolution === "1080p") ? resolution : caps.maxRes;

    // 1. Create the batch row first (so we have an id for everything).
    const { data: batchRow, error: batchErr } = await supa
      .from("video_batch_jobs")
      .insert({
        user_id: userId,
        client_id: clientId || null,
        model,
        aspect_ratio: aspectRatio,
        default_duration: sceneDuration,
        resolution: effectiveRes,
        character_description: characterDescription || null,
        offer_description: offerDescription || null,
        total_scenes: 0,
      })
      .select("id")
      .single();
    if (batchErr) throw batchErr;
    const batchId = batchRow.id as string;

    // 2. For each script: insert script row + scene rows.
    type SceneTask = {
      sceneRowId: string;
      prompt: string;
      duration: number;
    };
    const sceneTasks: SceneTask[] = [];
    let totalScenes = 0;

    for (let s = 0; s < scripts.length; s++) {
      const sc = scripts[s] || {};
      const content: string = String(sc.content || "").trim();
      if (!content) continue;
      const title: string = String(sc.title || `Script ${s + 1}`).slice(0, 200);

      const { data: scriptRow, error: scriptErr } = await supa
        .from("video_batch_scripts")
        .insert({ batch_id: batchId, user_id: userId, script_order: s + 1, title, content })
        .select("id")
        .single();
      if (scriptErr) throw scriptErr;

      const totalSec = estimateScriptSeconds(content);
      const segments = segmentScript(content, totalSec, sceneDuration);

      // Optional: prefix every scene prompt with character + offer context for consistency.
      const ctxPrefix = [
        characterDescription ? `Character: ${characterDescription}` : null,
        offerDescription ? `Offer: ${offerDescription}` : null,
      ].filter(Boolean).join(" | ");

      const sceneRowsToInsert = segments.map((seg) => ({
        batch_id: batchId,
        script_id: scriptRow.id,
        user_id: userId,
        scene_order: seg.order,
        prompt: ctxPrefix ? `${ctxPrefix}\n\n${seg.prompt}` : seg.prompt,
        duration: seg.duration,
        status: "queued",
      }));
      const { data: insertedScenes, error: scErr } = await supa
        .from("video_batch_scenes")
        .insert(sceneRowsToInsert)
        .select("id, prompt, duration");
      if (scErr) throw scErr;
      for (const row of insertedScenes || []) {
        sceneTasks.push({ sceneRowId: row.id, prompt: row.prompt, duration: row.duration });
      }
      totalScenes += segments.length;
    }

    await supa.from("video_batch_jobs").update({ total_scenes: totalScenes }).eq("id", batchId);

    // 3. Fan out submissions with concurrency cap 8.
    const isVeo = model.startsWith("google/veo");
    await pMap(sceneTasks, 8, async (task) => {
      try {
        const submit = isVeo
          ? await submitVeoVideo({ prompt: task.prompt, aspect: aspectRatio, duration: task.duration })
          : await submitOpenRouterVideo({ model, prompt: task.prompt, aspect: aspectRatio, duration: task.duration, resolution: effectiveRes });
        await supa.from("video_batch_scenes").update({
          status: "processing",
          provider_job_id: submit.jobId,
          polling_url: submit.pollingUrl,
        }).eq("id", task.sceneRowId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await supa.from("video_batch_scenes").update({ status: "failed", error: msg }).eq("id", task.sceneRowId);
      }
    });

    // Recount failures from submit phase.
    const { count: failedCount } = await supa
      .from("video_batch_scenes")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("status", "failed");
    await supa.from("video_batch_jobs").update({ failed_scenes: failedCount || 0 }).eq("id", batchId);

    return new Response(JSON.stringify({ batchId, totalScenes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("video-batch-dispatch error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});