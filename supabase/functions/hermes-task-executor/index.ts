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
const OPENROUTER_API_KEY = (Deno.env.get("OPENROUTER_API_KEY") || "").trim();
const HERMES_BOT_USER_ID = "00000000-0000-0000-0000-000000000001";
const AI_GATEWAY_URL = "https://openrouter.ai/api/v1/chat/completions";

const supa = createClient(SUPABASE_URL, SERVICE_KEY);

function getOpenRouterKey() {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
  if (!OPENROUTER_API_KEY.startsWith("sk")) throw new Error("OPENROUTER_API_KEY has an invalid format. It must be an OpenRouter key.");
  return OPENROUTER_API_KEY;
}

// ------------------------------------------------------------------
// Channel audit + back-and-forth helpers
// ------------------------------------------------------------------
// Every Hermes task now mirrors its lifecycle into an agent_channels
// thread so Hermes and the agent can be observed (and replied to)
// from the UI in real time. For multi-turn tasks the agent can return
// `{ needs_input: true, question: "..." }` and Hermes will auto-reply
// with extra context up to MAX_TURNS.
const MAX_AGENT_TURNS = 3;

async function ensureAgentChannel(clientId: string | null, agentId: string | null, agentName?: string) {
  if (!agentId) return null;
  const scope = clientId ? "client" : "agency";
  let q = supa.from("agent_channels").select("id").eq("scope", scope).eq("agent_id", agentId).eq("kind", "agent");
  q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
  const { data: existing } = await q.maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created } = await supa.from("agent_channels").insert({
    scope, client_id: clientId, agent_id: agentId, kind: "agent",
    name: "#agent-" + (agentName ? agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) : agentId.slice(0, 6)),
  }).select("id").maybeSingle();
  return created?.id ?? null;
}

async function postChannel(opts: {
  channelId: string | null;
  role: "agent" | "human" | "system";
  kind: "message" | "command" | "handoff" | "escalation" | "task-comment" | "tool-call" | "model-call";
  body: string;
  taskId?: string | null;
  toAgentId?: string | null;
  fromAgentId?: string | null;
  payload?: Record<string, unknown>;
}) {
  if (!opts.channelId) return;
  try {
    await supa.from("agent_messages").insert({
      channel_id: opts.channelId,
      role: opts.role,
      kind: opts.kind,
      body: opts.body.slice(0, 8000),
      task_id: opts.taskId || null,
      to_agent_id: opts.toAgentId || null,
      from_agent_id: opts.fromAgentId || null,
      user_id: HERMES_BOT_USER_ID,
      payload: opts.payload || {},
    });
  } catch (e) {
    console.warn("postChannel failed (non-fatal)", e);
  }
}

// Task types that should drive a real creative generation through ai-studio
// (image + canvas drop) instead of a plain LLM text summary. Hermes-routed
// creative tasks are locked to: openai/gpt-image-2 for images and
// bytedance/seedance-2.0-fast @ 720p for videos. Output appears in the
// per-client Hermes conversation chat + canvas for full audit tracking.
const IMAGE_TASK_TYPES = new Set([
  "image", "image_ad", "static", "static_ad", "ad", "creative", "creative_image",
]);
const VIDEO_TASK_TYPES = new Set([
  "video", "video_ad", "reel", "creative_video", "ugc_video",
]);

