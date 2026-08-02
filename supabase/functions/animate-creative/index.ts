// Animate a static creative image into a short video.
//
// Single, honest endpoint used by the Creatives "Animate Image" button.
// - Reuses the verified OpenRouter /api/v1/videos request shapes per model
//   (Seedance frame_images + resolution, Grok frame_images + generate_audio),
//   plus Veo 3.1 predictLongRunning as an optional model.
// - Persists job state in public.creative_video_jobs so rendering survives
//   reloads and can be finished by a cron sweep.
// - Surfaces the provider's real status + message instead of a generic error.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENROUTER_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supa = createClient(SUPABASE_URL, SERVICE_KEY);

type Job = {
  id: string;
  creative_id: string;
  client_id: string | null;
  status: string;
  model: string;
  fallback_models: string[];
  prompt: string;
  source_image_url: string;
  aspect_ratio: string;
  resolution: string;
  duration: number;
  provider: string;
  provider_job_id: string | null;
  polling_url: string | null;
  attempts: number;
  poll_count: number;
  output_url: string | null;
};

const ALLOWED_MODELS: Record<string, { label: string; provider: "openrouter" | "google"; maxRes: string[]; pricePerSecond: number }> = {
  "bytedance/seedance-2.0-pro": { label: "Seedance 2.0 Pro", provider: "openrouter", maxRes: ["480p", "720p", "1080p"], pricePerSecond: 0.0938 },
  "bytedance/seedance-2.0-fast": { label: "Seedance 2.0 Fast", provider: "openrouter", maxRes: ["480p", "720p"], pricePerSecond: 0.0538 },
  "x-ai/grok-imagine-video-1.5": { label: "Grok Imagine 1.5", provider: "openrouter", maxRes: ["480p", "720p", "1080p"], pricePerSecond: 0.14 },
  "veo-3.1": { label: "Veo 3.1", provider: "google", maxRes: ["720p", "1080p"], pricePerSecond: 0.4 },
};

const DEFAULT_MODEL = "bytedance/seedance-2.0-pro";
const DEFAULT_FALLBACKS = ["x-ai/grok-imagine-video-1.5", "bytedance/seedance-2.0-fast"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getGeminiKey(): Promise<string | null> {
  try {
    const { data } = await supa.from("agency_settings").select("*").limit(1).maybeSingle();
    const row = (data || {}) as Record<string, unknown>;
    const settings = (row.settings && typeof row.settings === "object" ? row.settings : {}) as Record<string, unknown>;
    for (const v of [row.gemini_video_key, settings.gemini_video_key, row.gemini_api_key, settings.gemini_api_key]) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch (_) { /* fall through to env */ }
  return Deno.env.get("GEMINI_API_KEY") || null;
}

// ---------------------------------------------------------------- submit

function buildOpenRouterBody(job: Job, model: string) {
  const isSeedance = model.includes("seedance");
  const isGrok = model.includes("grok");
  const allowedAspects = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
  const aspect = allowedAspects.has(job.aspect_ratio) ? job.aspect_ratio : "9:16";
  const allowed = ALLOWED_MODELS[model]?.maxRes || ["720p"];
  const resolution = allowed.includes(job.resolution) ? job.resolution : allowed[allowed.length - 1];

  const body: Record<string, unknown> = {
    model,
    prompt: job.prompt,
    aspect_ratio: aspect,
    duration: Math.max(1, Math.min(15, Number(job.duration) || 5)),
    resolution,
    // Animating a static ad: no synthetic audio.
    generate_audio: false,
    frame_images: [
      { type: "image_url", image_url: { url: job.source_image_url }, frame_type: "first_frame" },
    ],
  };
  if (!isSeedance && !isGrok) {
    // Unknown OpenRouter video model — use the unified start-frame shape.
    delete body.frame_images;
    body.image_url = job.source_image_url;
  }
  return body;
}

async function submitOpenRouter(job: Job, model: string) {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY is not configured");
  const body = buildOpenRouterBody(job, model);
  const res = await fetch("https://openrouter.ai/api/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://reporting.highperformanceads.com",
      "X-Title": "Creative Animate",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`[animate-creative][submit] model=${model} status=${res.status} body=${text.slice(0, 500)}`);
  if (!res.ok) throw new Error(`${ALLOWED_MODELS[model]?.label || model} [${res.status}]: ${text.slice(0, 400)}`);
  const j = JSON.parse(text || "{}");
  const pollingUrl: string | undefined = j.polling_url;
  if (!pollingUrl) throw new Error(`${model} returned no polling_url: ${text.slice(0, 300)}`);
  return { provider: "openrouter" as const, providerJobId: String(j.id || crypto.randomUUID()), pollingUrl };
}

async function submitVeo(job: Job) {
  const key = await getGeminiKey();
  if (!key) throw new Error("No Gemini API key configured for Veo 3.1");
  const imgRes = await fetch(job.source_image_url);
  if (!imgRes.ok) throw new Error(`Could not read the creative image (${imgRes.status})`);
  const mime = imgRes.headers.get("content-type") || "image/png";
  const buf = new Uint8Array(await imgRes.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  const b64 = btoa(bin);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: job.prompt, image: { bytesBase64Encoded: b64, mimeType: mime } }],
        parameters: {
          aspectRatio: job.aspect_ratio === "1:1" ? "16:9" : job.aspect_ratio,
          durationSeconds: Math.max(4, Math.min(8, Number(job.duration) || 5)),
challenge: undefined,
        },
      }),
    },
  );
  const text = await res.text();
  console.log(`[animate-creative][submit] model=veo-3.1 status=${res.status} body=${text.slice(0, 500)}`);
  if (!res.ok) throw new Error(`Veo 3.1 [${res.status}]: ${text.slice(0, 400)}`);
  const j = JSON.parse(text || "{}");
  if (!j.name) throw new Error(`Veo 3.1 returned no operation: ${text.slice(0, 300)}`);
  return { provider: "google" as const, providerJobId: String(j.name), pollingUrl: null as string | null };
}

