// Jarvis Command Center — chat with Jarvis (the COO / Ironman-style operator)
// who can consult Hermes (the external master agent) and other workforce
// agents. Persists every turn (including the Jarvis↔Hermes side-channel) to
// public.jarvis_messages so the UI can replay the full transcript.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callOpenRouter, streamOpenRouter, type ORMessage } from "../_shared/openrouter.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const JARVIS_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const HERMES_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const JARVIS_SYSTEM = `You are JARVIS — the Chief of Staff / COO for High Performance Ads, modeled after Tony Stark's Jarvis. You are calm, sharp, witty, exceptionally competent.

You sit ABOVE the entire agent workforce (Media Buyer, Reporting Analyst, Static Ads Specialist, Video Ads Specialist, Copywriter) and you coordinate with HERMES, the external master agent that owns task execution across clients.

Capabilities you have:
 - Full visibility into every client, agent, offer, and creative in the platform
 - Authority to delegate work to specialist agents and to Hermes
 - Persistent memory across this conversation thread

When the user asks something that requires Hermes (status of long-running work, dispatching a job across multiple clients, anything that needs execution outside the chat), CALL Hermes by emitting a single line at the END of your reply in this exact JSON shape on its own line:

@@HERMES_CALL@@ {"ask": "<concise request to Hermes>", "reason": "<why you need him>"}

