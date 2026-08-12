// Phone Call Transcription & Sales Intelligence pipeline.
//
// Modes:
//  - Webhook ingest (default): accepts a completed-call payload from GHL / Twilio /
//    the appointment call bridge, upserts phone_call_records, and (when a recording
//    is available) transcribes + analyzes it inline.
//  - { action: "process_pending" }: cron worker that retries records that still
//    have no transcript.
//  - { action: "reprocess", record_id }: force re-transcribe + re-analyze one call.
//  - { action: "analyze_only", record_id }: re-run AI analysis on a stored transcript.
//
// Auth: body.password, ?password=, or x-hpa-webhook-token header.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouter } from "../_shared/openrouter.ts";
import { transcribeRecording } from "../_shared/transcription.ts";
import { getMappedGhl } from "../_shared/ghlMapping.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hpa-webhook-token",
};

const INTERNAL_PASSWORD = "HPA1234$";
const GHL_BASE = "https://services.leadconnectorhq.com";
/** Transcription cap per chunk — keeps long calls fully transcribed via slicing. */
const MAX_CHUNK_BYTES = 20 * 1024 * 1024;

const OUTCOMES = [
  "Qualified", "Not Qualified", "Interested", "Follow-Up Required", "Appointment Booked",
  "Reconnect Required", "Committed", "Funded", "Not Interested", "No Decision",
];
const SENTIMENTS = ["Very Positive", "Positive", "Neutral", "Negative", "Very Negative"];

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

function normalizeOutcome(v: unknown) {
  const s = String(v || "").trim().toLowerCase();
  return OUTCOMES.find((o) => o.toLowerCase() === s) || null;
}
function normalizeSentiment(v: unknown) {
  const s = String(v || "").trim().toLowerCase();
  return SENTIMENTS.find((o) => o.toLowerCase() === s) || "Neutral";
}
function toInt(v: unknown, min = 0, max = 100) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}
function toDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Map an arbitrary provider payload onto phone_call_records columns. */
function mapPayload(p: any) {
  const durationRaw = pick(p, ["duration", "call_duration", "duration_seconds", "callDuration", "meta.callDuration", "message.meta.callDuration"]);
  const started = toDate(pick(p, ["call_start_time", "started_at", "startTime", "start_time", "dateAdded", "appointment_time", "calendar.startTime"]));
  const ended = toDate(pick(p, ["call_end_time", "ended_at", "endTime", "end_time"]));
  const status = String(pick(p, ["call_status", "status", "CallStatus", "meta.callStatus"]) || "").toLowerCase() || null;
  const duration = Number(durationRaw) || 0;
  return {
    call_id: String(pick(p, ["call_id", "callId", "CallSid", "id", "message_id", "messageId"]) || `call_${crypto.randomUUID()}`),
    provider: String(pick(p, ["provider", "source"]) || "webhook"),
    appointment_id: pick(p, ["appointment_id", "appointmentId", "appointment.id", "calendar.appointmentId"]),
    contact_id: pick(p, ["contact_id", "contactId", "contact.id"]),
    contact_name: pick(p, ["contact_name", "contactName", "contact.name", "full_name", "contact.full_name"]),
    contact_phone: pick(p, ["contact_phone", "contactPhone", "contact.phone", "phone", "To"]),
    contact_email: pick(p, ["contact_email", "contact.email", "email"]),
    assigned_user: pick(p, ["assigned_user", "assignedUser", "user.name", "user.firstName"]),
    assigned_user_id: pick(p, ["assigned_user_id", "assignedUserId", "user.id"]),
    assigned_user_phone: pick(p, ["assigned_user_phone", "assignedUserPhone", "user.phone", "From"]),
    campaign: pick(p, ["campaign", "campaign_name", "utm_campaign"]),
    direction: String(pick(p, ["call_direction", "direction", "Direction"]) || "outbound").toLowerCase().includes("in") ? "inbound" : "outbound",
    call_status: status,
    started_at: started,
    answered_at: toDate(pick(p, ["answer_time", "answered_at", "answeredAt"])),
    ended_at: ended || (started && duration ? new Date(new Date(started).getTime() + duration * 1000).toISOString() : null),
    duration_seconds: duration,
    connected: duration > 20 && status !== "no-answer" && status !== "busy" && status !== "failed",
    recording_url: pick(p, ["recording_url", "recordingUrl", "RecordingUrl", "recording"]),
    raw_payload: p,
  };
}

