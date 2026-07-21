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
  let huddleIdForError: string | null = null;

  try {
    const { huddle_id } = await req.json();
    if (!huddle_id) throw new Error("huddle_id required");
    huddleIdForError = huddle_id;

    const { data: huddle, error: hErr } = await supabase
      .from("huddles")
      .select("id, date, recording_url")
      .eq("id", huddle_id)
      .maybeSingle();
    if (hErr) throw hErr;
    if (!huddle) throw new Error("huddle not found");

    await supabase.from("huddles").update({ finalize_status: "processing" }).eq("id", huddle_id);

    // Gather structured context: wins + commitments + reviewed clients.
    let winsText = "";
    try {
      const { data: wins } = await supabase
        .from("huddle_wins").select("member_name, text").eq("huddle_id", huddle_id);
      if (Array.isArray(wins)) winsText = wins.map((w: any) => `- ${w.member_name || "Team"}: ${w.text || ""}`).join("\n");
    } catch (_) {}

    let commitmentsText = "";
    try {
      const { data: rows } = await supabase
        .from("huddle_commitments").select("member_name, commitment, status, for_date, client_id").eq("huddle_id", huddle_id);
      if (Array.isArray(rows)) {
        commitmentsText = rows.map((r: any) => `- (${r.for_date}, ${r.status}) ${r.member_name}: ${r.commitment}`).join("\n");
      }
    } catch (_) {}

    const { data: reviews } = await supabase
      .from("huddle_client_reviews")
      .select("client_id, status, position, clients(name)")
      .eq("huddle_id", huddle_id)
      .order("position");
    const reviewedClients = (reviews || []) as any[];
    const reviewedText = reviewedClients
      .map((r: any) => `- ${r?.clients?.name || r.client_id} [${r.status}]`)
      .join("\n");

    // Transcribe recording if present.
    let transcript = "";
    if (huddle.recording_url) {
      const marker = "/weekly-call-recordings/";
      const idx = huddle.recording_url.indexOf(marker);
      const path = idx >= 0 ? huddle.recording_url.slice(idx + marker.length).split("?")[0] : null;
      if (path) {
        const { data: blob, error: dlErr } = await supabase.storage.from("weekly-call-recordings").download(path);
        if (dlErr) throw dlErr;
        try {
          transcript = await transcribeRecording(blob, {
            fileName: path.split("/").pop() || "huddle-recording.webm",
            prompt: "Daily agency huddle. Transcribe verbatim with speaker turns if identifiable.",
          });
        } catch (e) {
          console.warn("transcription failed:", e);
        }
      }
    }

    const contextBlock = [
      winsText ? `WINS:\n${winsText}` : "",
      commitmentsText ? `COMMITMENTS:\n${commitmentsText}` : "",
      reviewedText ? `CLIENTS WALKED:\n${reviewedText}` : "",
      transcript ? `TRANSCRIPT:\n${transcript.slice(0, 18000)}` : "",
    ].filter(Boolean).join("\n\n");

    let summary = "";
    let title = "";
    let proposedTasks: Array<{ title: string; priority?: string; client_id?: string | null }> = [];
    let perClientNotes: Record<string, string> = {};

    if (contextBlock) {
      try {
        const sumRes = await callOpenRouter([
          { role: "system", content: "You summarize daily agency huddles. Terse, 4-6 bullets, focus on wins, decisions, blockers, and commitments. No preamble." },
          { role: "user", content: contextBlock },
        ], { temperature: 0.3, max_tokens: 500 });
        summary = sumRes.text.trim();
      } catch (e) { console.warn("summary failed:", e); }

      try {
        const titleRes = await callOpenRouter([
          { role: "system", content: "Write a concise 3-8 word title for a daily agency huddle. Return only the title, no quotes or punctuation." },
          { role: "user", content: (summary ? `SUMMARY:\n${summary}\n\n` : "") + contextBlock.slice(0, 6000) },
        ], { temperature: 0.4, max_tokens: 40 });
        title = titleRes.text.replace(/^["'\s]+|["'\s.!?]+$/g, "").split("\n")[0].slice(0, 120).trim();
      } catch (e) { console.warn("title failed:", e); }

      try {
        const clientList = reviewedClients.map((r: any) => `${r.client_id}: ${r?.clients?.name || ""}`).join("\n");
        const taskRes = await callOpenRouterJSON<{
          tasks: Array<{ title: string; priority?: string; client_id?: string | null }>;
          per_client_notes?: Record<string, string>;
        }>([
          { role: "system", content: 'Extract action items and per-client notes from a daily huddle. Return strict JSON: {"tasks":[{"title":"...","priority":"low|medium|high","client_id":"<uuid or null>"}], "per_client_notes": {"<client_id>": "1-2 sentence note"}}. Only concrete owner-actionable tasks. Max 15. Only use client_ids from the provided list.' },
          { role: "user", content: `KNOWN CLIENT IDS:\n${clientList}\n\n${contextBlock}` },
        ], { temperature: 0.1, max_tokens: 1200 });
        proposedTasks = Array.isArray(taskRes.data?.tasks) ? taskRes.data.tasks.slice(0, 15) : [];
        perClientNotes = (taskRes.data?.per_client_notes as Record<string, string>) || {};
      } catch (e) { console.warn("task extract failed:", e); }
    }

    // Persist per-client AI notes
    for (const [cid, note] of Object.entries(perClientNotes)) {
      if (!cid || !note) continue;
      try {
        await supabase.from("huddle_client_reviews").update({ ai_summary: note }).eq("huddle_id", huddle_id).eq("client_id", cid);
      } catch (_) {}
    }

    await supabase.from("huddles").update({
      transcript: transcript || null,
      summary_text: summary || null,
      title: title || null,
      proposed_tasks: proposedTasks as any,
      finalize_status: "done",
    }).eq("id", huddle_id);

    return new Response(JSON.stringify({ ok: true, transcript_len: transcript.length, tasks: proposedTasks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("huddle-finalize error:", err);
    try {
      if (huddleIdForError) await supabase.from("huddles").update({ finalize_status: "error" }).eq("id", huddleIdForError);
    } catch (_) {}
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});