// JARVIS MISSION ENGINE
// Give Jarvis a goal; he works it to completion on the backend — surviving page
// reloads, logouts and multi-hour runtimes. Each invocation advances the mission
// within a time budget, persists the full message state, streams events into
// jarvis_goal_events (realtime feed) and re-arms itself. A pg_cron sweep is the
// safety net so nothing ever stalls.
//
// Jarvis can talk to: client specialist agents (copywriting / video / media
// buying), Jeremy AI (Utari Persona MCP), the video generation pipeline
// (animate-creative), and the asset libraries for review + decisions.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") || "").trim().replace(/^['"]|['"]$/g, "");

const MODEL_CHAIN = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemini-2.0-flash-001",
  "openai/gpt-4o-mini",
];

/** Wall-clock budget per invocation. Under the edge function limit, then we re-arm. */
const SLICE_MS = 45_000;

const supa = createClient(SUPABASE_URL, SERVICE);

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

function orKey() {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
  return OPENROUTER_KEY;
}

// ---------------------------------------------------------------- events feed
async function emit(goalId: string, kind: string, title: string, content?: string, data?: unknown) {
  await supa.from("jarvis_goal_events").insert({
    goal_id: goalId,
    kind,
    title: title.slice(0, 300),
    content: content ? String(content).slice(0, 20000) : null,
    data: (data ?? null) as any,
  });
}

// ---------------------------------------------------------------- system prompt
function systemPrompt(goal: any, clientName: string | null) {
  return `You are JARVIS — autonomous Chief of Staff for High Performance Ads, running a LONG-RUNNING MISSION on the backend. The user is NOT watching; you keep working until the mission is genuinely done.

MISSION: ${goal.goal}
${clientName ? `CLIENT IN SCOPE: ${clientName} (client_id ${goal.client_id})` : "SCOPE: agency-wide"}

YOUR WORKFORCE (call them with tools, do not do their jobs yourself):
 - ask_client_agent — copywriting, video, media buying and any other specialist agent under a client.
 - ask_jeremy — Jeremy AI (external Persona MCP). Jeremy is your strategic second opinion. You MUST consult Jeremy before finalising creative/asset decisions, and record his verdict.
 - generate_video / check_video_job — the real video generation pipeline.
 - review_assets — the actual creative + asset libraries. Review them, judge them, and make decisions WITH Jeremy.

OPERATING RULES:
 1. Work in small concrete steps. Every step = a tool call. Never invent data.
 2. Call log_progress after meaningful milestones so the live feed stays useful.
 3. Reviewing assets: pull them with review_assets, form your own verdict, then ask_jeremy for his, then reconcile into a decision and log it.
 4. Video jobs are async: start them, then keep checking with check_video_job on later steps. It is fine for the mission to run for a long time.
 5. When — and only when — the mission is complete, call finish_mission with a full markdown report including counts (assets reviewed, videos generated, copy variants, agents consulted) and the decisions made.
 6. If the mission is impossible, call finish_mission with status "failed" and explain precisely why.`;
}

