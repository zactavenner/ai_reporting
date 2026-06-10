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
  const typeToType: Record<string, string[]> = {
    video: ["video", "creative", "content"],
    static_ad: ["image", "creative", "static_ad"],
    copy: ["copy", "content", "writing"],
    research: ["research", "analyst"],
  };
  const cats = typeToType[taskType] || [taskType];
  const { data } = await supa
    .from("client_agents")
    .select("id, name, agent_type, enabled")
    .eq("client_id", clientId)
    .eq("enabled", true)
    .in("agent_type", cats)
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

  // Idempotency / race guard: only one caller wins the delivery.
  // We atomically claim the task by requiring delivered_at IS NULL.
  // If another concurrent call (or a retry) already delivered it, we
  // short-circuit instead of double-posting messages and callbacks.
  const nowIso = new Date().toISOString();
  const { data: claimed, error } = await supa
    .from("hermes_tasks")
    .update({
      status,
      result_assets: assets,
      error_message: body.error_message || null,
      completed_at: nowIso,
      delivered_at: nowIso,
    })
    .eq("id", taskId)
    .is("delivered_at", null)
    .select("id")
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  if (!claimed) {
    // Already delivered by a prior call — return success without side effects.
    return json({ ok: true, already_delivered: true });
  }

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

// --------- Agent CRUD ---------
async function handleListAgents(body: any) {
  let q = supa.from("client_agents").select("*").order("created_at", { ascending: false });
  if (body.client_id) q = q.eq("client_id", body.client_id);
  if (body.client_slug || body.client_name) {
    const c = await resolveClient(body);
    if (!c) return json({ error: "Client not found" }, 404);
    q = q.eq("client_id", c.id);
  }
  if (body.agent_type) q = q.eq("agent_type", body.agent_type);
  if (typeof body.enabled === "boolean") q = q.eq("enabled", body.enabled);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ agents: data });
}

async function handleGetAgent(body: any) {
  if (!body.agent_id) return json({ error: "agent_id required" }, 400);
  const { data, error } = await supa.from("client_agents").select("*").eq("id", body.agent_id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Not found" }, 404);
  return json({ agent: data });
}

async function handleCreateAgent(body: any) {
  const client = await resolveClient(body);
  if (!client) return json({ error: "Client not found" }, 404);
  const name = String(body.name || "").trim();
  if (!name) return json({ error: "name required" }, 400);
  const handle = String(body.handle || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 60);
  const agent_type = String(body.agent_type || "custom").toLowerCase();
  const insert = {
    client_id: client.id,
    handle,
    name,
    agent_type,
    model: body.model || "google/gemini-3-flash-preview",
    system_prompt: body.system_prompt ?? "",
    knowledge_md: body.knowledge_md ?? "",
    reference_files: Array.isArray(body.reference_files) ? body.reference_files : [],
    enabled: body.enabled !== false,
  };
  const { data, error } = await supa.from("client_agents").insert(insert).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ agent: data });
}

async function handleUpdateAgent(body: any) {
  if (!body.agent_id) return json({ error: "agent_id required" }, 400);
  const patch: Record<string, any> = {};
  for (const k of ["name", "handle", "agent_type", "model", "system_prompt", "knowledge_md", "reference_files", "enabled"]) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) return json({ error: "no fields to update" }, 400);
  const { data, error } = await supa.from("client_agents").update(patch).eq("id", body.agent_id).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ agent: data });
}

async function handleDeleteAgent(body: any) {
  if (!body.agent_id) return json({ error: "agent_id required" }, 400);
  const { error } = await supa.from("client_agents").delete().eq("id", body.agent_id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}

async function handleToggleAgent(body: any) {
  if (!body.agent_id) return json({ error: "agent_id required" }, 400);
  const { data: row } = await supa.from("client_agents").select("enabled").eq("id", body.agent_id).maybeSingle();
  if (!row) return json({ error: "Not found" }, 404);
  const enabled = typeof body.enabled === "boolean" ? body.enabled : !row.enabled;
  const { data, error } = await supa.from("client_agents").update({ enabled }).eq("id", body.agent_id).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ agent: data });
}

// --------- Task management beyond create/complete ---------
async function handleUpdateTask(body: any) {
  if (!body.task_id) return json({ error: "task_id required" }, 400);
  const patch: Record<string, any> = {};
  for (const k of ["status", "instructions", "task_type", "agent_id", "metadata", "result_assets", "error_message", "hermes_callback_url"]) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) return json({ error: "no fields to update" }, 400);
  const { data, error } = await supa.from("hermes_tasks").update(patch).eq("id", body.task_id).select("*").single();
  if (error) return json({ error: error.message }, 500);
  return json({ task: data });
}

