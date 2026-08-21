// AI Caller ingest webhook.
//
// Accepts outbound AI-calling activity (one payload per call), upserts it into
// phone_call_records with is_ai_caller = true, transcribes the recording when
// one is supplied and no transcript exists, and generates a structured AI
// summary + intent score + outcome classification.
//
// Auth: body.password, ?password= or x-hpa-webhook-token header.
//
// Actions:
//   (default)                      -> ingest one call payload
//   { action: "analyze", record_id } -> re-run transcription + analysis
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouter, TEXT_MODELS } from "../_shared/openrouter.ts";
import { transcribeRecording } from "../_shared/transcription.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hpa-webhook-token",
};

const INTERNAL_PASSWORD = "HPA1234$";
const MODELS = ["openrouter/owl-alpha", ...TEXT_MODELS];

const OUTCOMES = [
  "Appointment Booked", "Interested — Follow Up", "Qualified — Not Booked", "Not Interested",
  "Call Back Requested", "Wrong Number", "Do Not Contact", "Voicemail", "No Answer", "Disqualified",
];

const CALL_STATUSES = [
  "scheduled", "calling", "answered", "no_answer", "busy", "voicemail", "failed", "completed",
];

const APPOINTMENT_STATUSES = ["Booked", "Confirmed", "Showed", "No Show", "Canceled", "Rescheduled"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pick(obj: any, paths: string[]): any {
  for (const path of paths) {
    let cur = obj;
    for (const key of path.split(".")) {
      if (cur == null) break;
      cur = cur[key];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return null;
}

function bool(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "yes", "1"].includes(s)) return true;
  if (["false", "no", "0"].includes(s)) return false;
  return null;
}

function normalizeStatus(v: unknown): string {
  const s = String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CALL_STATUSES.includes(s) ? s : s ? s : "completed";
}

function normalizeOutcome(v: unknown): string | null {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  return (
    OUTCOMES.find((o) => o.toLowerCase() === s) ||
    OUTCOMES.find((o) => o.toLowerCase().replace(/[^a-z]/g, "") === s.replace(/[^a-z]/g, "")) ||
    null
  );
}

function normalizeAppointmentStatus(v: unknown): string | null {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  return APPOINTMENT_STATUSES.find((a) => a.toLowerCase() === s) || null;
}

/** Split a raw transcript into AI Caller / Prospect speaker segments. */
function buildSegments(transcript: string) {
  const lines = transcript.split("\n").map((l) => l.trim()).filter(Boolean);
  const segments: { speaker: string; text: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z .]{1,30})\s*:\s*(.+)$/);
    if (m) {
      const raw = m[1].trim().toLowerCase();
      const speaker = /(ai|agent|assistant|bot|caller|rep)/.test(raw) ? "AI Caller" : "Prospect";
      segments.push({ speaker, text: m[2].trim() });
    } else {
      segments.push({ speaker: segments.length % 2 === 0 ? "AI Caller" : "Prospect", text: line });
    }
  }
  return segments;
}

const ANALYSIS_PROMPT = `You analyze outbound AI-caller sales calls for a capital-raising / investment firm.

Return STRICT JSON:
{
  "summary": "structured multi-line summary covering: main reason for the call, prospect interest level, questions asked, important details, objections, investment amount mentioned, accreditation status, appointment outcome, recommended next step",
  "outcome": one of ${JSON.stringify(OUTCOMES)},
  "intent_score": 0-100 integer,
  "qualified": true|false,
  "appointment_booked": true|false,
  "appointment_date": ISO datetime string or null,
  "next_step": "short next action",
  "follow_up_required": true|false,
  "objections": ["..."],
  "important_quotes": ["..."],
  "investment_amount": number or null,
  "investment_range": "string or null",
  "investment_timeline": "string or null",
  "accredited": "yes" | "no" | "unclear" | null,
  "sentiment": "Very Positive" | "Positive" | "Neutral" | "Negative" | "Very Negative",
  "tags": ["..."]
}

Intent scoring signals: asked investment questions, discussed available capital, confirmed accredited status,
asked about returns, asked about timing, requested information, agreed to another conversation, booked an appointment.
80-100 high intent, 50-79 medium, 0-49 low. Output JSON only.`;

