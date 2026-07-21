import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouter, callOpenRouterJSON } from "../_shared/openrouter.ts";
import { transcribeRecording } from "../_shared/transcription.ts";

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

    // Fetch facilitator-authored recap notes / wins so the summary + task extractor
    // can incorporate what the team explicitly flagged, not just the transcript.
    let recapNotes = "";
    let winsText = "";
    try {
      const { data: items } = await supabase
        .from("client_weekly_call_items")
        .select("kind, text, member_name")
        .eq("call_id", call_id)
        .in("kind", ["recap_note", "scorecard_note", "creative_note", "win"]);
      if (Array.isArray(items)) {
        recapNotes = items
          .filter((i: any) => i.kind === "recap_note" || i.kind === "scorecard_note" || i.kind === "creative_note")
          .map((i: any) => `[${i.kind}] ${i.text || ""}`.trim())
          .filter(Boolean)
          .join("\n\n");
        winsText = items
          .filter((i: any) => i.kind === "win")
          .map((i: any) => `- ${i.member_name || "Team"}: ${i.text || ""}`)
          .join("\n");
      }
    } catch (e) {
      console.warn("recap notes fetch failed:", e);
    }

    let transcript = "";
    if (call.recording_url) {
      // Extract storage path from public/signed URL
      const marker = "/weekly-call-recordings/";
      const idx = call.recording_url.indexOf(marker);
      const path = idx >= 0 ? call.recording_url.slice(idx + marker.length).split("?")[0] : null;
      if (path) {
        const { data: blob, error: dlErr } = await supabase.storage.from("weekly-call-recordings").download(path);
        if (dlErr) throw dlErr;
        try {
          transcript = await transcribeRecording(blob, {
            fileName: path.split("/").pop() || "weekly-call-recording.webm",
            prompt: "Weekly client marketing call. Transcribe verbatim with speaker turns if identifiable.",
          });
        } catch (e) {
          console.warn("transcription failed:", e);
          transcript = "";
        }
      }
    }

    let summary = "";
    let title = "";
    let proposedTasks: Array<{ title: string; assignee?: string; priority?: string }> = [];
    const hasSource = transcript || recapNotes || winsText;
    if (hasSource) {
      const contextBlock = [
        winsText ? `WINS:\n${winsText}` : "",
        recapNotes ? `FACILITATOR RECAP NOTES (authoritative — reflect these in the summary and tasks):\n${recapNotes}` : "",
        transcript ? `TRANSCRIPT:\n${transcript.slice(0, 18000)}` : "",
      ].filter(Boolean).join("\n\n");

      // Summary
      try {
        const sumRes = await callOpenRouter([
          { role: "system", content: "You summarize weekly client marketing calls. Be terse, 4-6 bullet points, focus on decisions and outcomes. Always integrate the FACILITATOR RECAP NOTES if present — those override transcript inference. No preamble." },
          { role: "user", content: contextBlock },
        ], { temperature: 0.3, max_tokens: 500 });
        summary = sumRes.text.trim();
      } catch (e) {
        console.warn("summary failed:", e);
      }
      // Title
      try {
        const titleRes = await callOpenRouter([
          { role: "system", content: "You write concise 3-8 word titles for weekly client marketing calls. Capture the single most important theme or decision. Return the title only — no quotes, no preamble, no trailing punctuation." },
          { role: "user", content: (summary ? `SUMMARY:\n${summary}\n\n` : "") + contextBlock.slice(0, 6000) },
        ], { temperature: 0.4, max_tokens: 40 });
        title = titleRes.text.replace(/^["'\s]+|["'\s.!?]+$/g, "").split("\n")[0].slice(0, 120).trim();
      } catch (e) {
        console.warn("title failed:", e);
      }
      // Task extraction
      try {
        const taskRes = await callOpenRouterJSON<{ tasks: Array<{ title: string; priority?: string }> }>([
          { role: "system", content: 'Extract action items from a weekly client call. Return strict JSON: {"tasks":[{"title":"...","priority":"low|medium|high"}]}. Prioritize items explicitly listed in FACILITATOR RECAP NOTES, then transcript-derived actions. Only concrete owner-actionable tasks. Max 10.' },
          { role: "user", content: contextBlock },
        ], { temperature: 0.1, max_tokens: 800 });
        proposedTasks = Array.isArray(taskRes?.tasks) ? taskRes.tasks.slice(0, 10) : [];
      } catch (e) {
        console.warn("task extract failed:", e);
      }
    }

    await supabase.from("client_weekly_calls").update({
      transcript: transcript || null,
      summary_text: summary || null,
      title: title || null,
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