async function handleCancelTask(body: any) {
  if (!body.task_id) return json({ error: "task_id required" }, 400);
  const { data, error } = await supa
    .from("hermes_tasks")
    .update({ status: "cancelled", error_message: body.reason || "Cancelled by Hermes" })
    .eq("id", body.task_id)
    .select("*")
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({ task: data });
}

async function handleAssignTask(body: any) {
  if (!body.task_id || !body.agent_id) return json({ error: "task_id and agent_id required" }, 400);
  const { data, error } = await supa
    .from("hermes_tasks")
    .update({ agent_id: body.agent_id })
    .eq("id", body.task_id)
    .select("*")
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({ task: data });
}

// --------- Generation triggers (call internal edge functions) ---------
async function invokeEdge(name: string, body: any) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { ok: r.ok, status: r.status, data: parsed };
}

async function trackedGenerate(opts: {
  client: { id: string; name: string };
  taskType: string;
  instructions: string;
  cfg: any;
  metadata?: any;
  externalId?: string | null;
  hermesCallbackUrl?: string | null;
  run: () => Promise<{ ok: boolean; status: number; data: any }>;
}) {
  const conversationId = await getOrCreateHermesConversation(opts.client.id);
  const agent = await pickDefaultAgent(opts.client.id, opts.taskType);
  const callbackUrl = opts.hermesCallbackUrl || opts.cfg.hermes_callback_url || null;
  const { data: task, error } = await supa.from("hermes_tasks").insert({
    client_id: opts.client.id,
    conversation_id: conversationId,
    hermes_external_id: opts.externalId || null,
    task_type: opts.taskType,
    instructions: opts.instructions,
    status: "running",
    hermes_callback_url: callbackUrl,
    agent_id: agent?.id || null,
    metadata: opts.metadata || {},
  }).select("*").single();
  if (error) return json({ error: error.message }, 500);

  await postMessage(conversationId, "user", `**Hermes ${opts.taskType}** request\n\n${opts.instructions}`, { hermes_task_id: task.id, source: "hermes" });

  const res = await opts.run().catch((e) => ({ ok: false, status: 500, data: { error: e?.message || String(e) } }));
  const nowIso = new Date().toISOString();

  if (!res.ok) {
    await supa.from("hermes_tasks").update({
      status: "failed",
      error_message: typeof res.data?.error === "string" ? res.data.error : JSON.stringify(res.data).slice(0, 500),
      completed_at: nowIso,
      delivered_at: nowIso,
    }).eq("id", task.id);
    await postMessage(conversationId, "assistant", `❌ Hermes ${opts.taskType} failed: ${res.data?.error || res.status}`, { hermes_task_id: task.id, source: "hermes" });
    await callHermesCallback(callbackUrl, {
      event: "task.completed",
      task_id: task.id,
      hermes_external_id: task.hermes_external_id,
      client_id: task.client_id,
      task_type: opts.taskType,
      status: "failed",
      error_message: res.data?.error || `HTTP ${res.status}`,
      assets: [],
    });
    return json({ task_id: task.id, status: "failed", error: res.data?.error || `HTTP ${res.status}` }, 502);
  }

  // Try to derive assets from the response
  const assets = extractAssets(res.data);
  await supa.from("hermes_tasks").update({
    status: "completed",
    result_assets: assets,
    completed_at: nowIso,
    delivered_at: nowIso,
    metadata: { ...(opts.metadata || {}), generation_result: res.data },
  }).eq("id", task.id);

  const assetLines = assets.map((a: any, i: number) => `- [${a.title || `Asset ${i + 1}`}](${a.url})`).join("\n");
  await postMessage(conversationId, "assistant", `✅ Hermes ${opts.taskType} delivered.${assetLines ? `\n${assetLines}` : ""}`, { hermes_task_id: task.id, source: "hermes" });

  await callHermesCallback(callbackUrl, {
    event: "task.completed",
    task_id: task.id,
    hermes_external_id: task.hermes_external_id,
    client_id: task.client_id,
    task_type: opts.taskType,
    status: "completed",
    assets,
    result: res.data,
  });

  return json({ task_id: task.id, status: "completed", assets, result: res.data });
}

function extractAssets(data: any): Array<{ title?: string; url: string; kind?: string }> {
  const out: Array<{ title?: string; url: string; kind?: string }> = [];
  if (!data) return out;
  if (Array.isArray(data.assets)) return data.assets;
  if (data.asset?.storage_url) out.push({ title: data.asset.title || "asset", url: data.asset.storage_url, kind: data.asset.kind });
  if (data.video?.storage_url) out.push({ title: data.video.title || "video", url: data.video.storage_url, kind: "video" });
  if (data.storage_url) out.push({ url: data.storage_url });
  if (data.url) out.push({ url: data.url });
  if (data.image_url) out.push({ url: data.image_url, kind: "image" });
  return out;
}

