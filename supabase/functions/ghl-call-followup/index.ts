// Post-call follow-up: 60+ minutes after a scheduled call, pull the GHL phone-call
// recording, transcribe it, match it to the contact/lead, and store AI sales context
// (summary, scores, objections, next step) for the sales agents.
//
// Triggered by pg_cron every 15 minutes, or manually with { password }.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callOpenRouter } from "../_shared/openrouter.ts";
import { transcribeRecording } from "../_shared/transcription.ts";
import { getMappedGhl } from "../_shared/ghlMapping.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const INTERNAL_PASSWORD = "HPA1234$";
/** Recording must be at least this many minutes past the scheduled start. */
const DEFAULT_MIN_AGE_MIN = 60;
/** How far back to keep retrying calls that still have no transcript. */
const DEFAULT_LOOKBACK_HOURS = 72;
/** Match a GHL call message to the appointment within this window. */
const MATCH_WINDOW_MS = 6 * 60 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ghlHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, Version: "2021-07-28", Accept: "application/json" };
}

function isCallMessage(m: any) {
  const t = String(m?.messageType || m?.type || "").toUpperCase();
  return t.includes("CALL") || t.includes("VOICEMAIL");
}

/** Newest call message for the contact inside the appointment window. */
async function findCallMessage(
  apiKey: string,
  locationId: string,
  contactId: string,
  target: Date,
): Promise<{ messageId: string; dateAdded: string | null; durationSeconds: number | null; direction: string | null; status: string | null } | null> {
  const convRes = await fetch(
    `${GHL_BASE}/conversations/search?locationId=${locationId}&contactId=${contactId}&limit=20`,
    { headers: ghlHeaders(apiKey) },
  );
  if (!convRes.ok) throw new Error(`GHL conversations/search ${convRes.status}`);
  const convs = (await convRes.json())?.conversations || [];

  let best: any = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const conv of convs) {
    const msgRes = await fetch(`${GHL_BASE}/conversations/${conv.id}/messages?limit=100`, {
      headers: ghlHeaders(apiKey),
    });
    if (!msgRes.ok) continue;
    const payload = await msgRes.json();
    const messages = payload?.messages?.messages || payload?.messages || [];
    for (const m of messages) {
      if (!isCallMessage(m)) continue;
      const when = m.dateAdded || m.dateUpdated;
      const delta = when ? Math.abs(new Date(when).getTime() - target.getTime()) : Number.POSITIVE_INFINITY;
      if (delta > MATCH_WINDOW_MS) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = m;
      }
    }
  }

  if (!best?.id) return null;
  const meta = best.meta || best.callMeta || {};
  return {
    messageId: best.id,
    dateAdded: best.dateAdded || null,
    durationSeconds: Number(meta.callDuration ?? meta.duration ?? best.duration ?? 0) || null,
    direction: best.direction || null,
    status: meta.callStatus || best.status || null,
  };
}

async function downloadRecording(
  apiKey: string,
  locationId: string,
  messageId: string,
): Promise<{ blob: Blob; fileName: string } | null> {
  const res = await fetch(
    `${GHL_BASE}/conversations/messages/${messageId}/locations/${locationId}/recording`,
    { headers: { Authorization: `Bearer ${apiKey}`, Version: "2021-07-28" } },
  );
  if (!res.ok) {
    // 404/422 = this message simply has no stored recording (voicemail, unanswered, SMS-logged call).
    if (res.status === 404 || res.status === 422 || res.status === 400) return null;
    throw new Error(`GHL recording ${res.status}`);
  }

  let type = (res.headers.get("content-type") || "audio/mpeg").split(";")[0].trim();
  let bytes = new Uint8Array(await res.arrayBuffer());

  // Some locations return a JSON envelope with a signed URL instead of raw audio.
  if (type.includes("json")) {
    try {
      const meta = JSON.parse(new TextDecoder().decode(bytes));
      const url = meta?.url || meta?.recordingUrl || meta?.signedUrl || meta?.data?.url;
      if (!url) return null;
      const fileRes = await fetch(url);
      if (!fileRes.ok) return null;
      type = (fileRes.headers.get("content-type") || "audio/mpeg").split(";")[0].trim();
      bytes = new Uint8Array(await fileRes.arrayBuffer());
    } catch {
      return null;
    }
  }

  if (bytes.byteLength < 2048) return null;

  // Sniff the real container so the transcription API gets a matching extension.
  const head = bytes.subarray(0, 12);
  const ascii = String.fromCharCode(...head);
  let ext = "mp3";
  if (ascii.startsWith("RIFF")) ext = "wav";
  else if (ascii.startsWith("OggS")) ext = "ogg";
  else if (ascii.includes("ftyp")) ext = "m4a";
  else if (head[0] === 0x1a && head[1] === 0x45) ext = "webm";
  else if (ascii.startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) ext = "mp3";
  else if (!type.startsWith("audio/") && !type.startsWith("video/")) return null;

  const mime = ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : ext === "m4a" ? "audio/mp4" : ext === "webm" ? "audio/webm" : "audio/mpeg";
  return { blob: new Blob([bytes], { type: mime }), fileName: `ghl-call.${ext}` };
}