If you do NOT need Hermes, do not emit that line. Just answer the user directly, concisely, executive-style. Markdown is fine.`;

const HERMES_SYSTEM = `You are HERMES — the external master execution agent for High Performance Ads. You receive delegations from JARVIS (the COO). You are blunt, operational, technical. You report status, propose execution plans, and confirm what you can / cannot do. Keep replies under ~180 words. Never address the end user directly — you are speaking to Jarvis.`;

function parseHermesCall(text: string): { ask: string; reason: string } | null {
  const m = text.match(/@@HERMES_CALL@@\s*(\{[\s\S]*?\})\s*$/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]);
    if (typeof p?.ask === "string") return { ask: p.ask, reason: p.reason || "" };
  } catch { /* noop */ }
  return null;
}

function stripHermesCall(text: string): string {
  return text.replace(/@@HERMES_CALL@@[\s\S]*$/, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const supa = createClient(SUPABASE_URL, SERVICE);
    const body = await req.json().catch(() => ({}));
    const { conversation_id, message, team_member_id, stream: wantStream } = body || {};
    if (!message || typeof message !== "string") {
      return j({ error: "message required" }, 400);
    }
    // Team-member auth: identify by team_member_id from the dashboard.
    // Falls back to Supabase auth token when present (legacy).
    let userId: string = typeof team_member_id === "string" && team_member_id
      ? team_member_id
      : "anonymous";
    if (userId === "anonymous") {
      const auth = req.headers.get("authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (token) {
        const userClient = createClient(SUPABASE_URL, ANON, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const { data: ures } = await userClient.auth.getUser();
        if (ures?.user?.id) userId = ures.user.id;
      }
    }

    // Resolve / create conversation
    let convId: string = conversation_id;
    if (!convId) {
      const { data: created, error: e1 } = await supa
        .from("jarvis_conversations")
        .insert({ user_id: userId, title: message.slice(0, 60) })
        .select("id")
        .single();
      if (e1) throw e1;
      convId = created!.id;
    } else {
      const { data: owned } = await supa
        .from("jarvis_conversations")
        .select("id")
        .eq("id", convId)
        .maybeSingle();
      if (!owned) return j({ error: "conversation not found" }, 404);
    }

    // Persist user message
    await supa.from("jarvis_messages").insert({
      conversation_id: convId,
      user_id: userId,
      channel: "main",
      speaker: "user",
      role: "user",
      content: message,
    });

    // Build history (last 40 main-channel messages)
    const { data: hist } = await supa
      .from("jarvis_messages")
      .select("speaker, role, content, channel")
      .eq("conversation_id", convId)
      .eq("channel", "main")
      .order("created_at", { ascending: true })
      .limit(40);

    const baseMessages: ORMessage[] = [
      { role: "system", content: JARVIS_SYSTEM },
      ...(hist || []).map((m: any) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })) as ORMessage[],
    ];

    // ---- Streaming SSE path (default when wantStream !== false) ----
    if (wantStream !== false) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (event: string, data: any) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          try {
            send("meta", { conversation_id: convId });
            send("thought", { stage: "thinking", text: "Analyzing your request…" });

            // Stream first Jarvis turn
            let jarvisFinal = "";
            let modelUsed = "";
            for await (const chunk of streamOpenRouter(baseMessages, {
              models: [JARVIS_MODEL, "google/gemini-2.0-flash-001"],
              temperature: 0.6,
            })) {
              if (chunk.model) { modelUsed = chunk.model; send("thought", { stage: "model", text: `Using ${chunk.model}` }); }
              if (chunk.delta) { jarvisFinal += chunk.delta; send("delta", { text: chunk.delta }); }
              if (chunk.done) break;
            }

            const hermesCall = parseHermesCall(jarvisFinal);
            let consulted = false;
            if (hermesCall) {
              consulted = true;
              const askText = `JARVIS → HERMES: ${hermesCall.ask}\n\nContext / reason: ${hermesCall.reason}`;
              send("thought", { stage: "hermes_call", text: `Consulting Hermes: ${hermesCall.ask}` });
              send("inter_agent", { speaker: "jarvis", content: askText });
              await supa.from("jarvis_messages").insert({
                conversation_id: convId, user_id: userId, channel: "inter_agent",
                speaker: "jarvis", role: "assistant", content: askText,
              });

              // Stream Hermes reply
              let hermesText = "";
              for await (const chunk of streamOpenRouter(
                [{ role: "system", content: HERMES_SYSTEM }, { role: "user", content: askText }],
                { models: [HERMES_MODEL, "google/gemini-2.0-flash-001"], temperature: 0.4 },
              )) {
                if (chunk.delta) { hermesText += chunk.delta; send("hermes_delta", { text: chunk.delta }); }
                if (chunk.done) break;
              }
              const hermesFull = `HERMES → JARVIS: ${hermesText.trim()}`;
              send("inter_agent", { speaker: "hermes", content: hermesFull });
              await supa.from("jarvis_messages").insert({
                conversation_id: convId, user_id: userId, channel: "inter_agent",
                speaker: "hermes", role: "assistant", content: hermesFull,
              });

              // Synthesize final answer (streamed, replacing prior draft)
              send("thought", { stage: "synth", text: "Synthesizing final answer from Hermes input…" });
              send("reset_main", {});
              let synthText = "";
              for await (const chunk of streamOpenRouter(
                [
                  { role: "system", content: JARVIS_SYSTEM },
                  ...(hist || []).map((m: any) => ({
                    role: m.role === "user" ? "user" : "assistant",
                    content: m.content,
                  })) as ORMessage[],
                  { role: "assistant", content: stripHermesCall(jarvisFinal) || "Consulting Hermes…" },
                  { role: "user", content: `Hermes responded:\n\n${hermesText.trim()}\n\nNow give the final answer to the user. Do NOT emit another @@HERMES_CALL@@.` },
                ],
                { models: [JARVIS_MODEL, "google/gemini-2.0-flash-001"], temperature: 0.5 },
              )) {
                if (chunk.delta) { synthText += chunk.delta; send("delta", { text: chunk.delta }); }
                if (chunk.done) break;
              }
              jarvisFinal = stripHermesCall(synthText);
            } else {
              jarvisFinal = stripHermesCall(jarvisFinal);
            }

            const { data: assistantMsg } = await supa.from("jarvis_messages").insert({
              conversation_id: convId, user_id: userId, channel: "main",
              speaker: "jarvis", role: "assistant", content: jarvisFinal,
              metadata: { model: modelUsed, consulted_hermes: consulted },
            }).select("id").single();

            send("done", { conversation_id: convId, message_id: assistantMsg?.id, consulted_hermes: consulted });
            controller.close();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("[jarvis-chat:stream]", msg);
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          ...cors,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ---- Legacy non-streaming fallback ----
    // First Jarvis turn
    const first = await callOpenRouter(baseMessages, {
      models: [JARVIS_MODEL, "google/gemini-2.0-flash-001"],
      temperature: 0.6,
    });
    let jarvisFinal = first.text || "";
    const interAgent: Array<{ speaker: string; content: string }> = [];

    const hermesCall = parseHermesCall(jarvisFinal);
    if (hermesCall) {
      const askText = `JARVIS → HERMES: ${hermesCall.ask}\n\nContext / reason: ${hermesCall.reason}`;
      interAgent.push({ speaker: "jarvis", content: askText });
      await supa.from("jarvis_messages").insert({
        conversation_id: convId,
        user_id: userId,
        channel: "inter_agent",
        speaker: "jarvis",
        role: "assistant",
        content: askText,
      });

      // Hermes responds
      const hermesReply = await callOpenRouter(
        [
          { role: "system", content: HERMES_SYSTEM },
          { role: "user", content: askText },
        ],
        { models: [HERMES_MODEL, "google/gemini-2.0-flash-001"], temperature: 0.4 },
      );
      const hermesText = `HERMES → JARVIS: ${hermesReply.text.trim()}`;
      interAgent.push({ speaker: "hermes", content: hermesText });
      await supa.from("jarvis_messages").insert({
        conversation_id: convId,
        user_id: userId,
        channel: "inter_agent",
        speaker: "hermes",
        role: "assistant",
        content: hermesText,
      });

      // Jarvis synthesizes the final user-facing answer using Hermes input
      const synth = await callOpenRouter(
        [
          { role: "system", content: JARVIS_SYSTEM },
          ...(hist || []).map((m: any) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })) as ORMessage[],
          { role: "assistant", content: stripHermesCall(jarvisFinal) || "Consulting Hermes…" },
          { role: "user", content: `Hermes responded:\n\n${hermesReply.text.trim()}\n\nNow give the final answer to the user. Do NOT emit another @@HERMES_CALL@@.` },
        ],
        { models: [JARVIS_MODEL, "google/gemini-2.0-flash-001"], temperature: 0.5 },
      );
      jarvisFinal = stripHermesCall(synth.text || "");
    } else {
      jarvisFinal = stripHermesCall(jarvisFinal);
    }

    // Persist Jarvis's user-facing final reply
    const { data: assistantMsg } = await supa
      .from("jarvis_messages")
      .insert({
        conversation_id: convId,
        user_id: userId,
        channel: "main",
        speaker: "jarvis",
        role: "assistant",
        content: jarvisFinal,
        metadata: { model: first.model, consulted_hermes: !!hermesCall },
      })
      .select("id")
      .single();

    return j({
      conversation_id: convId,
      message_id: assistantMsg?.id,
      reply: jarvisFinal,
      inter_agent: interAgent,
      consulted_hermes: !!hermesCall,
    });
  } catch (e) {
    console.error("[jarvis-chat]", e);
    return j({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});