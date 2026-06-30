import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

/**
 * Hyperframes-style chat editor for a saved client_video.
 * - Takes a plain-English edit instruction (e.g. "trim first 2s, add a softer hook, swap card color to gold")
 * - Uses Lovable AI Gateway (Gemini Flash) to refine the original prompt into a new Seedance prompt.
 * - Re-renders via OpenRouter Seedance, rehosts to the `creatives` bucket, and stores the new clip as a child client_video.
 * - Persists the user + assistant turns in `video_edit_messages`.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { sourceVideoId, clientId, instruction } = await req.json();
    if (!sourceVideoId || !clientId || !instruction?.trim()) {
      return json({ error: "sourceVideoId, clientId, instruction required" }, 400);
    }
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: source, error: sErr } = await supa
      .from("client_videos")
      .select("*")
      .eq("id", sourceVideoId)
      .single();
    if (sErr || !source) throw new Error("Source video not found");

    // Persist user message immediately
    await supa.from("video_edit_messages").insert({
      source_video_id: sourceVideoId,
      client_id: clientId,
      role: "user",
      content: instruction,
    });

    // Pull recent edit history for short context
    const { data: history } = await supa
      .from("video_edit_messages")
      .select("role, content")
      .eq("source_video_id", sourceVideoId)
      .order("created_at", { ascending: true })
      .limit(20);

    // 1) Refine the prompt with Lovable AI Gateway
    const refinePayload = {
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      messages: [
        {
          role: "system",
          content:
            "You are a video-prompt director. Given an existing Seedance prompt for a 9:16/16:9 ad clip and a user edit instruction, rewrite a new SINGLE Seedance prompt that incorporates the edit. Keep brand details, aspect ratio, and intent. Output ONLY the new prompt — no preface, no markdown.",
        },
        {
          role: "user",
          content:
            `ORIGINAL PROMPT:\n${source.prompt || "(none)"}\n\nASPECT: ${source.aspect_ratio || "9:16"}\nDURATION: ${source.duration_seconds || 5}s\n\nEDIT HISTORY:\n${(history || []).map((m: any) => `${m.role}: ${m.content}`).join("\n")}\n\nNEW INSTRUCTION:\n${instruction}`,
        },
      ],
    };
    const refineRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://reporting.highperformanceads.com",
        "X-Title": "Video Edit Chat",
      },
      body: JSON.stringify(refinePayload),
    });
    if (!refineRes.ok) throw new Error(`Refine failed ${refineRes.status}: ${(await refineRes.text()).slice(0, 200)}`);
    const refineJson = await refineRes.json();
    const newPrompt: string = refineJson?.choices?.[0]?.message?.content?.trim() || `${source.prompt}\n\n${instruction}`;

    // 2) Submit Seedance job
    const model = source.model?.includes("kling") ? source.model : (source.model || "bytedance/seedance-2.0-fast");
    const aspect = source.aspect_ratio || "9:16";
    const submit = await fetch("https://openrouter.ai/api/v1/videos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://reporting.highperformanceads.com",
        "X-Title": "AI Studio Video Editor",
      },
      body: JSON.stringify({
        model,
        prompt: newPrompt,
        resolution: source.resolution || "720p",
        aspect_ratio: aspect,
        duration: source.duration_seconds || 5,
        ...(source.poster_url ? { image_url: source.poster_url } : {}),
      }),
    });
    if (!submit.ok) throw new Error(`Seedance submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
    const sj = await submit.json();
    const pollingUrl: string | undefined = sj.polling_url;
    const jobId = sj.id || crypto.randomUUID();
    if (!pollingUrl) throw new Error("No polling_url from Seedance");

    let videoUrl: string | null = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const p = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
      if (!p.ok) continue;
      const pj = await p.json();
      if (pj.status === "completed") {
        const urls: string[] = pj.unsigned_urls || pj.urls || (pj.video?.url ? [pj.video.url] : []);
        videoUrl = urls[0] || null;
        break;
      }
      if (pj.status === "failed") throw new Error(`Seedance failed: ${pj.error || "unknown"}`);
    }
    if (!videoUrl) throw new Error("Seedance timed out");

    // 3) Download (authed) + rehost
    const dl = await fetch(videoUrl, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
    if (!dl.ok) throw new Error(`Download failed ${dl.status}`);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    const path = `ai-studio/${clientId}/edit-${jobId}-${Date.now()}.mp4`;
    const up = await supa.storage.from("creatives").upload(path, bytes, { contentType: "video/mp4", upsert: false });
    if (up.error) throw new Error(`Rehost failed: ${up.error.message}`);
    const { data: pub } = supa.storage.from("creatives").getPublicUrl(path);
    const storedUrl = pub.publicUrl;

    // 4) Insert child client_video
    const { data: child, error: cErr } = await supa.from("client_videos").insert({
      client_id: clientId,
      title: `Edit of ${source.title || "video"}`,
      prompt: newPrompt,
      storage_url: storedUrl,
      storage_path: path,
      poster_url: source.poster_url,
      source_url: videoUrl,
      source: "video_edit",
      parent_video_id: sourceVideoId,
      model,
      aspect_ratio: aspect,
      duration_seconds: source.duration_seconds,
      resolution: source.resolution,
      status: "completed",
      edit_instructions: instruction,
      metadata: { job_id: jobId },
    }).select().single();
    if (cErr) throw cErr;

    const reply = `Done. New version ready (${aspect}, ${source.duration_seconds || 5}s). I applied: "${instruction}".`;
    await supa.from("video_edit_messages").insert({
      source_video_id: sourceVideoId,
      client_id: clientId,
      role: "assistant",
      content: reply,
      result_video_id: child.id,
      metadata: { model, new_prompt: newPrompt },
    });

    return json({ reply, video: child });
  } catch (e: any) {
    console.error("video-edit-chat error", e);
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}