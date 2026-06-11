// Hermes Task Executor
// Picks up a queued hermes_task, runs the assigned client_agent against an
// AI gateway with the agent's system prompt + knowledge_md + per-client
// memory profile, then marks the task complete (or failed) and triggers
// the same delivery path as the public `complete_task` endpoint.
//
// Invoked fire-and-forget by hermes-orchestrator/create_task via
// EdgeRuntime.waitUntil so external Hermes callers get an immediate
// `queued` acknowledgement and the executor finishes in the background.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || Deno.env.get("OPENROUTER_API_KEY") || "";
const HERMES_BOT_USER_ID = "00000000-0000-0000-0000-000000000001";
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const supa = createClient(SUPABASE_URL, SERVICE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadProfile(clientId: string) {
  const { data } = await supa
    .from("client_agent_profiles")
    .select("profile_md, brand_kit, notes")
    .eq("client_id", clientId)
    .maybeSingle();
  return data || null;
}

async function loadAgent(agentId: string | null) {
  if (!agentId) return null;
  const { data } = await supa
    .from("client_agents")
    .select("id, name, handle, agent_type, model, system_prompt, knowledge_md, reference_files")
    .eq("id", agentId)
    .maybeSingle();
  return data;
}

async function postMessage(conversationId: string, role: "assistant" | "user", content: string, metadata: any = {}) {
  await supa.from("ai_studio_messages").insert({ conversation_id: conversationId, role, content, metadata });
  await supa.from("ai_studio_conversations").update({ last_active_at: new Date().toISOString() }).eq("id", conversationId);
}

async function callbackHermes(url: string | null | undefined, payload: any) {
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch (e) { console.warn("hermes callback failed", e); }
}

async function runAgentInference(opts: {
  agent: any;
  profile: any;
  client: { id: string; name: string };
  instructions: string;
  taskType: string;
  metadata: any;
}) {
  const sysParts: string[] = [];
  if (opts.agent?.system_prompt) sysParts.push(opts.agent.system_prompt);
  if (opts.agent?.knowledge_md) sysParts.push(`# Knowledge\n${opts.agent.knowledge_md}`);
  if (opts.profile?.profile_md) sysParts.push(`# Client Memory (${opts.client.name})\n${opts.profile.profile_md}`);
  if (opts.profile?.brand_kit && Object.keys(opts.profile.brand_kit).length) {
    sysParts.push(`# Brand Kit\n\`\`\`json\n${JSON.stringify(opts.profile.brand_kit, null, 2)}\n\`\`\``);
  }
  sysParts.push(
    `You are executing a Hermes task of type "${opts.taskType}" for client "${opts.client.name}". ` +
    `Respond with JSON: { "summary": string, "assets": [{ "title": string, "url"?: string, "kind"?: string, "text"?: string }], "notes"?: string }. ` +
    `If you cannot produce real asset URLs, return text assets so a human can pick them up in AI Studio.`,
  );

  const model = opts.agent?.model || "google/gemini-2.5-flash";
  const body = {
    model,
    messages: [
      { role: "system", content: sysParts.join("\n\n") },
      { role: "user", content: `${opts.instructions}\n\nMetadata: ${JSON.stringify(opts.metadata || {})}` },
    ],
    temperature: 0.4,
    max_tokens: 2048,
  } as any;

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || "";
  let parsed: any = null;
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { summary: raw.slice(0, 1500), assets: [{ title: "Agent output", text: raw }] };
  }
  const usage = data?.usage || {};
  return { parsed, raw, model, usage };
}