/** Fetch audio and split into transcribable chunks so long calls are never truncated. */
async function fetchAudio(url: string, authHeader?: Record<string, string>) {
  const res = await fetch(url, { headers: authHeader });
  if (!res.ok) throw new Error(`recording fetch ${res.status}`);
  const type = (res.headers.get("content-type") || "audio/mpeg").split(";")[0].trim();
  let bytes = new Uint8Array(await res.arrayBuffer());

  if (type.includes("json")) {
    const meta = JSON.parse(new TextDecoder().decode(bytes));
    const signed = meta?.url || meta?.recordingUrl || meta?.signedUrl || meta?.data?.url;
    if (!signed) throw new Error("no recording url in json envelope");
    const f = await fetch(signed);
    if (!f.ok) throw new Error(`signed recording fetch ${f.status}`);
    bytes = new Uint8Array(await f.arrayBuffer());
  }
  if (bytes.byteLength < 2048) throw new Error("recording too small");

  const ascii = String.fromCharCode(...bytes.subarray(0, 12));
  let ext = "mp3";
  if (ascii.startsWith("RIFF")) ext = "wav";
  else if (ascii.startsWith("OggS")) ext = "ogg";
  else if (ascii.includes("ftyp")) ext = "m4a";
  const mime = ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : ext === "m4a" ? "audio/mp4" : "audio/mpeg";

  const chunks: Blob[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_CHUNK_BYTES) {
    chunks.push(new Blob([bytes.subarray(offset, offset + MAX_CHUNK_BYTES)], { type: mime }));
  }
  return { chunks, ext };
}

async function transcribeFull(url: string, authHeader?: Record<string, string>) {
  const { chunks, ext } = await fetchAudio(url, authHeader);
  const parts: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const text = await transcribeRecording(chunk, { fileName: `call-part${i + 1}.${ext}` });
    if (text) parts.push(text);
  }
  return parts.join("\n").trim();
}

interface Analysis {
  transcript_labeled: string;
  speaker_segments: { speaker: string; text: string }[];
  summary: string;
  outcome: string | null;
  sentiment: string;
  intent_score: number | null;
  next_step: string;
  follow_up_date: string | null;
  objections: string[];
  important_quotes: string[];
  investment_amount: number | null;
  investment_range: string | null;
  investment_timeline: string | null;
  accredited: string | null;
  commitment_level: string | null;
  tags: string[];
}

async function analyze(transcript: string, contactName: string | null, assignedUser: string | null): Promise<Analysis | null> {
  const result = await callOpenRouter(
    [
      {
        role: "system",
        content:
          "You are a capital-raising sales intelligence analyst. Return STRICT JSON only. " +
          "Never describe returns as guaranteed — use 'targeted returns'. Be conservative: never invent facts.",
      },
      {
        role: "user",
        content:
          `Analyze this phone call transcript. Salesperson${assignedUser ? ` = ${assignedUser}` : ""} is "User". ` +
          `Prospect${contactName ? ` = ${contactName}` : ""} is "Contact".\n\n` +
          `Return JSON with keys:\n` +
          `speaker_segments: array of {speaker:"User"|"Contact", text} covering the whole call in order,\n` +
          `summary: concise paragraph of what was discussed,\n` +
          `outcome: one of ${OUTCOMES.join(" | ")},\n` +
          `sentiment: one of ${SENTIMENTS.join(" | ")},\n` +
          `intent_score: 0-100 lead intent (capital available, accreditation, positive sentiment, detailed questions, doc requests, amount discussed, timeline, next meeting, stated intent to invest),\n` +
          `next_step: the single concrete next action (e.g. "Send investor deck", "Follow up in 7 days", "Book reconnect call", "Waiting for CPA", "Ready to invest", "No follow-up required"),\n` +
          `follow_up_date: YYYY-MM-DD or null,\n` +
          `objections: string[] from [returns, risk, liquidity, fees, timing, minimum investment, trust, track record, market concerns, spouse/partner, CPA/advisor, needs more information] plus any others actually raised,\n` +
          `important_quotes: 3-5 verbatim prospect quotes,\n` +
          `investment_amount: single numeric USD amount discussed or null,\n` +
          `investment_range: e.g. "$100,000–$250,000" or null,\n` +
          `investment_timeline: e.g. "this quarter" or null,\n` +
          `accredited: "yes"|"no"|"unclear",\n` +
          `commitment_level: "none"|"low"|"medium"|"high"|"committed"|"funded",\n` +
          `tags: short string[] topic tags.\n\nTRANSCRIPT:\n${transcript.slice(0, 120000)}`,
      },
    ],
    { temperature: 0.2, response_format: { type: "json_object" }, max_tokens: 4000 },
  );

  try {
    const raw = result.text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const p = JSON.parse(raw);
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 25) : []);
    const segments = Array.isArray(p.speaker_segments)
      ? p.speaker_segments
          .map((s: any) => ({
            speaker: String(s?.speaker || "").toLowerCase().startsWith("cont") ? "Contact" : "User",
            text: String(s?.text || "").trim(),
          }))
          .filter((s: any) => s.text)
      : [];
    const amountRaw = String(p.investment_amount ?? "").replace(/[^0-9.]/g, "");
    return {
      transcript_labeled: segments.length
        ? segments.map((s) => `${s.speaker}: ${s.text}`).join("\n")
        : transcript,
      speaker_segments: segments,
      summary: String(p.summary || "").slice(0, 8000),
      outcome: normalizeOutcome(p.outcome),
      sentiment: normalizeSentiment(p.sentiment),
      intent_score: toInt(p.intent_score),
      next_step: String(p.next_step || "").slice(0, 500),
      follow_up_date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.follow_up_date || "")) ? String(p.follow_up_date) : null,
      objections: arr(p.objections),
      important_quotes: arr(p.important_quotes),
      investment_amount: amountRaw ? Number(amountRaw) : null,
      investment_range: p.investment_range ? String(p.investment_range).slice(0, 120) : null,
      investment_timeline: p.investment_timeline ? String(p.investment_timeline).slice(0, 120) : null,
      accredited: p.accredited ? String(p.accredited).toLowerCase().slice(0, 20) : null,
      commitment_level: p.commitment_level ? String(p.commitment_level).toLowerCase().slice(0, 20) : null,
      tags: arr(p.tags),
    };
  } catch (e) {
    console.error("[call-transcription] analysis parse failed", (e as Error).message);
    return null;
  }
}