// ---------------------------------------------------------------- tools
const TOOLS = [
  { type: "function", function: { name: "list_clients", description: "List clients with id, name, status.", parameters: { type: "object", properties: { status: { type: "string" } } } } },
  { type: "function", function: { name: "get_client_metrics", description: "Performance rollup for a client (spend, leads, funded) over N days.", parameters: { type: "object", properties: { client_id: { type: "string" }, days: { type: "number" } }, required: ["client_id"] } } },
  { type: "function", function: { name: "list_client_agents", description: "List specialist agents under a client (handle, name, type, model).", parameters: { type: "object", properties: { client_id: { type: "string" } }, required: ["client_id"] } } },
  { type: "function", function: { name: "ask_client_agent", description: "Delegate work to a specialist agent under a client (copywriting, video, media buying). Optional self-critique loops 1-3.", parameters: { type: "object", properties: { client_id: { type: "string" }, agent_handle: { type: "string" }, question: { type: "string" }, loops: { type: "number" } }, required: ["client_id", "agent_handle", "question"] } } },
  { type: "function", function: { name: "ask_jeremy", description: "Consult Jeremy AI (external Persona MCP) for strategy / asset judgement. Keeps a persistent conversation.", parameters: { type: "object", properties: { question: { type: "string" }, client_id: { type: "string" } }, required: ["question"] } } },
  { type: "function", function: { name: "review_assets", description: "Pull recent creatives, generated assets and video jobs for review.", parameters: { type: "object", properties: { client_id: { type: "string" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "generate_video", description: "Start a real video generation job from an image + prompt. Returns job_id to poll with check_video_job.", parameters: { type: "object", properties: { client_id: { type: "string" }, creative_id: { type: "string" }, image_url: { type: "string" }, prompt: { type: "string" }, duration: { type: "number" }, aspect_ratio: { type: "string" }, resolution: { type: "string" }, model: { type: "string" } }, required: ["image_url", "prompt"] } } },
  { type: "function", function: { name: "check_video_job", description: "Poll a video generation job started with generate_video.", parameters: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } } },
  { type: "function", function: { name: "record_decision", description: "Record a decision Jarvis (with Jeremy) made about an asset or strategy. Shows on the mission feed and in the final report.", parameters: { type: "object", properties: { subject: { type: "string" }, decision: { type: "string" }, rationale: { type: "string" }, jeremy_verdict: { type: "string" } }, required: ["subject", "decision"] } } },
  { type: "function", function: { name: "log_progress", description: "Post a progress note to the live mission feed.", parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] } } },
  { type: "function", function: { name: "notify_team", description: "Send an SMS from the agency number (e.g. Zac +19167097345).", parameters: { type: "object", properties: { phone: { type: "string" }, message: { type: "string" } }, required: ["phone", "message"] } } },
  { type: "function", function: { name: "finish_mission", description: "End the mission. Provide the full markdown report and counts.", parameters: { type: "object", properties: { status: { type: "string", description: "completed | failed" }, report_md: { type: "string" }, counts: { type: "object" } }, required: ["report_md"] } } },
];

