import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouter } from "../_shared/openrouter.ts";

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
    const { client_id, question, history } = await req.json();
    if (!client_id) throw new Error("client_id required");
    if (!question || typeof question !== "string") throw new Error("question required");

    // Pull past calls: summary layer first.
    const { data: calls, error } = await supabase
      .from("client_weekly_calls")
      .select("id, week_of, title, summary_text, transcript, ended_at, proposed_tasks, actual_duration_s")
      .eq("client_id", client_id)
      .neq("status", "cancelled")
      .order("week_of", { ascending: false })
      .limit(52);
    if (error) throw error;

    const summarised = (calls || []).map((c: any) => ({
      id: c.id,
      week_of: c.week_of,
      title: c.title || `Week of ${c.week_of}`,
      summary: c.summary_text || "(no summary)",
      tasks: Array.isArray(c.proposed_tasks) ? c.proposed_tasks.map((t: any) => t.title).filter(Boolean) : [],
      has_transcript: !!c.transcript,
    }));

    const summaryLayer = summarised
      .map((c) => `## ${c.title} — ${c.week_of}\n${c.summary}\n${c.tasks.length ? `Action items:\n- ${c.tasks.join("\n- ")}` : ""}`)
      .join("\n\n");

    // Heuristic: if the question mentions a specific week / date or asks about "exact/quote/said/verbatim",
    // pull transcript for the most relevant calls too.
    const wantsDeep = /\b(quote|verbatim|said|exact|transcript|full|word-for-word)\b/i.test(question);
    const dateMatch = question.match(/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i);

    let transcriptLayer = "";
    if (wantsDeep || dateMatch) {
      const targets = (calls || []).filter((c: any) => c.transcript).slice(0, 3);
      transcriptLayer = targets
        .map((c: any) => `## TRANSCRIPT — ${c.title || `Week of ${c.week_of}`} (${c.week_of})\n${(c.transcript || "").slice(0, 8000)}`)
        .join("\n\n---\n\n");
    }

    const context = [
      `You are an assistant answering questions about past weekly client calls. Cite the call date (e.g. "Week of Jul 12") when referencing specifics. If the info is not in the notes, say so plainly.`,
      `TOTAL PAST CALLS: ${summarised.length}`,
      `\n# CALL SUMMARIES\n${summaryLayer || "(none)"}`,
      transcriptLayer ? `\n# RELEVANT TRANSCRIPTS\n${transcriptLayer}` : "",
    ].filter(Boolean).join("\n\n");

    const messages: any[] = [
      { role: "system", content: context },
      ...((Array.isArray(history) ? history : []).slice(-8).map((m: any) => ({ role: m.role, content: String(m.content || "") }))),
      { role: "user", content: question },
    ];

    const res = await callOpenRouter(messages, { temperature: 0.3, max_tokens: 900 });
    return new Response(JSON.stringify({ answer: res.text.trim(), model: res.model, calls_indexed: summarised.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("weekly-call-chat error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});