interface Analysis {
  summary: string;
  next_step: string;
  sentiment: string;
  quality_score: number;
  score_rapport: number;
  score_qualification: number;
  score_objection_handling: number;
  close_attempted: boolean;
  objections_identified: string[];
  action_items: string[];
  compliance_flags: string[];
  connected: boolean;
}

async function analyzeTranscript(transcript: string, contactName: string | null): Promise<Analysis | null> {
  const result = await callOpenRouter(
    [
      {
        role: "system",
        content:
          "You are a sales-call QA analyst for a capital-raising / high-ticket sales team. " +
          "Return STRICT JSON only. Never claim guaranteed returns. Scores are 0-100 integers.",
      },
      {
        role: "user",
        content:
          `Analyze this phone call transcript${contactName ? ` with ${contactName}` : ""} and return JSON with keys: ` +
          `summary (3 sentences max), next_step (the concrete next action and timing), sentiment (positive|neutral|negative), ` +
          `quality_score (0-100 overall lead quality), score_rapport, score_qualification, score_objection_handling, ` +
          `close_attempted (boolean), objections_identified (string[]), action_items (string[]), compliance_flags (string[]), ` +
          `connected (boolean - true if a real two-way conversation happened, false for voicemail/no-answer).\n\nTRANSCRIPT:\n${transcript.slice(0, 24000)}`,
      },
    ],
    { temperature: 0.2, response_format: { type: "json_object" }, max_tokens: 1200 },
  );

  try {
    const raw = result.text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const p = JSON.parse(raw);
    const num = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 20) : []);
    return {
      summary: String(p.summary || "").slice(0, 4000),
      next_step: String(p.next_step || "").slice(0, 1000),
      sentiment: String(p.sentiment || "neutral").toLowerCase(),
      quality_score: num(p.quality_score),
      score_rapport: num(p.score_rapport),
      score_qualification: num(p.score_qualification),
      score_objection_handling: num(p.score_objection_handling),
      close_attempted: !!p.close_attempted,
      objections_identified: arr(p.objections_identified),
      action_items: arr(p.action_items),
      compliance_flags: arr(p.compliance_flags),
      connected: p.connected !== false,
    };
  } catch (e) {
    console.error("[ghl-call-followup] analysis parse failed", (e as Error).message);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({} as any));
    if (body?.password && body.password !== INTERNAL_PASSWORD) {
      return json({ error: "unauthorized" }, 401);
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const minAgeMinutes = Number(body?.minAgeMinutes ?? DEFAULT_MIN_AGE_MIN);
    const lookbackHours = Number(body?.lookbackHours ?? DEFAULT_LOOKBACK_HOURS);
    const limit = Math.min(Number(body?.limit ?? 25), 100);
    const dryRun = !!body?.dryRun;

    const now = Date.now();
    const dueBefore = new Date(now - minAgeMinutes * 60_000).toISOString();
    const after = new Date(now - lookbackHours * 3_600_000).toISOString();

    let query = sb
      .from("calls")
      .select("id, client_id, lead_id, external_id, scheduled_at, contact_name, recording_url, ghl_appointment_id")
      .is("transcript", null)
      .not("scheduled_at", "is", null)
      .lt("scheduled_at", dueBefore)
      .gte("scheduled_at", after)
      .order("scheduled_at", { ascending: false })
      .limit(limit);
    if (body?.client_id) query = query.eq("client_id", body.client_id);

    const { data: calls, error } = await query;
    if (error) throw error;

    const credCache = new Map<string, { apiKey: string | null; locationId: string | null }>();
    const results: any[] = [];
    let transcribed = 0;
    let noRecording = 0;
    let errors = 0;

    for (const call of calls || []) {
      const outcome: any = { call_id: call.id, client_id: call.client_id, scheduled_at: call.scheduled_at };
      try {
        if (!credCache.has(call.client_id)) {
          credCache.set(call.client_id, await getMappedGhl(sb, call.client_id));
        }
        const { apiKey, locationId } = credCache.get(call.client_id)!;
        if (!apiKey || !locationId) {
          outcome.status = "no_ghl_credentials";
          results.push(outcome);
          continue;
        }

        // Resolve the GHL contact id: the linked lead wins, else the call's own external id.
        let contactId: string | null = null;
        let leadId: string | null = call.lead_id || null;
        if (leadId) {
          const { data: lead } = await sb
            .from("leads")
            .select("id, external_id, name")
            .eq("id", leadId)
            .maybeSingle();
          contactId = lead?.external_id || null;
        }
        if (!contactId && call.external_id && !call.external_id.includes("-")) contactId = call.external_id;
        if (!contactId && call.external_id) {
          const { data: lead } = await sb
            .from("leads")
            .select("id, external_id")
            .eq("client_id", call.client_id)
            .eq("external_id", call.external_id)
            .maybeSingle();
          if (lead) {
            contactId = lead.external_id;
            leadId = leadId || lead.id;
          }
        }
        if (!contactId) {
          outcome.status = "unmatched_contact";
          results.push(outcome);
          continue;
        }
        outcome.ghl_contact_id = contactId;

        const message = await findCallMessage(apiKey, locationId, contactId, new Date(call.scheduled_at!));
        if (!message) {
          outcome.status = "no_call_logged";
          noRecording++;
          results.push(outcome);
          continue;
        }

        const audio = await downloadRecording(apiKey, locationId, message.messageId);
        if (!audio) {
          outcome.status = "no_recording_yet";
          noRecording++;
          results.push(outcome);
          continue;
        }

        const transcript = await transcribeRecording(audio.blob, { fileName: audio.fileName });
        if (!transcript) {
          outcome.status = "empty_transcript";
          results.push(outcome);
          continue;
        }
        outcome.transcript_chars = transcript.length;

        const analysis = await analyzeTranscript(transcript, call.contact_name);
        if (dryRun) {
          outcome.status = "dry_run";
          outcome.summary = analysis?.summary;
          results.push(outcome);
          continue;
        }

        const recordingUrl =
          call.recording_url ||
          `${GHL_BASE}/conversations/messages/${message.messageId}/locations/${locationId}/recording`;

        await sb
          .from("calls")
          .update({
            transcript,
            recording_url: recordingUrl,
            summary: analysis?.summary || null,
            quality_score: analysis?.quality_score ?? null,
            call_duration_seconds: message.durationSeconds ?? undefined,
            call_connected: analysis ? analysis.connected : undefined,
            showed: analysis?.connected ?? undefined,
            direction: message.direction || undefined,
            ghl_synced_at: new Date().toISOString(),
          })
          .eq("id", call.id);

        if (analysis) {
          await sb.from("call_analysis").upsert(
            {
              client_id: call.client_id,
              call_id: call.id,
              contact_name: call.contact_name,
              call_date: message.dateAdded || call.scheduled_at,
              duration_seconds: message.durationSeconds,
              call_type: "ghl_phone",
              transcript,
              summary: analysis.summary,
              next_step: analysis.next_step,
              sentiment: analysis.sentiment,
              score_rapport: analysis.score_rapport,
              score_qualification: analysis.score_qualification,
              score_objection_handling: analysis.score_objection_handling,
              close_attempted: analysis.close_attempted,
              objections_identified: analysis.objections_identified,
              action_items: analysis.action_items,
              compliance_flags: analysis.compliance_flags,
              analyzed_at: new Date().toISOString(),
            } as any,
            { onConflict: "call_id" },
          );

          await sb.from("contact_timeline_events").insert({
            client_id: call.client_id,
            lead_id: leadId,
            ghl_contact_id: contactId,
            event_type: "call",
            event_subtype: "transcript",
            title: `Call recap — next: ${analysis.next_step || "no next step captured"}`.slice(0, 200),
            body: analysis.summary.slice(0, 2000),
            event_at: message.dateAdded || call.scheduled_at,
            metadata: {
              via: "ghl_call_followup",
              provider: "ghl",
              ghl_message_id: message.messageId,
              call_id: call.id,
              quality_score: analysis.quality_score,
              sentiment: analysis.sentiment,
              next_step: analysis.next_step,
              action_items: analysis.action_items,
            },
          } as any);
        }

        outcome.status = "transcribed";
        outcome.quality_score = analysis?.quality_score ?? null;
        outcome.next_step = analysis?.next_step ?? null;
        transcribed++;
        results.push(outcome);
      } catch (e) {
        errors++;
        outcome.status = "error";
        outcome.error = String((e as Error)?.message || e);
        results.push(outcome);
        console.error("[ghl-call-followup]", call.id, outcome.error);
      }
    }

    return json({
      success: true,
      checked: calls?.length || 0,
      transcribed,
      awaiting_recording: noRecording,
      errors,
      min_age_minutes: minAgeMinutes,
      results,
    });
  } catch (e) {
    console.error("[ghl-call-followup] fatal", (e as Error)?.message || e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