async function handleGenerateCopy(body: any, cfg: any) {
  const client = await resolveClient(body);
  if (!client) return json({ error: "Client not found" }, 404);
  const asset_type = String(body.asset_type || body.copy_type || "adcopy").toLowerCase();
  return trackedGenerate({
    client,
    taskType: "copy",
    instructions: body.instructions || `Generate ${asset_type} copy`,
    cfg,
    metadata: { asset_type, ...(body.metadata || {}) },
    externalId: body.hermes_external_id,
    hermesCallbackUrl: body.callback_url,
    run: () => invokeEdge("generate-asset", {
      client_id: client.id,
      asset_type,
      client_data: body.client_data,
      existing_research: body.existing_research,
      existing_angles: body.existing_angles,
      offer_id: body.offer_id,
    }),
  });
}

async function handleGenerateVideo(body: any, cfg: any) {
  const client = await resolveClient(body);
  if (!client) return json({ error: "Client not found" }, 404);
  const fnName = body.image_url ? "generate-video-from-image" : "generate-asset";
  const payload = body.image_url
    ? {
        client_id: client.id,
        image_url: body.image_url,
        prompt: body.prompt || body.instructions || "",
        aspect_ratio: body.aspect_ratio || "9:16",
        duration: body.duration || 5,
        model: body.model,
      }
    : {
        client_id: client.id,
        asset_type: "vsl",
        client_data: body.client_data,
        offer_id: body.offer_id,
      };
  return trackedGenerate({
    client,
    taskType: "video",
    instructions: body.instructions || body.prompt || `Generate video (${body.aspect_ratio || "9:16"})`,
    cfg,
    metadata: { ...(body.metadata || {}), aspect_ratio: body.aspect_ratio, duration: body.duration },
    externalId: body.hermes_external_id,
    hermesCallbackUrl: body.callback_url,
    run: () => invokeEdge(fnName, payload),
  });
}

async function handleGenerateImage(body: any, cfg: any) {
  const client = await resolveClient(body);
  if (!client) return json({ error: "Client not found" }, 404);
  return trackedGenerate({
    client,
    taskType: "static_ad",
    instructions: body.instructions || body.prompt || "Generate static ad",
    cfg,
    metadata: body.metadata || {},
    externalId: body.hermes_external_id,
    hermesCallbackUrl: body.callback_url,
    run: () => invokeEdge("generate-static-ad", {
      client_id: client.id,
      prompt: body.prompt || body.instructions,
      offer_id: body.offer_id,
      aspect_ratio: body.aspect_ratio || "1:1",
      style: body.style,
    }),
  });
}

async function handleGenerateBrief(body: any, cfg: any) {
  const client = await resolveClient(body);
  if (!client) return json({ error: "Client not found" }, 404);
  return trackedGenerate({
    client,
    taskType: "brief",
    instructions: body.instructions || "Generate creative brief",
    cfg,
    metadata: body.metadata || {},
    externalId: body.hermes_external_id,
    hermesCallbackUrl: body.callback_url,
    run: () => invokeEdge("generate-brief", { client_id: client.id, offer_id: body.offer_id, instructions: body.instructions }),
  });
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
      case "update_task":  return await handleUpdateTask(body);
      case "cancel_task":  return await handleCancelTask(body);
      case "assign_task":  return await handleAssignTask(body);
      case "get_task":     return await handleGetTask(body);
      case "list_tasks":   return await handleListTasks(body);
      case "list_clients": return await handleListClients();
      case "post_message": return await handlePostMessage(body);
      // Agent CRUD
      case "list_agents":  return await handleListAgents(body);
      case "get_agent":    return await handleGetAgent(body);
      case "create_agent": return await handleCreateAgent(body);
      case "update_agent": return await handleUpdateAgent(body);
      case "delete_agent": return await handleDeleteAgent(body);
      case "toggle_agent": return await handleToggleAgent(body);
      // Generation triggers
      case "generate_copy":   return await handleGenerateCopy(body, auth.cfg);
      case "generate_video":  return await handleGenerateVideo(body, auth.cfg);
      case "generate_image":  return await handleGenerateImage(body, auth.cfg);
      case "generate_static_ad": return await handleGenerateImage(body, auth.cfg);
      case "generate_brief":  return await handleGenerateBrief(body, auth.cfg);
      case "ping":         return json({ ok: true, pong: new Date().toISOString() });
      default:
        return json({
          error: "Unknown action",
          available: [
            "ping", "list_clients", "post_message",
            "create_task", "get_task", "list_tasks", "update_task", "cancel_task", "assign_task", "complete_task",
            "list_agents", "get_agent", "create_agent", "update_agent", "delete_agent", "toggle_agent",
            "generate_copy", "generate_video", "generate_image", "generate_static_ad", "generate_brief",
          ],
        }, 400);
    }
  } catch (e) {
    console.error("hermes-orchestrator error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});