// Rough per-1k-token pricing for cost_usd estimation. Update as new models ship.
const PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-2.5-flash": { in: 0.000075, out: 0.0003 },
  "google/gemini-2.5-pro":   { in: 0.00125, out: 0.005 },
  "google/gemini-3-flash-preview": { in: 0.000075, out: 0.0003 },
  "openai/gpt-5":            { in: 0.005, out: 0.015 },
  "openai/gpt-5-mini":       { in: 0.00025, out: 0.002 },
};
function estimateCost(model: string, usage: { prompt_tokens?: number; completion_tokens?: number }) {
  const p = PRICING[model] || PRICING["google/gemini-2.5-flash"];
  const inK = (usage.prompt_tokens || 0) / 1000;
  const outK = (usage.completion_tokens || 0) / 1000;
  return +(inK * p.in + outK * p.out).toFixed(6);
}

async function executeTask(taskId: string) {
  const { data: task } = await supa.from("hermes_tasks").select("*").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false, error: "task not found" };
  if (task.status === "completed" || task.status === "failed" || task.delivered_at) {
    return { ok: true, already: true };
  }

  await supa.from("hermes_tasks").update({ status: "running" }).eq("id", taskId);

  const { data: client } = await supa.from("clients").select("id, name").eq("id", task.client_id).maybeSingle();
  if (!client) return { ok: false, error: "client not found" };

  const agent = await loadAgent(task.agent_id);
  const profile = await loadProfile(task.client_id);
  const startedAt = Date.now();

  try {
    const { parsed, raw, model, usage } = await runAgentInference({
      agent,
      profile,
      client: { id: client.id, name: client.name },
      instructions: task.instructions || "",
      taskType: task.task_type || "general",
      metadata: task.metadata || {},
    });

    const assets = Array.isArray(parsed?.assets) ? parsed.assets : [];
    const nowIso = new Date().toISOString();
    await supa.from("hermes_tasks").update({
      status: "completed",
      result_assets: assets,
      completed_at: nowIso,
      delivered_at: nowIso,
      metadata: { ...(task.metadata || {}), summary: parsed?.summary || null, model, usage, cost_usd: estimateCost(model, usage), duration_ms: Date.now() - startedAt },
    }).eq("id", taskId).is("delivered_at", null);

    if (task.conversation_id) {
      const lines: string[] = [];
      if (parsed?.summary) lines.push(parsed.summary);
      if (assets.length) {
        lines.push("");
        for (const a of assets) {
          if (a.url) lines.push(`- [${a.title || "asset"}](${a.url})`);
          else if (a.text) lines.push(`**${a.title || "asset"}**\n\n${a.text}`);
        }
      }
      await postMessage(task.conversation_id, "assistant",
        `🤖 ${agent?.name || "Agent"} — completed\n\n${lines.join("\n")}`.trim(),
        { hermes_task_id: taskId, source: "hermes", model });
    }

    await callbackHermes(task.hermes_callback_url, {
      event: "task.completed",
      task_id: taskId,
      hermes_external_id: task.hermes_external_id,
      client_id: task.client_id,
      task_type: task.task_type,
      status: "completed",
      assets,
      summary: parsed?.summary || null,
    });
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message || String(e);
    const nowIso = new Date().toISOString();
    await supa.from("hermes_tasks").update({
      status: "failed",
      error_message: msg.slice(0, 1000),
      completed_at: nowIso,
      delivered_at: nowIso,
    }).eq("id", taskId).is("delivered_at", null);
    if (task.conversation_id) {
      await postMessage(task.conversation_id, "assistant", `❌ Agent failed: ${msg}`, { hermes_task_id: taskId, source: "hermes" });
    }
    await callbackHermes(task.hermes_callback_url, {
      event: "task.completed",
      task_id: taskId,
      hermes_external_id: task.hermes_external_id,
      client_id: task.client_id,
      task_type: task.task_type,
      status: "failed",
      error_message: msg,
      assets: [],
    });
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.password !== "HPA1234$") return json({ error: "unauthorized" }, 401);
    const taskId = body.task_id || body.taskId;
    if (!taskId) return json({ error: "task_id required" }, 400);
    const result = await executeTask(taskId);
    return json(result, result.ok ? 200 : 500);
  } catch (e) {
    console.error("hermes-task-executor error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});