async function invokeAiStudioForCreative(opts: {
  task: any;
  client: { id: string; name: string };
  agent: any | null;
  isVideo: boolean;
}): Promise<{ summary: string }> {
  const { task, client, agent, isVideo } = opts;
  // Lock the model + resolution. Hermes never picks anything else — this
  // guarantees the agent cannot drift to other providers or sizes.
  const lockedImageModels = isVideo ? null : ["openai"]; // openai => GPT Image 2
  const lockedVideoModel = isVideo ? "bytedance/seedance-2.0-fast" : null;
  const lockedVideoResolution = isVideo ? "720p" : null;

  const guard = [
    `🔒 HERMES HARD-LOCK — generate ${isVideo ? "a 15s 720p video" : "a static ad image"} for **${client.name}** now.`,
    `MANDATORY: Your FIRST and ONLY action this turn MUST be a tool_call to ${isVideo ? "generate_seedance_video" : "generate_static_ad"}. DO NOT write a script, plan, brief, or any chat reply. Emit the tool_call immediately. Text-only responses are forbidden.`,
    isVideo
      ? `Use ONLY model="bytedance/seedance-2.0-fast" at resolution="720p" duration=15s. Do not switch models.`
      : `Use ONLY image model="openai" (GPT Image 2). Do not switch models.`,
    `Ground every creative choice in this client's offers, brand kit, and best-performing references. NEVER reference or pull data from any other client.`,
    `Drop the result on the canvas and post the asset URL in chat so the team can audit it.`,
    `Hermes task: ${task.task_type}`,
    ``,
    `Brief:`,
    task.instructions || "(no instructions)",
  ].join("\n");

  const payload: Record<string, unknown> = {
    internalSecret: "HPA1234$",
    internalUserId: HERMES_BOT_USER_ID,
    clientId: client.id,
    conversationId: task.conversation_id,
    userText: guard,
    chatModel: agent?.model || "nvidia/nemotron-3-ultra-550b-a55b:free",
    quality: "pro",
    agentMode: true,
    adFormat: isVideo ? "reel_9x16" : "static_1x1",
    imageModels: lockedImageModels,
    videoModel: lockedVideoModel,
    videoModels: lockedVideoModel ? [lockedVideoModel] : null,
    videoResolution: lockedVideoResolution,
    forceToolName: isVideo ? "generate_seedance_video" : "generate_static_ad",
  };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-studio`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`ai-studio invoke ${res.status}: ${t.slice(0, 400)}`);
  }
  // Drain the SSE stream so ai-studio finishes generation, persists the
  // canvas item, and posts the assistant message before we resolve.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let collected = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) collected += decoder.decode(value, { stream: true });
  }
  // Best-effort summary line: ai-studio prints "done" / asset URLs in SSE,
  // but for the Hermes record we just note what was attempted.
  return {
    summary: `Routed to AI Studio for ${isVideo ? "video" : "static"} generation. Asset will appear in the canvas + chat.`,
  };
}

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

// Load open-task triage context for a client: open tasks (+ current assignees),
// every agency member with their pod, and pod list. Returns a compact payload
// suitable for embedding in the task_triage system prompt.
async function loadTriageContext(clientId: string) {
  const [{ data: tasks }, { data: members }, { data: pods }] = await Promise.all([
    supa.from("tasks")
      .select("id, title, description, status, priority, due_date, created_at, assigned_to, task_assignees(member_id, pod_id, member:agency_members(id,name), pod:agency_pods(id,name)), task_comments(id, content, author_name, created_at)")
      .eq("client_id", clientId)
      .in("status", ["todo", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200),
    supa.from("agency_members").select("id, name, role, pod:agency_pods(id,name,description)").order("name"),
    supa.from("agency_pods").select("id, name, description").order("name"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const taskList = (tasks || []).map((t: any) => ({
    id: t.id,
    title: t.title,
    description: (t.description || "").slice(0, 300),
    status: t.status,
    priority: t.priority,
    due_date: t.due_date,
    overdue: t.due_date && t.due_date < today,
    age_days: t.created_at ? Math.round((Date.now() - new Date(t.created_at).getTime()) / 86400000) : null,
    assignees: (t.task_assignees || []).map((a: any) => ({
      member: a.member?.name || null,
      member_id: a.member_id,
      pod: a.pod?.name || null,
      pod_id: a.pod_id,
    })),
    comment_count: (t.task_comments || []).length,
  }));
  return {
    today,
    tasks: taskList,
    members: (members || []).map((m: any) => ({ id: m.id, name: m.name, role: m.role, pod: m.pod?.name || null })),
    pods: pods || [],
  };
}

// Apply AI-produced writebacks against the live tables. All best-effort —
// individual failures are logged and skipped so a single bad row doesn't
// abort the whole triage.
async function applyTriageWritebacks(parsed: any, agentName: string) {
  const updates = Array.isArray(parsed?.task_updates) ? parsed.task_updates : [];
  const assignChanges = Array.isArray(parsed?.task_assignee_changes) ? parsed.task_assignee_changes : [];
  const comments = Array.isArray(parsed?.task_comments) ? parsed.task_comments : [];

  const stats = { updated: 0, reassigned: 0, commented: 0, errors: [] as string[] };

  for (const u of updates) {
    if (!u?.task_id) continue;
    const patch: any = {};
    for (const k of ["status", "priority", "due_date", "title", "description"]) {
      if (u[k] !== undefined && u[k] !== null && u[k] !== "") patch[k] = u[k];
    }
    if (patch.status === "done") patch.completed_at = new Date().toISOString();
    if (!Object.keys(patch).length) continue;
    const { error } = await supa.from("tasks").update(patch).eq("id", u.task_id);
    if (error) stats.errors.push(`update ${u.task_id}: ${error.message}`);
    else {
      stats.updated++;
      await supa.from("task_history").insert({
        task_id: u.task_id, action: "hermes_triage_update",
        new_value: JSON.stringify(patch), changed_by: `Hermes:${agentName}`,
      }).then(() => {}, () => {});
    }
  }

  for (const a of assignChanges) {
    if (!a?.task_id) continue;
    const memberIds = Array.from(new Set([...(a.set_member_ids || []), ...(a.add_member_ids || [])])).filter(Boolean);
    const podIds = Array.from(new Set([...(a.set_pod_ids || []), ...(a.add_pod_ids || [])])).filter(Boolean);
    if (a.set_member_ids !== undefined || a.set_pod_ids !== undefined) {
      await supa.from("task_assignees").delete().eq("task_id", a.task_id);
    }
    const rows = [
      ...memberIds.map((id: string) => ({ task_id: a.task_id, member_id: id, pod_id: null })),
      ...podIds.map((id: string) => ({ task_id: a.task_id, member_id: null, pod_id: id })),
    ];
    if (rows.length) {
      const { error } = await supa.from("task_assignees").insert(rows);
      if (error && !/duplicate|unique/i.test(error.message)) {
        stats.errors.push(`assign ${a.task_id}: ${error.message}`);
      } else {
        stats.reassigned++;
        if (memberIds[0]) {
          await supa.from("tasks").update({ assigned_to: memberIds[0] }).eq("id", a.task_id);
        }
      }
    }
  }

  for (const c of comments) {
    if (!c?.task_id || !c?.content) continue;
    const { error } = await supa.from("task_comments").insert({
      task_id: c.task_id,
      author_name: `Hermes (${agentName})`,
      content: String(c.content).slice(0, 4000),
    });
    if (error) stats.errors.push(`comment ${c.task_id}: ${error.message}`);
    else stats.commented++;
  }

  return stats;
}

async function postMessage(conversationId: string, role: "assistant" | "user", content: string, metadata: any = {}) {
  const { error } = await supa.from("ai_studio_messages").insert({
    conversation_id: conversationId,
    user_id: HERMES_BOT_USER_ID,
    role,
    content,
    tools: metadata ? [{ kind: "hermes_meta", data: metadata }] : [],
  });
  if (error) console.error("executor postMessage insert failed", error);
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
  triageContext?: any;
  followups?: { question: string; hermes_reply: string }[];
}) {
  const sysParts: string[] = [];
  if (opts.agent?.system_prompt) sysParts.push(opts.agent.system_prompt);
  if (opts.agent?.knowledge_md) sysParts.push(`# Knowledge\n${opts.agent.knowledge_md}`);
  if (opts.profile?.profile_md) sysParts.push(`# Client Memory (${opts.client.name})\n${opts.profile.profile_md}`);
  if (opts.profile?.brand_kit && Object.keys(opts.profile.brand_kit).length) {
    sysParts.push(`# Brand Kit\n\`\`\`json\n${JSON.stringify(opts.profile.brand_kit, null, 2)}\n\`\`\``);
  }
  if (opts.taskType === "task_triage" && opts.triageContext) {
    sysParts.push(
      `You are the Hermes Task Triage agent for client "${opts.client.name}". Today is ${opts.triageContext.today}.\n\n` +
      `# Open Tasks (${opts.triageContext.tasks.length})\n\`\`\`json\n${JSON.stringify(opts.triageContext.tasks, null, 2)}\n\`\`\`\n\n` +
      `# Agency Members\n\`\`\`json\n${JSON.stringify(opts.triageContext.members, null, 2)}\n\`\`\`\n\n` +
      `# Pods\n\`\`\`json\n${JSON.stringify(opts.triageContext.pods, null, 2)}\n\`\`\`\n\n` +
      `Return ONLY JSON of shape:\n` +
      `{\n` +
      `  "summary": string,  // 2-4 sentences describing the triage you did\n` +
      `  "task_updates": [{ "task_id": string, "status"?: "todo"|"in_progress"|"done", "priority"?: "low"|"medium"|"high", "due_date"?: "YYYY-MM-DD" }],\n` +
      `  "task_assignee_changes": [{ "task_id": string, "set_member_ids"?: string[], "set_pod_ids"?: string[], "add_member_ids"?: string[], "add_pod_ids"?: string[] }],\n` +
      `  "task_comments": [{ "task_id": string, "content": string }],  // one short comment per actioned task explaining why\n` +
      `  "assets": []  // unused for triage\n` +
      `}\n` +
      `Rules:\n- Tag a member (or pod) for every unassigned task; pick from the lists above.\n- Suggest a realistic due_date for any task missing one (within 7 business days).\n- Mark stale "in_progress" tasks done if the description suggests completion.\n- Leave a short comment on every task you touch.`
    );
  } else {
    sysParts.push(
      `You are executing a Hermes task of type "${opts.taskType}" for client "${opts.client.name}". ` +
      `Respond with JSON ONLY in one of these shapes:\n` +
      `  Final answer: { "summary": string, "assets": [{ "title": string, "url"?: string, "kind"?: string, "text"?: string }], "notes"?: string }\n` +
      `  Ask Hermes:  { "needs_input": true, "question": string }\n` +
      `Use "needs_input" only when missing facts truly block the work — Hermes will reply with the answer and you'll continue. ` +
      `If you cannot produce real asset URLs, return text assets so a human can pick them up in AI Studio.`,
    );
  }

  const model = opts.agent?.model || "nvidia/nemotron-3-ultra-550b-a55b:free";
  const messages: any[] = [
    { role: "system", content: sysParts.join("\n\n") },
    { role: "user", content: `${opts.instructions}\n\nMetadata: ${JSON.stringify(opts.metadata || {})}` },
  ];
  for (const f of (opts.followups || [])) {
    messages.push({ role: "assistant", content: JSON.stringify({ needs_input: true, question: f.question }) });
    messages.push({ role: "user", content: `Hermes reply: ${f.hermes_reply}` });
  }
  const body = {
    model,
    messages,
    temperature: opts.taskType === "task_triage" ? 0.2 : 0.4,
    max_tokens: opts.taskType === "task_triage" ? 6000 : 2048,
  } as any;

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenRouterKey()}`,
      "HTTP-Referer": "https://reporting.highperformanceads.com",
      "X-Title": "Hermes Task Executor",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 400)}`);
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