/** Push the AI summary back into GHL as a contact note (best effort). */
async function pushToGhl(sb: any, record: any, analysis: Analysis) {
  if (!record.client_id || !record.contact_id) return { pushed: false, reason: "no_contact" };
  try {
    const { apiKey, locationId } = await getMappedGhl(sb, record.client_id);
    if (!apiKey || !locationId) return { pushed: false, reason: "no_credentials" };
    const note =
      `AI Call Summary (${new Date(record.started_at || Date.now()).toLocaleString()})\n` +
      `Outcome: ${analysis.outcome || "n/a"} | Sentiment: ${analysis.sentiment} | Intent: ${analysis.intent_score ?? "n/a"}/100\n` +
      (analysis.investment_range ? `Investment: ${analysis.investment_range}\n` : "") +
      (analysis.objections.length ? `Objections: ${analysis.objections.join(", ")}\n` : "") +
      `Next step: ${analysis.next_step}\n\n${analysis.summary}`;
    const res = await fetch(`${GHL_BASE}/contacts/${record.contact_id}/notes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, Version: "2021-07-28", "Content-Type": "application/json" },
      body: JSON.stringify({ body: note.slice(0, 5000) }),
    });
    if (!res.ok) return { pushed: false, reason: `ghl_${res.status}` };
    return { pushed: true };
  } catch (e) {
    return { pushed: false, reason: (e as Error).message };
  }
}

/** Resolve the owning client from the GHL contact id or phone number. */
async function resolveClientId(sb: any, mapped: any): Promise<string | null> {
  if (mapped.contact_id) {
    const { data } = await sb.from("leads").select("client_id").eq("external_id", mapped.contact_id).limit(1).maybeSingle();
    if (data?.client_id) return data.client_id;
  }
  if (mapped.contact_phone) {
    const digits = String(mapped.contact_phone).replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      const { data } = await sb.from("leads").select("client_id").ilike("phone", `%${digits}`).limit(1).maybeSingle();
      if (data?.client_id) return data.client_id;
    }
  }
  return null;
}

async function processRecord(sb: any, record: any, opts: { pushGhl?: boolean } = {}) {
  const out: any = { record_id: record.id, call_id: record.call_id };
  if (!record.recording_url) {
    await sb.from("phone_call_records").update({ transcription_status: "awaiting_recording" }).eq("id", record.id);
    out.status = "awaiting_recording";
    return out;
  }

  await sb.from("phone_call_records").update({ transcription_status: "transcribing", transcription_error: null }).eq("id", record.id);

  try {
    let auth: Record<string, string> | undefined;
    if (record.recording_url.includes("leadconnectorhq.com") && record.client_id) {
      const { apiKey } = await getMappedGhl(sb, record.client_id);
      if (apiKey) auth = { Authorization: `Bearer ${apiKey}`, Version: "2021-07-28" };
    }
    const transcript = await transcribeFull(record.recording_url, auth);
    if (!transcript) throw new Error("empty transcript");

    const analysis = await analyze(transcript, record.contact_name, record.assigned_user);
    const update: any = {
      transcript: analysis?.transcript_labeled || transcript,
      speaker_segments: analysis?.speaker_segments || [],
      transcribed_at: new Date().toISOString(),
      transcription_status: "completed",
      transcription_error: null,
    };
    if (analysis) {
      Object.assign(update, {
        summary: analysis.summary,
        outcome: analysis.outcome,
        sentiment: analysis.sentiment,
        intent_score: analysis.intent_score,
        next_step: analysis.next_step,
        follow_up_date: analysis.follow_up_date,
        objections: analysis.objections,
        important_quotes: analysis.important_quotes,
        investment_amount: analysis.investment_amount,
        investment_range: analysis.investment_range,
        investment_timeline: analysis.investment_timeline,
        accredited: analysis.accredited,
        commitment_level: analysis.commitment_level,
        tags: analysis.tags,
        analyzed_at: new Date().toISOString(),
      });
      if (opts.pushGhl !== false) {
        const push = await pushToGhl(sb, record, analysis);
        if (push.pushed) update.ghl_synced_at = new Date().toISOString();
        out.ghl = push;
      }
    }
    await sb.from("phone_call_records").update(update).eq("id", record.id);
    out.status = "completed";
    out.transcript_chars = transcript.length;
    out.intent_score = analysis?.intent_score ?? null;
    return out;
  } catch (e) {
    const msg = (e as Error).message;
    await sb
      .from("phone_call_records")
      .update({ transcription_status: "failed", transcription_error: msg.slice(0, 500) })
      .eq("id", record.id);
    out.status = "failed";
    out.error = msg;
    return out;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  if (req.method === "GET" && !url.searchParams.get("password")) {
    return json({ ok: true, service: "call-transcription", hint: "POST a call payload with ?password=" });
  }

  let body: any = {};
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(await req.text()));
    } else {
      body = await req.json();
    }
  } catch {
    body = {};
  }
  for (const [k, v] of url.searchParams.entries()) if (body[k] === undefined) body[k] = v;

  const provided = body.password || req.headers.get("x-hpa-webhook-token");
  if (provided !== INTERNAL_PASSWORD) return json({ error: "unauthorized" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const action = body.action || "ingest";

    if (action === "process_pending") {
      const limit = Math.min(Number(body.limit ?? 10), 50);
      const { data: pending, error } = await sb
        .from("phone_call_records")
        .select("*")
        .in("transcription_status", ["pending", "awaiting_recording", "failed"])
        .not("recording_url", "is", null)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      const results = [];
      for (const record of pending || []) results.push(await processRecord(sb, record, { pushGhl: body.push_ghl !== false }));
      return json({ ok: true, processed: results.length, results });
    }

    if (action === "reprocess" || action === "analyze_only") {
      const { data: record, error } = await sb
        .from("phone_call_records")
        .select("*")
        .or(`id.eq.${body.record_id || "00000000-0000-0000-0000-000000000000"},call_id.eq.${body.call_id || "__none__"}`)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: "record not found" }, 404);

      if (action === "analyze_only") {
        if (!record.transcript) return json({ error: "no transcript stored" }, 400);
        const analysis = await analyze(record.transcript, record.contact_name, record.assigned_user);
        if (!analysis) return json({ error: "analysis failed" }, 502);
        await sb
          .from("phone_call_records")
          .update({
            summary: analysis.summary,
            outcome: analysis.outcome,
            sentiment: analysis.sentiment,
            intent_score: analysis.intent_score,
            next_step: analysis.next_step,
            follow_up_date: analysis.follow_up_date,
            objections: analysis.objections,
            important_quotes: analysis.important_quotes,
            investment_amount: analysis.investment_amount,
            investment_range: analysis.investment_range,
            investment_timeline: analysis.investment_timeline,
            accredited: analysis.accredited,
            commitment_level: analysis.commitment_level,
            tags: analysis.tags,
            analyzed_at: new Date().toISOString(),
          })
          .eq("id", record.id);
        return json({ ok: true, record_id: record.id, intent_score: analysis.intent_score });
      }
      return json({ ok: true, ...(await processRecord(sb, record, { pushGhl: body.push_ghl !== false })) });
    }

    // ---- Webhook ingest ----
    const mapped = mapPayload(body);
    let clientId = body.client_id && String(body.client_id).includes("-") ? body.client_id : null;
    if (!clientId) clientId = await resolveClientId(sb, mapped);

    const row = { ...mapped, client_id: clientId, transcription_status: mapped.recording_url ? "pending" : "awaiting_recording" };
    const { data: saved, error } = await sb
      .from("phone_call_records")
      .upsert(row, { onConflict: "call_id" })
      .select()
      .single();
    if (error) throw error;

    const completed = ["completed", "complete", "answered", "ended"].includes(String(mapped.call_status || ""));
    const shouldProcess = !!mapped.recording_url && (completed || !mapped.call_status) && body.transcribe !== false;
    if (!shouldProcess) {
      return json({ ok: true, record_id: saved.id, call_id: saved.call_id, status: saved.transcription_status });
    }

    const result = await processRecord(sb, saved, { pushGhl: body.push_ghl !== false });
    return json({ ok: true, record_id: saved.id, ...result });
  } catch (e) {
    console.error("[call-transcription]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