async function submitJob(job: Job, model: string) {
  const cfg = ALLOWED_MODELS[model];
  if (!cfg) throw new Error(`Unsupported video model: ${model}`);
  return cfg.provider === "google" ? await submitVeo(job) : await submitOpenRouter(job, model);
}

// ---------------------------------------------------------------- poll

function pickVideoUrl(payload: unknown): string | null {
  const found: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 7) return;
    if (typeof node === "string") {
      if (/^https?:\/\/\S+\.(mp4|mov|webm)(\?|$)/i.test(node)) found.push(node);
      return;
    }
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    if (typeof node === "object") {
      for (const k of Object.keys(node as Record<string, unknown>)) walk((node as Record<string, unknown>)[k], depth + 1);
    }
  };
  const p = payload as Record<string, unknown> | null;
  const direct: unknown[] = [];
  if (p) {
    const arr = (v: unknown) => (Array.isArray(v) ? v : []);
    for (const u of arr(p.unsigned_urls)) direct.push(u);
    for (const u of arr(p.urls)) direct.push(u);
    direct.push((p.video as Record<string, unknown> | undefined)?.url, p.video_url, p.url);
  }
  for (const d of direct) if (typeof d === "string" && d.startsWith("http")) found.push(d);
  if (!found.length) walk(payload, 0);
  return found[0] || null;
}