async function analyzeTranscript(transcript: string, contactName?: string | null) {
  const res = await callOpenRouter(
    [
      { role: "system", content: ANALYSIS_PROMPT },
      {
        role: "user",
        content: `Prospect: ${contactName || "Unknown"}\n\nTranscript:\n${transcript.slice(0, 60000)}`,
      },
    ],
    { models: MODELS, temperature: 0.2, max_tokens: 1600, response_format: { type: "json_object" } },
  );
  const raw = res.text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

async function fetchRecording(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const password =
      body?.password || url.searchParams.get("password") || req.headers.get("x-hpa-webhook-token");
    if (password !== INTERNAL_PASSWORD) {
      return json({ success: false, error: "Incorrect password" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Re-analyze an existing record ──────────────────────────────────────
    if (body.action === "analyze" && body.record_id) {
      const { data: rec, error } = await supabase
        .from("phone_call_records")
        .select("*")
        .eq("id", body.record_id)
        .maybeSingle();
      if (error || !rec) return json({ success: false, error: "Record not found" }, 404);

      let transcript: string = rec.transcript || "";
      if (!transcript && rec.recording_url) {
        const blob = await fetchRecording(rec.recording_url);
        if (blob) transcript = await transcribeRecording(blob).catch(() => "");
      }
      if (!transcript) return json({ success: false, error: "No transcript or recording available" }, 400);

      const analysis = await analyzeTranscript(transcript, rec.contact_name);
      const update = buildAnalysisUpdate(transcript, analysis);
      const { error: upErr } = await supabase
        .from("phone_call_records")
        .update(update)
        .eq("id", rec.id);
      if (upErr) throw upErr;
      return json({ success: true, record_id: rec.id, analyzed: !!analysis });
    }

    // ── Ingest one AI call ────────────────────────────────────────────────
    const payload = body.call || body;
    const callId = String(
      pick(payload, ["call_id", "callId", "id", "conversation_id"]) || crypto.randomUUID(),
    );

    let clientId: string | null = pick(payload, ["client_id", "clientId"]);
    const clientName = pick(payload, ["client_name", "clientName"]);
    if (!clientId && clientName) {
      const { data } = await supabase
        .from("clients")
        .select("id")
        .ilike("name", String(clientName))
        .maybeSingle();
      clientId = data?.id ?? null;
    }

    const startedAt = pick(payload, ["call_started_at", "started_at", "start_time"]);
    const answeredAt = pick(payload, ["call_answered_at", "answered_at"]);
    const endedAt = pick(payload, ["call_ended_at", "ended_at", "end_time"]);
    const status = normalizeStatus(pick(payload, ["call_status", "status"]));
    const durationSeconds = Number(pick(payload, ["duration_seconds", "duration"]) || 0) || 0;

    let answered = bool(pick(payload, ["answered", "connected"]));
    if (answered === null) answered = !!answeredAt || ["answered", "completed"].includes(status);

    let transcript: string = String(pick(payload, ["transcript"]) || "");
    const recordingUrl = pick(payload, ["recording_url", "recordingUrl"]);
    if (!transcript && recordingUrl) {
      const blob = await fetchRecording(String(recordingUrl));
      if (blob) transcript = await transcribeRecording(blob).catch(() => "");
    }

    let analysis: any = null;
    if (transcript) {
      analysis = await analyzeTranscript(transcript, pick(payload, ["contact_name"])).catch((e) => {
        console.warn("[ai-caller-webhook] analysis failed:", e instanceof Error ? e.message : e);
        return null;
      });
    }

    const bookedIn = bool(pick(payload, ["appointment_booked", "booked"]));
    const appointmentDate = pick(payload, ["appointment_date", "appointment_at"]);

    const record: Record<string, unknown> = {
      call_id: callId,
      client_id: clientId,
      provider: pick(payload, ["provider"]) || "ai_caller",
      is_ai_caller: true,
      ai_agent: pick(payload, ["ai_agent", "agent", "agent_name"]),
      direction: pick(payload, ["direction"]) || "outbound",
      contact_id: pick(payload, ["contact_id", "contactId"]),
      contact_name: pick(payload, ["contact_name", "name"]),
      contact_phone: pick(payload, ["contact_phone", "phone", "to"]),
      contact_email: pick(payload, ["contact_email", "email"]),
      assigned_user: pick(payload, ["assigned_user", "assignedUser", "rep"]),
      assigned_user_id: pick(payload, ["assigned_user_id"]),
      campaign: pick(payload, ["campaign", "campaign_name"]),
      call_status: status,
      started_at: startedAt ? new Date(startedAt).toISOString() : new Date().toISOString(),
      answered_at: answeredAt ? new Date(answeredAt).toISOString() : null,
      ended_at: endedAt ? new Date(endedAt).toISOString() : null,
      duration_seconds: durationSeconds,
      connected: answered,
      answered,
      recording_url: recordingUrl || null,
      appointment_id: pick(payload, ["appointment_id"]),
      raw_payload: payload,
      updated_at: new Date().toISOString(),
      ...buildAnalysisUpdate(transcript, analysis),
    };

    // Explicit payload values always win over inferred analysis.
    const qualifiedIn = bool(pick(payload, ["qualified"]));
    if (qualifiedIn !== null) record.qualified = qualifiedIn;
    if (bookedIn !== null) record.appointment_booked = bookedIn;
    if (appointmentDate) {
      record.appointment_date = new Date(appointmentDate).toISOString();
      if (bookedIn === null) record.appointment_booked = true;
    }
    const apptStatus = normalizeAppointmentStatus(pick(payload, ["appointment_status"]));
    if (apptStatus) record.appointment_status = apptStatus;
    else if (record.appointment_booked) record.appointment_status = "Booked";

    const outcomeIn = normalizeOutcome(pick(payload, ["outcome"]));
    if (outcomeIn) record.outcome = outcomeIn;
    const intentIn = pick(payload, ["intent_score"]);
    if (intentIn !== null && intentIn !== undefined) record.intent_score = Number(intentIn);
    const summaryIn = pick(payload, ["summary"]);
    if (summaryIn) record.summary = String(summaryIn);

    if (!record.outcome) {
      record.outcome = record.appointment_booked
        ? "Appointment Booked"
        : status === "no_answer"
          ? "No Answer"
          : status === "voicemail"
            ? "Voicemail"
            : null;
    }

    const { data, error } = await supabase
      .from("phone_call_records")
      .upsert(record, { onConflict: "call_id" })
      .select("id")
      .single();
    if (error) throw error;

    return json({
      success: true,
      record_id: data.id,
      call_id: callId,
      transcribed: !!transcript,
      analyzed: !!analysis,
    });
  } catch (err) {
    console.error("[ai-caller-webhook] error:", err);
    return json(
      { success: false, error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});

function buildAnalysisUpdate(transcript: string, analysis: any): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (transcript) {
    update.transcript = transcript;
    update.speaker_segments = buildSegments(transcript);
    update.transcription_status = "completed";
    update.transcribed_at = new Date().toISOString();
    update.transcription_error = null;
  }
  if (!analysis) return update;

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
  update.summary = analysis.summary || null;
  update.outcome = normalizeOutcome(analysis.outcome);
  update.intent_score = num(analysis.intent_score);
  update.qualified = bool(analysis.qualified) ?? false;
  update.appointment_booked = bool(analysis.appointment_booked) ?? false;
  if (analysis.appointment_date) {
    const d = new Date(analysis.appointment_date);
    if (!isNaN(d.getTime())) update.appointment_date = d.toISOString();
  }
  update.next_step = analysis.next_step || null;
  update.follow_up_required = bool(analysis.follow_up_required) ?? false;
  update.objections = Array.isArray(analysis.objections) ? analysis.objections : [];
  update.important_quotes = Array.isArray(analysis.important_quotes) ? analysis.important_quotes : [];
  update.investment_amount = num(analysis.investment_amount);
  update.investment_range = analysis.investment_range || null;
  update.investment_timeline = analysis.investment_timeline || null;
  update.accredited = analysis.accredited || null;
  update.sentiment = analysis.sentiment || null;
  update.tags = Array.isArray(analysis.tags) ? analysis.tags : [];
  update.analyzed_at = new Date().toISOString();
  return update;
}
