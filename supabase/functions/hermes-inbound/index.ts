// Hermes → Jarvis inbound gateway.
// Hermes (external ops agent) POSTs a request here; we authenticate with the
// shared agency_settings.hermes_api_key, then hand the message to Jarvis so he
// can route it to the correct client / offer / specialist agent.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE);

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  // Shared-bearer auth against agency_settings.hermes_api_key
  const { data: cfg } = await supa
    .from("agency_settings")
    .select("hermes_api_key, hermes_enabled")
    .limit(1)
    .maybeSingle();
  if (!cfg?.hermes_enabled) return j({ error: "Hermes integration disabled" }, 403);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== cfg.hermes_api_key) return j({ error: "Invalid bearer token" }, 401);

  const body = await req.json().catch(() => ({} as any));
  const {
    ask,
    client_id = null,
    client_slug = null,
    offer_id = null,
    agent_slug = null,
    reply_to = null,
    conversation_id: convIn = null,
  } = body || {};

  if (!ask || typeof ask !== "string") return j({ error: "ask required" }, 400);

  // Ensure a Jarvis conversation exists for Hermes inbound
  let conversationId = convIn as string | null;
  if (!conversationId) {
    const { data: conv, error } = await supa
      .from("jarvis_conversations")
      .insert({
        user_id: "hermes",
        title: `Hermes inbound · ${new Date().toLocaleString()}`,
      } as any)
      .select("id")
      .single();
    if (error) return j({ error: error.message }, 500);
    conversationId = conv!.id as string;
  }

  // Log the request in hermes_tasks so we have an audit trail
  const { data: task } = await supa
    .from("hermes_tasks")
    .insert({
      status: "queued",
      task_type: "inbound_from_hermes",
      payload: { ask, client_id, client_slug, offer_id, agent_slug },
      requested_by: "hermes",
      reply_to,
      jarvis_conversation_id: conversationId,
    } as any)
    .select("id")
    .single();

  // Hand to Jarvis
  const routingHint =
    (client_slug || client_id ? `Target client: ${client_slug || client_id}\n` : "") +
    (offer_id ? `Offer: ${offer_id}\n` : "") +
    (agent_slug ? `Preferred specialist: ${agent_slug}\n` : "");

  const jarvisReq = await fetch(`${SUPABASE_URL}/functions/v1/jarvis-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE}`,
      apikey: SERVICE,
    },
    body: JSON.stringify({
      team_member_id: "hermes",
      conversation_id: conversationId,
      source: "hermes",
      message: `[Inbound from Hermes]\n${routingHint}\nRequest:\n${ask}`,
    }),
  });

  const jarvisRes = await jarvisReq.json().catch(() => ({}));

  return j({
    ok: jarvisReq.ok,
    conversation_id: conversationId,
    task_id: task?.id ?? null,
    jarvis: jarvisRes,
  }, jarvisReq.ok ? 200 : 502);
});