async function pollOnce(job: Job): Promise<{ done: boolean; url?: string; failed?: string; label?: string }> {
  if (job.provider === "google") {
    const key = await getGeminiKey();
    if (!key) return { done: false, failed: "No Gemini API key configured" };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${job.provider_job_id}?key=${key}`);
    const text = await res.text();
    if (!res.ok) return { done: false, label: `Veo poll ${res.status}` };
    const j = JSON.parse(text || "{}");
    if (j.error) return { done: true, failed: j.error?.message || "Veo failed" };
    if (!j.done) return { done: false, label: "Rendering…" };
    const uri = pickVideoUrl(j) || j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) return { done: true, failed: "Veo finished without a video URL" };
    // Veo download URIs require the API key as a query param; keep it server-side only.
    return { done: true, url: `${uri}${uri.includes("?") ? "&" : "?"}key=${key}` };
  }

  if (!job.polling_url) return { done: true, failed: "Missing polling URL" };
  const res = await fetch(job.polling_url, { headers: { Authorization: `Bearer ${OPENROUTER_KEY}` } });
  if (!res.ok) return { done: false, label: `Provider poll ${res.status}` };
  const j = await res.json().catch(() => null);
  const status = String((j as Record<string, unknown> | null)?.status || "").toLowerCase();
  if (status === "failed" || status === "error" || status === "canceled") {
    const err = (j as Record<string, unknown>)?.error;
    const msg = typeof err === "string" ? err : (err as Record<string, unknown>)?.message;
    return { done: true, failed: String(msg || `Provider reported ${status}`) };
  }
  if (status === "completed" || status === "succeeded") {
    let url = pickVideoUrl(j);
    if (!url) {
      try {
        const cr = await fetch(job.polling_url.replace(/\/+$/, "") + "/content", {
          headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
        });
        if (cr.ok) url = pickVideoUrl(await cr.json().catch(() => null));
      } catch (_) { /* surfaced below */ }
    }
    if (!url) return { done: true, failed: "Provider completed without a video URL" };
    return { done: true, url };
  }
  return { done: false, label: status ? `${status}…` : "Rendering…" };
}

// ---------------------------------------------------------------- finalize

async function storeAndAttach(job: Job, providerUrl: string) {
  const res = await fetch(providerUrl);
  if (!res.ok) throw new Error(`Could not download the finished video (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const path = `animated/${job.creative_id}/${job.id}.mp4`;
  const up = await supa.storage.from("creatives").upload(path, bytes, {
    contentType: "video/mp4",
    upsert: true,
  });
  if (up.error) throw new Error(`Storage upload failed: ${up.error.message}`);
  const publicUrl = supa.storage.from("creatives").getPublicUrl(path).data.publicUrl;

  const variationId = crypto.randomUUID();
  const { data: creative } = await supa
    .from("creatives")
    .select("ai_variations")
    .eq("id", job.creative_id)
    .maybeSingle();
  const existing = Array.isArray(creative?.ai_variations) ? creative!.ai_variations as unknown[] : [];
  const cost = (ALLOWED_MODELS[job.model]?.pricePerSecond || 0) * (Number(job.duration) || 5);
  const variation = {
    id: variationId,
    url: publicUrl,
    type: "video",
    prompt: job.prompt,
    model: job.model,
    description: `${ALLOWED_MODELS[job.model]?.label || job.model} · ${job.duration}s · ${job.resolution} · ${job.aspect_ratio}`,
    created_at: new Date().toISOString(),
  };
  const { error: updErr } = await supa
    .from("creatives")
    .update({ ai_variations: [...existing, variation] })
    .eq("id", job.creative_id);
  if (updErr) throw new Error(`Could not attach the variation: ${updErr.message}`);

  await supa.from("creative_video_jobs").update({
    status: "completed",
    output_path: path,
    output_url: publicUrl,
    variation_id: variationId,
    progress_label: "Saved",
    cost_usd: cost,
    completed_at: new Date().toISOString(),
    error: null,
  }).eq("id", job.id);

  return { ...variation, cost_usd: cost };
}

// Try the requested model, then each fallback once.
async function submitWithFallback(job: Job) {
  const chain = [job.model, ...(job.fallback_models || [])];
  const errors: string[] = [];
  for (const model of chain) {
    if (!ALLOWED_MODELS[model]) continue;
    try {
      const r = await submitJob(job, model);
      await supa.from("creative_video_jobs").update({
        model,
        provider: r.provider,
        provider_job_id: r.providerJobId,
        polling_url: r.pollingUrl,
        status: "rendering",
        attempts: (job.attempts || 0) + 1,
        progress_label: `Submitted to ${ALLOWED_MODELS[model].label}`,
        error: errors.length ? errors.join(" | ") : null,
      }).eq("id", job.id);
      return { model, label: ALLOWED_MODELS[model].label, fallbackNotes: errors };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[animate-creative][submit-failed] ${model}: ${msg}`);
      errors.push(msg);
    }
  }
  const finalError = errors.join(" | ") || "No usable video model";
  await supa.from("creative_video_jobs").update({
    status: "failed",
    error: finalError,
    progress_label: "Failed to start",
  }).eq("id", job.id);
  throw new Error(finalError);
}

async function advance(job: Job) {
  if (job.status === "completed" || job.status === "failed") return job;
  if (job.status === "queued" || !job.provider_job_id) {
    await submitWithFallback(job);
    const { data } = await supa.from("creative_video_jobs").select("*").eq("id", job.id).single();
    return data as Job;
  }
  const r = await pollOnce(job);
  if (!r.done) {
    await supa.from("creative_video_jobs").update({
      poll_count: (job.poll_count || 0) + 1,
      progress_label: r.label || "Rendering…",
    }).eq("id", job.id);
  } else if (r.failed) {
    await supa.from("creative_video_jobs").update({
      status: "failed", error: r.failed, progress_label: "Failed",
    }).eq("id", job.id);
  } else if (r.url) {
    await supa.from("creative_video_jobs").update({ status: "saving", progress_label: "Saving…" }).eq("id", job.id);
    try {
      await storeAndAttach(job, r.url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supa.from("creative_video_jobs").update({ status: "failed", error: msg, progress_label: "Save failed" }).eq("id", job.id);
    }
  }
  const { data } = await supa.from("creative_video_jobs").select("*").eq("id", job.id).single();
  return data as Job;
}

// ---------------------------------------------------------------- handler

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "start");

    if (action === "models") {
      return json({
        models: Object.entries(ALLOWED_MODELS).map(([id, m]) => ({ id, ...m })),
        default: DEFAULT_MODEL,
      });
    }

    if (action === "start") {
      const creativeId = String(body.creativeId || "");
      const imageUrl = String(body.imageUrl || "");
      const prompt = String(body.prompt || "").trim();
      if (!creativeId || !imageUrl || !prompt) {
        return json({ error: "creativeId, imageUrl and prompt are required" }, 400);
      }
      const model = ALLOWED_MODELS[body.model] ? String(body.model) : DEFAULT_MODEL;
      const fallbacks = (Array.isArray(body.fallbackModels) ? body.fallbackModels : DEFAULT_FALLBACKS)
        .filter((m: unknown) => typeof m === "string" && ALLOWED_MODELS[m as string] && m !== model);

      const { data: inserted, error } = await supa.from("creative_video_jobs").insert({
        creative_id: creativeId,
        client_id: body.clientId || null,
        model,
        fallback_models: fallbacks,
        prompt,
        source_image_url: imageUrl,
        aspect_ratio: ["1:1", "16:9", "9:16", "4:3", "3:4"].includes(body.aspectRatio) ? body.aspectRatio : "9:16",
        resolution: ["480p", "720p", "1080p"].includes(body.resolution) ? body.resolution : "720p",
        duration: Math.max(1, Math.min(15, Number(body.duration) || 5)),
        status: "queued",
        progress_label: "Submitting…",
      }).select("*").single();
      if (error) return json({ error: `Could not create the job: ${error.message}` }, 500);

      try {
        const result = await submitWithFallback(inserted as Job);
        return json({ jobId: inserted.id, model: result.model, modelLabel: result.label, fallbackNotes: result.fallbackNotes });
      } catch (e) {
        return json({ jobId: inserted.id, error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    if (action === "status") {
      const jobId = String(body.jobId || "");
      if (!jobId) return json({ error: "jobId is required" }, 400);
      const { data, error } = await supa.from("creative_video_jobs").select("*").eq("id", jobId).maybeSingle();
      if (error || !data) return json({ error: "Job not found" }, 404);
      const job = await advance(data as Job);
      return json({ job });
    }

    if (action === "sweep") {
      const { data: open } = await supa
        .from("creative_video_jobs")
        .select("*")
        .in("status", ["queued", "rendering", "saving"])
        .order("created_at", { ascending: true })
        .limit(15);
      let advanced = 0, finished = 0, expired = 0;
      for (const raw of (open || []) as Job[]) {
        const ageMin = (Date.now() - new Date((raw as unknown as { created_at: string }).created_at).getTime()) / 60000;
        if (ageMin > 30) {
          await supa.from("creative_video_jobs").update({
            status: "failed", error: "Timed out after 30 minutes", progress_label: "Timed out",
          }).eq("id", raw.id);
          expired++;
          continue;
        }
        try {
          const j = await advance(raw);
          advanced++;
          if (j?.status === "completed") finished++;
        } catch (e) {
          console.error(`[animate-creative][sweep] job=${raw.id} ${e instanceof Error ? e.message : e}`);
        }
      }
      return json({ advanced, finished, expired });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("[animate-creative] fatal", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});