async function orChat(body: Record<string, unknown>) {
  let lastErr = "";
  for (const model of MODEL_CHAIN) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://reporting.highperformanceads.com",
        "X-Title": "HPA Jarvis Missions",
      },
      body: JSON.stringify({ ...body, model }),
    });
    if (res.ok) return await res.json();
    lastErr = `${model} -> ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
    console.warn("[mission]", lastErr);
  }
  throw new Error(`All models failed: ${lastErr}`);
}

async function askJeremy(question: string, clientId: string | null) {
  const { data: agents } = await supa
    .from("agency_agents")
    .select("id, name, capabilities")
    .limit(200);
  const jeremy = (agents || []).find((a: any) => (a.capabilities || {})?.provider === "utari_persona" && (a.capabilities || {})?.mcp_url);
  if (!jeremy) return { error: "Jeremy AI (utari_persona) agent is not configured." };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/test-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ agent_id: jeremy.id, client_id: clientId || null, messages: [{ role: "user", content: question }] }),
  });
  const jr = await r.json().catch(() => ({}));
  if (!r.ok) return { error: jr?.error || `test-agent ${r.status}` };
  return { agent: jeremy.name, reply: jr.reply };
}

async function execTool(name: string, args: any, goal: any): Promise<any> {
  try {
    switch (name) {
      case "list_clients": {
        let q = supa.from("clients").select("id,name,status,industry").order("name").limit(200);
        if (args?.status) q = q.eq("status", args.status);
        const { data, error } = await q;
        if (error) throw error;
        return { count: data?.length || 0, clients: data };
      }
      case "get_client_metrics": {
        const days = Math.max(1, Math.min(180, Number(args.days) || 30));
        const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
        const { data } = await supa
          .from("daily_metrics")
          .select("date, ad_spend, leads, calls_showed, funded_investors")
          .eq("client_id", args.client_id)
          .gte("date", since);
        const roll = (data || []).reduce(
          (a: any, r: any) => ({
            spend: a.spend + Number(r.ad_spend || 0),
            leads: a.leads + Number(r.leads || 0),
            showed: a.showed + Number(r.calls_showed || 0),
            funded: a.funded + Number(r.funded_investors || 0),
          }),
          { spend: 0, leads: 0, showed: 0, funded: 0 },
        );
        return { days, ...roll, cpl: roll.leads ? +(roll.spend / roll.leads).toFixed(2) : null };
      }
      case "list_client_agents": {
        const { data, error } = await supa
          .from("client_agents")
          .select("id,handle,name,agent_type,model,enabled")
          .eq("client_id", args.client_id)
          .order("created_at");
        if (error) throw error;
        return { count: data?.length || 0, agents: data };
      }
      case "ask_client_agent": {
        const handle = String(args.agent_handle || "");
        const loops = Math.max(1, Math.min(3, Number(args.loops) || 1));
        const { data: agents } = await supa.from("client_agents").select("*").eq("client_id", args.client_id);
        const agent = (agents || []).find((a: any) =>
          a.handle === handle || a.name === handle ||
          a.handle?.toLowerCase().includes(handle.toLowerCase()) ||
          a.name?.toLowerCase().includes(handle.toLowerCase()));
        if (!agent) return { error: `agent '${handle}' not found for client` };
        const { data: client } = await supa.from("clients").select("name,industry").eq("id", args.client_id).maybeSingle();
        const history: any[] = [
          { role: "system", content: `You are ${agent.name} (${agent.agent_type}) for client ${client?.name || args.client_id}.\n\nINSTRUCTIONS:\n${agent.system_prompt || "(none)"}\n\nKNOWLEDGE:\n${(agent.knowledge_md || "").slice(0, 8000)}` },
          { role: "user", content: args.question },
        ];
        let answer = "";
        for (let i = 0; i < loops; i++) {
          const jr = await orChat({ messages: history, temperature: 0.4, ...(agent.model ? { model: agent.model } : {}) } as any);
          answer = jr.choices?.[0]?.message?.content || "(no reply)";
          history.push({ role: "assistant", content: answer });
          if (i < loops - 1) history.push({ role: "user", content: "Critique your answer harshly, then rewrite it stronger and more specific. Return ONLY the improved final answer." });
        }
        return { agent: agent.name, handle: agent.handle, loops, answer };
      }
      case "ask_jeremy":
        return await askJeremy(String(args.question || ""), args.client_id || goal.client_id || null);
      case "review_assets": {
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
        const cid = args.client_id || goal.client_id;
        const creatives = supa.from("creatives").select("id, client_id, title, type, status, platform, aspect_ratio, headline, body_copy, cta_text, file_url, ai_performance_score, created_at").order("created_at", { ascending: false }).limit(limit);
        const assets = supa.from("client_assets").select("id, client_id, asset_type, title, status, created_at").order("created_at", { ascending: false }).limit(limit);
        const jobs = supa.from("creative_video_jobs").select("id, client_id, creative_id, status, model, output_url, created_at").order("created_at", { ascending: false }).limit(limit);
        const [c, a, v] = await Promise.all([
          cid ? creatives.eq("client_id", cid) : creatives,
          cid ? assets.eq("client_id", cid) : assets,
          cid ? jobs.eq("client_id", cid) : jobs,
        ]);
        return { creatives: c.data || [], assets: a.data || [], video_jobs: v.data || [] };
      }
      case "generate_video": {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/animate-creative`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({
            action: "start",
            creativeId: args.creative_id || null,
            clientId: args.client_id || goal.client_id || null,
            imageUrl: args.image_url,
            prompt: args.prompt,
            duration: Math.max(1, Math.min(15, Number(args.duration) || 8)),
            aspectRatio: args.aspect_ratio || "9:16",
            resolution: args.resolution || "720p",
            ...(args.model ? { model: args.model } : {}),
          }),
        });
        const jr = await r.json().catch(() => ({}));
        if (!r.ok) return { error: jr?.error || `animate-creative ${r.status}` };
        return { job_id: jr.jobId, model: jr.model, note: "Poll with check_video_job on a later step." };
      }
      case "check_video_job": {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/animate-creative`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({ action: "status", jobId: args.job_id }),
        });
        const jr = await r.json().catch(() => ({}));
        if (!r.ok) return { error: jr?.error || `animate-creative ${r.status}` };
        const job = jr.job || {};
        return { job_id: job.id, status: job.status, output_url: job.output_url, progress: job.progress_label, error: job.error_message };
      }
      case "record_decision": {
        await emit(goal.id, "decision", args.subject, args.decision, {
          rationale: args.rationale || null,
          jeremy_verdict: args.jeremy_verdict || null,
        });
        return { ok: true };
      }
      case "log_progress": {
        await emit(goal.id, "progress", String(args.note || "").slice(0, 200), args.note);
        return { ok: true };
      }
      case "notify_team": {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/send-ghl-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({ password: "HPA1234$", channel: "sms", to_phone: args.phone, text: args.message }),
        });
        const jr = await r.json().catch(() => ({}));
        if (!r.ok) return { error: jr?.error || `send-ghl-message ${r.status}` };
        return { ok: true, to: args.phone };
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- mission slice
async function advance(goalId: string) {
  const started = Date.now();
  const { data: goal } = await supa.from("jarvis_goals").select("*").eq("id", goalId).maybeSingle();
  if (!goal) return { ok: false, error: "goal not found" };
  if (["completed", "failed", "cancelled", "paused"].includes(goal.status)) {
    return { ok: true, status: goal.status, done: true };
  }

  let clientName: string | null = null;
  if (goal.client_id) {
    const { data } = await supa.from("clients").select("name").eq("id", goal.client_id).maybeSingle();
    clientName = (data as any)?.name || null;
  }

  const state: any = goal.state || {};
  let messages: any[] = Array.isArray(state.messages) && state.messages.length
    ? state.messages
    : [
        { role: "system", content: systemPrompt(goal, clientName) },
        { role: "user", content: `Begin the mission. Plan briefly, then start executing with tools.` },
      ];

  if (goal.status === "queued") {
    await supa.from("jarvis_goals").update({ status: "running", started_at: new Date().toISOString() }).eq("id", goalId);
    await emit(goalId, "status", "Mission started", goal.goal);
  }

  let iteration = Number(goal.iteration || 0);
  const maxIter = Number(goal.max_iterations || 200);
  const counts: any = { tool_calls: 0, ...(goal.counts || {}) };

  while (Date.now() - started < SLICE_MS) {
    if (iteration >= maxIter) {
      await supa.from("jarvis_goals").update({
        status: "failed",
        error: `Hit max iterations (${maxIter}) without finishing.`,
        completed_at: new Date().toISOString(),
        state: { messages },
        iteration,
      }).eq("id", goalId);
      await emit(goalId, "status", "Mission stopped", `Hit max iterations (${maxIter}).`);
      return { ok: true, done: true, status: "failed" };
    }

    // cancellation check between steps
    const { data: fresh } = await supa.from("jarvis_goals").select("status").eq("id", goalId).maybeSingle();
    if (fresh && ["cancelled", "paused"].includes(fresh.status)) {
      await supa.from("jarvis_goals").update({ state: { messages }, iteration }).eq("id", goalId);
      await emit(goalId, "status", `Mission ${fresh.status}`, null);
      return { ok: true, done: true, status: fresh.status };
    }

    iteration++;
    let reply: any;
    try {
      reply = await orChat({ messages, tools: TOOLS, temperature: 0.4 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await emit(goalId, "error", "Model call failed — retrying next sweep", msg);
      await supa.from("jarvis_goals").update({
        state: { messages }, iteration, error: msg,
        last_heartbeat_at: new Date().toISOString(),
      }).eq("id", goalId);
      return { ok: false, error: msg, retry: true };
    }

    const msg = reply.choices?.[0]?.message;
    if (!msg) break;
    messages.push(msg);

    if (msg.content) await emit(goalId, "thought", "Jarvis", msg.content);

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      // No tools, no finish — nudge Jarvis to act or finish.
      messages.push({ role: "user", content: "Continue the mission with a concrete tool call, or call finish_mission if it is genuinely complete." });
      continue;
    }

    for (const tc of calls) {
      const name = tc.function?.name || "";
      let args: any = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* noop */ }

      if (name === "finish_mission") {
        const status = args.status === "failed" ? "failed" : "completed";
        const finalCounts = { ...counts, ...(args.counts || {}) };
        await supa.from("jarvis_goals").update({
          status,
          report_md: args.report_md || null,
          counts: finalCounts,
          iteration,
          state: { messages },
          completed_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
        }).eq("id", goalId);
        await emit(goalId, "status", status === "completed" ? "Mission complete" : "Mission failed", args.report_md || null, finalCounts);
        return { ok: true, done: true, status };
      }

      await emit(goalId, "tool_call", name, JSON.stringify(args).slice(0, 4000), { tool: name });
      const result = await execTool(name, args, goal);
      counts.tool_calls = (counts.tool_calls || 0) + 1;
      counts[name] = (counts[name] || 0) + 1;
      await emit(goalId, "tool_result", name, JSON.stringify(result).slice(0, 8000), { tool: name, error: !!result?.error });
      messages.push({ role: "tool", tool_call_id: tc.id, name, content: JSON.stringify(result).slice(0, 20000) });
    }

    // keep the transcript bounded: system + first user + tail
    if (messages.length > 80) messages = [messages[0], messages[1], ...messages.slice(-60)];

    await supa.from("jarvis_goals").update({
      state: { messages }, iteration, counts,
      last_heartbeat_at: new Date().toISOString(),
    }).eq("id", goalId);
  }

  // Slice exhausted — persist and re-arm so work continues without the user.
  await supa.from("jarvis_goals").update({
    state: { messages }, iteration, counts, status: "running",
    last_heartbeat_at: new Date().toISOString(),
  }).eq("id", goalId);
  rearm(goalId);
  return { ok: true, done: false, iteration };
}

/** Fire-and-forget self call so the mission keeps running server-side. */
function rearm(goalId: string) {
  const p = fetch(`${SUPABASE_URL}/functions/v1/jarvis-goal-worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ action: "tick", goal_id: goalId }),
  }).catch((e) => console.warn("rearm failed", e));
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* noop */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "tick";

    if (action === "create") {
      const goalText = String(body.goal || "").trim();
      if (!goalText) return j({ error: "goal required" }, 400);
      const { data, error } = await supa.from("jarvis_goals").insert({
        title: (body.title || goalText).slice(0, 200),
        goal: goalText,
        client_id: body.client_id || null,
        created_by: body.created_by || null,
        max_iterations: Math.max(5, Math.min(500, Number(body.max_iterations) || 200)),
        status: "queued",
      }).select("id").single();
      if (error) throw error;
      await emit(data.id, "status", "Mission queued", goalText);
      rearm(data.id);
      return j({ ok: true, goal_id: data.id });
    }

    if (action === "cancel") {
      await supa.from("jarvis_goals").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", body.goal_id);
      await emit(body.goal_id, "status", "Mission cancelled by user", null);
      return j({ ok: true });
    }

    if (action === "resume") {
      await supa.from("jarvis_goals").update({ status: "running", error: null }).eq("id", body.goal_id);
      await emit(body.goal_id, "status", "Mission resumed", null);
      rearm(body.goal_id);
      return j({ ok: true });
    }

    if (action === "sweep") {
      // Safety net: revive anything running/queued that has gone quiet.
      const stale = new Date(Date.now() - 90_000).toISOString();
      const { data } = await supa
        .from("jarvis_goals")
        .select("id, status, last_heartbeat_at")
        .in("status", ["queued", "running"])
        .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${stale}`)
        .limit(10);
      const ids = (data || []).map((r: any) => r.id);
      for (const id of ids) rearm(id);
      return j({ ok: true, revived: ids.length, ids });
    }

    if (action === "tick") {
      if (!body.goal_id) return j({ error: "goal_id required" }, 400);
      const out = await advance(body.goal_id);
      return j(out);
    }

    return j({ error: `unknown action ${action}` }, 400);
  } catch (e) {
    console.error("jarvis-goal-worker", e);
    return j({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});