// Hermes acts as the coordinator when the agent asks a question.
// Lightweight LLM call grounded only on the original task brief + client
// context — no external lookups, so it stays fast and deterministic.
async function hermesAutoReply(question: string, client: { name: string }, taskBrief: string, profileMd: string | null) {
  const sys = `You are Hermes, the agency coordinator for client "${client.name}". `
    + `An agent asked a clarifying question while working a task. Reply concisely (1-3 sentences) with the answer or best-judgment guidance so the agent can finish. `
    + `Never invent client data — if unknown, tell the agent to proceed with stated assumptions.`;
  const usr = `Original task brief:\n${taskBrief}\n\nClient memory:\n${(profileMd || "(none)").slice(0, 2000)}\n\nAgent question:\n${question}`;
  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenRouterKey()}`,
      "HTTP-Referer": "https://reporting.highperformanceads.com",
      "X-Title": "Hermes Coordinator",
    },
    body: JSON.stringify({
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      temperature: 0.3,
      max_tokens: 400,
    }),
  });
  if (!res.ok) return "Proceed with reasonable assumptions; flag anything risky in your summary.";
  const d = await res.json().catch(() => null);
  return (d?.choices?.[0]?.message?.content || "Proceed with reasonable assumptions.").trim();
}

// Rough per-1k-token pricing for cost_usd estimation. Update as new models ship.
const PRICING: Record<string, { in: number; out: number }> = {
  "nvidia/nemotron-3-ultra-550b-a55b:free": { in: 0, out: 0 },
  "google/gemini-2.5-flash": { in: 0.000075, out: 0.0003 },
  "google/gemini-2.5-pro":   { in: 0.00125, out: 0.005 },
  "google/gemini-3-flash-preview": { in: 0.000075, out: 0.0003 },
  "openai/gpt-5":            { in: 0.005, out: 0.015 },
  "openai/gpt-5-mini":       { in: 0.00025, out: 0.002 },
};
function estimateCost(model: string, usage: { prompt_tokens?: number; completion_tokens?: number }) {
  const p = PRICING[model] || PRICING["nvidia/nemotron-3-ultra-550b-a55b:free"];
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
  const channelId = await ensureAgentChannel(task.client_id, task.agent_id, agent?.name);
  await postChannel({
    channelId, role: "system", kind: "command", taskId: taskId, toAgentId: task.agent_id,
    body: `🪽 Hermes dispatched **${task.task_type}** task for ${client.name}.\n\n${(task.instructions || "").slice(0, 1200)}`,
    payload: { hermes_task_id: taskId, task_type: task.task_type },
  });

  try {
    const triageContext = task.task_type === "task_triage"
      ? await loadTriageContext(task.client_id)
      : undefined;

    // Creative tasks: route through ai-studio so the generated image/video
    // lands on the per-client canvas AND posts an assistant message in the
    // Hermes conversation (mirrors the regular user surface for audit and
    // creative tracking). Locked to GPT Image 2 (images) and Seedance 2.0
    // Fast @ 720p (videos). Client-scoped: ai-studio only resolves offers,
    // brand kit, and references for task.client_id.
    const ttype = (task.task_type || "").toLowerCase();
    if (IMAGE_TASK_TYPES.has(ttype) || VIDEO_TASK_TYPES.has(ttype)) {
      const isVideo = VIDEO_TASK_TYPES.has(ttype);
      const { summary } = await invokeAiStudioForCreative({
        task,
        client: { id: client.id, name: client.name },
        agent,
        isVideo,
      });
      await postChannel({
        channelId, role: "agent", kind: "tool-call", taskId: taskId, fromAgentId: task.agent_id,
        body: `🎨 ${isVideo ? "Video" : "Image"} generation routed to AI Studio.\n${summary}`,
        payload: { source: "ai-studio", isVideo },
      });
      const nowIso = new Date().toISOString();
      await supa.from("hermes_tasks").update({
        status: "completed",
        result_assets: [],
        completed_at: nowIso,
        delivered_at: nowIso,
        metadata: {
          ...(task.metadata || {}),
          summary,
          model: isVideo ? "bytedance/seedance-2.0-fast" : "openai/gpt-image-2",
          resolution: isVideo ? "720p" : null,
          source: "ai-studio",
          duration_ms: Date.now() - startedAt,
        },
      }).eq("id", taskId).is("delivered_at", null);
      await callbackHermes(task.hermes_callback_url, {
        event: "task.completed",
        task_id: taskId,
        hermes_external_id: task.hermes_external_id,
        client_id: task.client_id,
        task_type: task.task_type,
        status: "completed",
        assets: [],
        summary,
      });
      return { ok: true, routed: "ai-studio" };
    }

    // Multi-turn loop: agent ↔ Hermes back-and-forth, posted to channel.
    const followups: { question: string; hermes_reply: string }[] = [];
    let parsed: any, raw: string, model: string, usage: any;
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const out = await runAgentInference({
        agent, profile,
        client: { id: client.id, name: client.name },
        instructions: task.instructions || "",
        taskType: task.task_type || "general",
        metadata: task.metadata || {},
        triageContext,
        followups,
      });
      parsed = out.parsed; raw = out.raw; model = out.model; usage = out.usage;
      if (parsed?.needs_input && parsed?.question && task.task_type !== "task_triage") {
        await postChannel({
          channelId, role: "agent", kind: "message", taskId: taskId, fromAgentId: task.agent_id,
          body: `❓ ${parsed.question}`, payload: { turn: turn + 1 },
        });
        const hermesReply = await hermesAutoReply(parsed.question, { name: client.name }, task.instructions || "", profile?.profile_md || null);
        await postChannel({
          channelId, role: "system", kind: "message", taskId: taskId, toAgentId: task.agent_id,
          body: `🪽 Hermes: ${hermesReply}`, payload: { turn: turn + 1 },
        });
        followups.push({ question: parsed.question, hermes_reply: hermesReply });
        continue;
      }
      break;
    }

    const assets = Array.isArray(parsed?.assets) ? parsed.assets : [];
    let triageStats: any = null;
    if (task.task_type === "task_triage") {
      triageStats = await applyTriageWritebacks(parsed, agent?.name || "Triage Agent");
    }
    const nowIso = new Date().toISOString();
    await supa.from("hermes_tasks").update({
      status: "completed",
      result_assets: assets,
      completed_at: nowIso,
      delivered_at: nowIso,
      metadata: { ...(task.metadata || {}), summary: parsed?.summary || null, model, usage, cost_usd: estimateCost(model, usage), duration_ms: Date.now() - startedAt, triage_stats: triageStats },
    }).eq("id", taskId).is("delivered_at", null);

    if (task.conversation_id) {
      const lines: string[] = [];
      if (parsed?.summary) lines.push(parsed.summary);
      if (triageStats) {
        lines.push("", `**Triage applied:** ${triageStats.updated} updates · ${triageStats.reassigned} re-assignments · ${triageStats.commented} comments` + (triageStats.errors.length ? ` · ⚠️ ${triageStats.errors.length} errors` : ""));
      }
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
    await postChannel({
      channelId, role: "agent", kind: "message", taskId: taskId, fromAgentId: task.agent_id,
      body: `✅ ${agent?.name || "Agent"} completed\n\n${(parsed?.summary || "(no summary)").slice(0, 2000)}` + (assets.length ? `\n\n${assets.length} asset(s) attached.` : ""),
      payload: { model, turns: followups.length + 1, cost_usd: estimateCost(model, usage) },
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
    await postChannel({
      channelId, role: "agent", kind: "escalation", taskId: taskId, fromAgentId: task.agent_id,
      body: `❌ Task failed: ${msg.slice(0, 500)}`,
    });
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