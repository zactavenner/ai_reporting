// Hermes Orchestrator API
// Allows the external Hermes master agent to dispatch tasks to client sub-agents,
// post messages into a dedicated per-client AI Studio channel, and receive
// callbacks when generated assets are ready.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HERMES_BOT_USER_ID = "00000000-0000-0000-0000-000000000001";

const supa = createClient(SUPABASE_URL, SERVICE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadAgencyConfig() {
  const { data, error } = await supa
    .from("agency_settings")
    .select("id, hermes_api_key, hermes_callback_url, hermes_enabled")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function authorize(req: Request) {
  const cfg = await loadAgencyConfig();
  if (!cfg?.hermes_enabled) return { ok: false, status: 403, msg: "Hermes integration disabled" };
  if (!cfg.hermes_api_key) return { ok: false, status: 401, msg: "Hermes API key not configured" };
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== cfg.hermes_api_key) {
    return { ok: false, status: 401, msg: "Invalid bearer token" };
  }
  return { ok: true, cfg };
}

async function resolveClient(ref: { client_id?: string; client_slug?: string; client_name?: string }) {
  if (ref.client_id) {
    const { data } = await supa.from("clients").select("id, name, slug, status").eq("id", ref.client_id).maybeSingle();
    return data;
  }
  if (ref.client_slug) {
    const { data } = await supa.from("clients").select("id, name, slug, status").eq("slug", ref.client_slug).maybeSingle();
    return data;
  }
  if (ref.client_name) {
    const { data } = await supa.from("clients").select("id, name, slug, status").ilike("name", ref.client_name).maybeSingle();
    return data;
  }
  return null;
}

async function getOrCreateHermesConversation(clientId: string): Promise<string> {
  const { data: existing } = await supa
    .from("ai_studio_conversations")
    .select("id")
    .eq("client_id", clientId)
    .eq("kind", "hermes")
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supa
    .from("ai_studio_conversations")
    .insert({
      client_id: clientId,
      user_id: HERMES_BOT_USER_ID,
      kind: "hermes",
      is_shared: true,
      pinned: true,
      title: "🤖 Hermes Orchestrator",
      image_quality: "pro",
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

async function postMessage(conversationId: string, role: "user" | "assistant" | "system", content: string, metadata: any = {}) {
  await supa.from("ai_studio_messages").insert({
    conversation_id: conversationId,
    role,
    content,
    metadata,
  });
  await supa.from("ai_studio_conversations").update({ last_active_at: new Date().toISOString() }).eq("id", conversationId);
}

async function pickDefaultAgent(clientId: string, taskType: string) {
  const typeToCategory: Record<string, string[]> = {
    video: ["video", "creative", "content"],
    static_ad: ["image", "creative", "static_ad"],
    copy: ["copy", "content", "writing"],
    research: ["research", "analyst"],
  };
  const cats = typeToCategory[taskType] || [taskType];
  const { data } = await supa
    .from("client_agents")
    .select("id, name, category, enabled")
    .eq("client_id", clientId)
    .eq("enabled", true)
    .in("category", cats)
    .limit(1);
  return data?.[0] ?? null;
}

async function callHermesCallback(callbackUrl: string | null | undefined, payload: unknown) {
  if (!callbackUrl) return;
  try {
    await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("Hermes callback failed", e);
  }
}

// --------- Action handlers ---------
async function handleCreateTask(body: any, cfg: any) {
  const client = await resolveClient(body);
  if (!client) return json({ error: "Client not found" }, 404);

  const taskType = String(body.task_type || "general").toLowerCase();
  const instructions = String(body.instructions || "").trim();
  if (!instructions) return json({ error: "instructions is required" }, 400);

  const conversationId = await getOrCreateHermesConversation(client.id);
  const agent = await pickDefaultAgent(client.id, taskType);
  const callbackUrl = body.callback_url || cfg.hermes_callback_url || null;

  const { data: task, error } = await supa
    .from("hermes_tasks")
    .insert({
      client_id: client.id,
      conversation_id: conversationId,
      hermes_external_id: body.hermes_external_id || null,
      task_type: taskType,
      instructions,
      status: "queued",
      hermes_callback_url: callbackUrl,
      agent_id: agent?.id || null,
      metadata: body.metadata || {},
    })
    .select("*")
    .single();
  if (error) return json({ error: error.message }, 500);

  const header = `**Hermes Task** • \`${taskType}\`${agent ? ` → routed to **${agent.name}**` : ""}${body.hermes_external_id ? ` • ext: \`${body.hermes_external_id}\`` : ""}`;
  await postMessage(conversationId, "user", `${header}\n\n${instructions}`, { hermes_task_id: task.id, source: "hermes" });
  await postMessage(
    conversationId,
    "assistant",
    agent
      ? `Acknowledged. Routed to **${agent.name}** for ${taskType}. Production will appear in this conversation; the result will be delivered back to Hermes automatically.`
      : `Acknowledged. No matching enabled agent found for \`${taskType}\` on this client — a teammate can pick this up directly in AI Studio.`,
    { hermes_task_id: task.id, source: "hermes" },
  );

  return json({
    task_id: task.id,
    client: { id: client.id, name: client.name, slug: client.slug },
    conversation_id: conversationId,
    agent: agent ? { id: agent.id, name: agent.name } : null,
    status: task.status,
  });
}

async function handleCompleteTask(body: any, cfg: any) {
  const taskId = body.task_id;
  if (!taskId) return json({ error: "task_id required" }, 400);
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const status = body.status || "completed";

  const { data: task, error: loadErr } = await supa
    .from("hermes_tasks").select("*").eq("id", taskId).maybeSingle();
  if (loadErr || !task) return json({ error: "Task not found" }, 404);

  const { error } = await supa.from("hermes_tasks").update({
    status,
    result_assets: assets,
    error_message: body.error_message || null,
    completed_at: new Date().toISOString(),
    delivered_at: new Date().toISOString(),
  }).eq("id", taskId);
  if (error) return json({ error: error.message }, 500);

  if (task.conversation_id) {
    const assetLines = assets.map((a: any, i: number) => `- [${a.title || `Asset ${i + 1}`}](${a.url})`).join("\n");
    await postMessage(
      task.conversation_id,
      "assistant",
      `✅ Delivered to Hermes (${status})${assetLines ? `\n${assetLines}` : ""}`,
      { hermes_task_id: taskId, source: "hermes" },
    );
  }

  await callHermesCallback(task.hermes_callback_url || cfg.hermes_callback_url, {
    event: "task.completed",
    task_id: task.id,
    hermes_external_id: task.hermes_external_id,
    client_id: task.client_id,
    task_type: task.task_type,
    status,
    assets,
    error_message: body.error_message || null,
  });

  return json({ ok: true });
}

async function handleGetTask(body: any) {
  const { data, error } = await supa.from("hermes_tasks").select("*").eq("id", body.task_id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Not found" }, 404);
  return json({ task: data });
}

async function handleListTasks(body: any) {
  let q = supa.from("hermes_tasks").select("*").order("created_at", { ascending: false }).limit(Math.min(Number(body.limit || 50), 200));
  if (body.client_id) q = q.eq("client_id", body.client_id);
  if (body.status) q = q.eq("status", body.status);
  if (body.task_type) q = q.eq("task_type", body.task_type);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ tasks: data });
}

async function handleListClients() {
  const { data, error } = await supa
    .from("clients")
    .select("id, name, slug, status")
    .in("status", ["active", "onboarding", "paused"])
    .order("name");
  if (error) return json({ error: error.message }, 500);
  return json({ clients: data });
}

async function handlePostMessage(body: any) {
  const client = await resolveClient(body);
  if (!client) return json({ error: "Client not found" }, 404);
  const message = String(body.message || "").trim();
  if (!message) return json({ error: "message required" }, 400);
  const conversationId = await getOrCreateHermesConversation(client.id);
  await postMessage(conversationId, body.role === "assistant" ? "assistant" : "user", message, {
    source: "hermes",
    ...(body.metadata || {}),
  });
  return json({ ok: true, conversation_id: conversationId });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await authorize(req);
    if (!auth.ok) return json({ error: auth.msg }, auth.status);

    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    // pathname looks like /hermes-orchestrator/<action>
    const action = (segments[segments.length - 1] || "").toLowerCase();
    const body = req.method === "GET"
      ? Object.fromEntries(url.searchParams.entries())
      : await req.json().catch(() => ({}));

    switch (action) {
      case "create_task":  return await handleCreateTask(body, auth.cfg);
      case "complete_task": return await handleCompleteTask(body, auth.cfg);
      case "get_task":     return await handleGetTask(body);
      case "list_tasks":   return await handleListTasks(body);
      case "list_clients": return await handleListClients();
      case "post_message": return await handlePostMessage(body);
      case "ping":         return json({ ok: true, pong: new Date().toISOString() });
      default:
        return json({
          error: "Unknown action",
          available: ["ping", "list_clients", "create_task", "get_task", "list_tasks", "complete_task", "post_message"],
        }, 400);
    }
  } catch (e) {
    console.error("hermes-orchestrator error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});