import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouter, callOpenRouterJSON, AUDIO_MODELS } from "../_shared/openrouter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { call_id } = await req.json();
    if (!call_id) throw new Error("call_id required");

    const { data: call, error: callErr } = await supabase
      .from("client_weekly_calls")
      .select("id, client_id, recording_url, week_of")
      .eq("id", call_id)
      .maybeSingle();
    if (callErr) throw callErr;
    if (!call) throw new Error("call not found");

    await supabase.from("client_weekly_calls").update({ finalize_status: "processing" }).eq("id", call_id);

    let transcript = "";
    if (call.recording_url) {
      // Extract storage path from public/signed URL
      const marker = "/weekly-call-recordings/";
      const idx = call.recording_url.indexOf(marker);
      const path = idx >= 0 ? call.recording_url.slice(idx + marker.length).split("?")[0] : null;
      if (path) {
        const { data: blob, error: dlErr } = await supabase.storage.from("weekly-call-recordings").download(path);
        if (dlErr) throw dlErr;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        // Base64 encode in chunks (avoids stack overflow on large arrays)
        let bin = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
        }
        const b64 = btoa(bin);
        const dataUrl = `data:audio/webm;base64,${b64}`;

        try {
          const trResult = await callOpenRouter([{
            role: "user",
            content: [
              { type: "text", text: "Transcribe this weekly client call recording verbatim. Return ONLY the transcribed dialogue with speaker turns if identifiable. No preamble." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          }], { models: AUDIO_MODELS, temperature: 0.1, max_tokens: 8000 });
          transcript = trResult.text.trim();
        } catch (e) {
          console.warn("transcription failed:", e);
          transcript = "";
        }
      }
    }

    let summary = "";
    let proposedTasks: Array<{ title: string; assignee?: string; priority?: string }> = [];
    if (transcript) {
      // Summary
      try {
        const sumRes = await callOpenRouter([
          { role: "system", content: "You summarize weekly client marketing calls. Be terse, 4-6 bullet points, focus on decisions and outcomes. No preamble." },
          { role: "user", content: `Weekly call transcript:\n\n${transcript.slice(0, 20000)}` },
        ], { temperature: 0.3, max_tokens: 500 });
        summary = sumRes.text.trim();
      } catch (e) {
        console.warn("summary failed:", e);
      }
      // Task extraction
      try {
        const taskRes = await callOpenRouterJSON<{ tasks: Array<{ title: string; priority?: string }> }>([
          { role: "system", content: 'Extract action items from a weekly client call transcript. Return strict JSON: {"tasks":[{"title":"...","priority":"low|medium|high"}]}. Only concrete owner-actionable tasks discussed. Max 10.' },
          { role: "user", content: transcript.slice(0, 20000) },
        ], { temperature: 0.1, max_tokens: 800 });
        proposedTasks = Array.isArray(taskRes?.tasks) ? taskRes.tasks.slice(0, 10) : [];
      } catch (e) {
        console.warn("task extract failed:", e);
      }
    }

    await supabase.from("client_weekly_calls").update({
      transcript: transcript || null,
      summary_text: summary || null,
      proposed_tasks: proposedTasks as any,
      finalize_status: "done",
    }).eq("id", call_id);

    return new Response(JSON.stringify({ ok: true, transcript_len: transcript.length, tasks: proposedTasks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("weekly-call-finalize error:", err);
    try {
      const { call_id } = await req.clone().json().catch(() => ({}));
      if (call_id) await supabase.from("client_weekly_calls").update({ finalize_status: "error" }).eq("id", call_id);
    } catch (_) {}
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});