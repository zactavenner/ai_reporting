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

/**
 * HARD PRODUCTION BUDGETS.
 * These are enforced server-side against real row counts — the model is NOT
 * trusted to count. Without this an autonomous mission will happily re-call
 * generate_static_ads on every iteration forever (it once produced 716
 * near-identical statics for one client).
 */
export const ONBOARDING_STATIC_BUDGET = 10;
export const ONBOARDING_VIDEO_BUDGET = 4;

/** The 10 distinct static concepts. One slot per creative — never repeat a slot. */
const STATIC_CONCEPTS: { slot: string; ratio: string; direction: string }[] = [
  { slot: "market-thesis", ratio: "1:1", direction: "Bold market-thesis statement card: why this market and why now, one confident sentence, data-led." },
  { slot: "fund-terms", ratio: "4:5", direction: "Clean fund terms card: minimum investment, hold period and targeted returns laid out as a tight spec sheet." },
  { slot: "track-record", ratio: "1:1", direction: "Credibility / track record proof: prior performance and operator history rendered as a trust badge layout." },
  { slot: "distributions", ratio: "9:16", direction: "Distribution schedule angle: cadence of income, calm premium chart-style visual." },
  { slot: "tax-advantage", ratio: "4:5", direction: "Tax advantage angle: the structural benefit stated plainly with a document/ledger visual motif." },
  { slot: "entry-point", ratio: "1:1", direction: "Entry point clarity: what it takes to participate, removing the 'this isn't for me' objection." },
  { slot: "timing", ratio: "9:16", direction: "Timing / scarcity of the window, framed on real market conditions — never hype, never promissory." },
  { slot: "spokesperson", ratio: "4:5", direction: "Spokesperson credibility portrait with a short authority quote overlaid." },
  { slot: "risk-managed", ratio: "1:1", direction: "Risk-managed framing: how downside is controlled, with the required risk disclaimer visible." },
  { slot: "direct-cta", ratio: "9:16", direction: "Direct call-to-action: book the call, accredited-investor callout, minimal and high-contrast." },
];

/** The 4 natural-motion UGC video styles. One slot per video — never repeat a slot. */
const VIDEO_STYLES: { slot: string; label: string; direction: string }[] = [
  { slot: "podcast", label: "Podcast clip", direction: "Podcast-style two-shot: spokesperson mid-conversation on a mic, natural head movement and hand gestures, warm studio lighting, shallow depth of field, looks like a clipped long-form episode." },
  { slot: "street_interview", label: "Street interview", direction: "Street interview: handheld camera, spokesperson answering on a busy city sidewalk, natural ambient movement of people behind, slight camera sway, candid documentary feel." },
  { slot: "walk_and_talk", label: "Walk and talk", direction: "Walk-and-talk: spokesperson walking toward camera through a business district, camera tracking backward, natural gait, hair and clothing moving, continuous motion throughout." },
  { slot: "broll", label: "B-roll narration", direction: "Cinematic b-roll: slow dolly and crane moves over the market/asset, no talking head, motion in every frame, narration-driven." },
];

/** Real remaining budget from the database, per client + kind. */
async function remainingBudget(clientId: string, kind: "static" | "video") {
  if (kind === "static") {
    const { count } = await supa
      .from("creatives")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("source", "onboarding-build");
    const used = Number(count || 0);
    return { used, budget: ONBOARDING_STATIC_BUDGET, remaining: Math.max(0, ONBOARDING_STATIC_BUDGET - used) };
  }
  const { count } = await supa
    .from("creative_video_jobs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .in("status", ["queued", "processing", "pending", "running", "completed", "succeeded"]);
  const used = Number(count || 0);
  return { used, budget: ONBOARDING_VIDEO_BUDGET, remaining: Math.max(0, ONBOARDING_VIDEO_BUDGET - used) };
}

/** Which concept slots have already been produced for this client. */
async function usedStaticSlots(clientId: string): Promise<Set<string>> {
  const { data } = await supa
    .from("creatives")
    .select("title")
    .eq("client_id", clientId)
    .eq("source", "onboarding-build");
  const used = new Set<string>();
  for (const row of data || []) {
    const m = /\[([a-z-]+)\]/.exec(String((row as any).title || ""));
    if (m) used.add(m[1]);
  }
  return used;
}

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
 - save_asset — persist every finished written deliverable to the client library AND the AI Studio canvas. Nothing counts as delivered until it is saved.
 - create_client_avatar / generate_static_ads — build the visual assets and assign them to the client.
 - request_approval / check_approval — human sign-off gates. Creatives go to the agency for review; video scripts must be APPROVED before any avatar video is produced.
 - generate_video / check_video_job — the real video generation pipeline.
 - review_assets — the actual creative + asset libraries. Review them, judge them, and make decisions WITH Jeremy.

OPERATING RULES:
 1. Work in small concrete steps. Every step = a tool call. Never invent data.
 2. Call log_progress after meaningful milestones so the live feed stays useful.
 3. Reviewing assets: pull them with review_assets, form your own verdict, then ask_jeremy for his, then reconcile into a decision and log it.
 4. Video jobs are async: start them, then keep checking with check_video_job on later steps. It is fine for the mission to run for a long time.
 5. HARD GATE: never call generate_video for avatar videos until check_approval reports "approved" for the video-scripts approval item. If it is still pending, log progress and keep working other deliverables or wait for the next slice.
 5b. HARD PRODUCTION BUDGETS — these are enforced by the tools against the database, and calling past them is a failure, not initiative:
     • ${ONBOARDING_STATIC_BUDGET} static creatives per client, TOTAL. Call generate_static_ads ONCE with count ${ONBOARDING_STATIC_BUDGET}. Every creative is auto-assigned its own concept slot, so you never need a second call.
     • ${ONBOARDING_VIDEO_BUDGET} videos per client, TOTAL — 30 seconds each, one per natural-motion style: podcast, street_interview, walk_and_talk, broll.
     • The moment a tool result says the budget is exhausted or done:true, that deliverable is COMPLETE. Move to the next one or finish_mission. NEVER re-run a generator to "improve" or "add more" output.
 5c. Every creative must be materially different from the others — different concept, different visual structure, different claim. Repetitive near-identical output is a failed deliverable.
 6. Compliance: this is regulated capital raising. Never write "guaranteed". Use "targeted returns" and include SEC/FINRA-style risk disclaimers on any offer-facing copy.
 7. When — and only when — the mission is complete, call finish_mission with a full markdown report including counts (assets reviewed, videos generated, copy variants, agents consulted) and the decisions made.
 8. If the mission is impossible, call finish_mission with status "failed" and explain precisely why.`;
}

// ---------------------------------------------------------------- tools
const TOOLS = [
  { type: "function", function: { name: "list_clients", description: "List clients with id, name, status.", parameters: { type: "object", properties: { status: { type: "string" } } } } },
  { type: "function", function: { name: "get_client_metrics", description: "Performance rollup for a client (spend, leads, funded) over N days.", parameters: { type: "object", properties: { client_id: { type: "string" }, days: { type: "number" } }, required: ["client_id"] } } },
  { type: "function", function: { name: "list_client_agents", description: "List specialist agents under a client (handle, name, type, model).", parameters: { type: "object", properties: { client_id: { type: "string" } }, required: ["client_id"] } } },
  { type: "function", function: { name: "ask_client_agent", description: "Delegate work to a specialist agent under a client (copywriting, video, media buying). Optional self-critique loops 1-3.", parameters: { type: "object", properties: { client_id: { type: "string" }, agent_handle: { type: "string" }, question: { type: "string" }, loops: { type: "number" } }, required: ["client_id", "agent_handle", "question"] } } },
  { type: "function", function: { name: "ask_jeremy", description: "Consult Jeremy AI (external Persona MCP) for strategy / asset judgement. Keeps a persistent conversation.", parameters: { type: "object", properties: { question: { type: "string" }, client_id: { type: "string" } }, required: ["question"] } } },
  { type: "function", function: { name: "review_assets", description: "Pull recent creatives, generated assets and video jobs for review.", parameters: { type: "object", properties: { client_id: { type: "string" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "save_asset", description: "Persist a finished written deliverable (offer summary, angles, ad copy, emails, reminders, VSL, video scripts, FAQ scripts) to the client asset library AND onto the AI Studio canvas so the team sees it.", parameters: { type: "object", properties: { client_id: { type: "string" }, asset_type: { type: "string", description: "offer_summary | angles | ad_copy | nurture_emails | appointment_reminders | vsl | video_scripts | faq_scripts | static_ad_brief" }, title: { type: "string" }, content_md: { type: "string" }, notes: { type: "string" } }, required: ["asset_type", "title", "content_md"] } } },
  { type: "function", function: { name: "create_client_avatar", description: "Create and assign an AI avatar to the client. Defaults to an attractive professional female around 30. Returns avatar_id + image_url for avatar video generation.", parameters: { type: "object", properties: { client_id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, gender: { type: "string" }, age_range: { type: "string" }, style: { type: "string" } } } } },
  { type: "function", function: { name: "generate_static_ads", description: `Generate static ad creatives for the client and put them on the canvas + creatives library. HARD CAP: ${ONBOARDING_STATIC_BUDGET} statics per client, total, for the whole onboarding. Each creative is auto-assigned a distinct concept slot and aspect ratio, so call this ONCE with count ${ONBOARDING_STATIC_BUDGET}. If the tool reports the budget is exhausted, the statics are finished — never call it again.`, parameters: { type: "object", properties: { client_id: { type: "string" }, count: { type: "number", description: `How many to make now. Capped at the remaining budget (max ${ONBOARDING_STATIC_BUDGET} lifetime).` }, offer_description: { type: "string" }, prompt: { type: "string", description: "Creative direction shared by all statics. The per-concept direction is added automatically." } } } } },
  { type: "function", function: { name: "request_approval", description: "Send a deliverable to the agency approval queue for a human decision (creative review, video-script sign-off).", parameters: { type: "object", properties: { client_id: { type: "string" }, queue_type: { type: "string", description: "creative_review | video_scripts | onboarding_assets" }, title: { type: "string" }, summary: { type: "string" }, payload: { type: "object" }, priority: { type: "number" } }, required: ["queue_type", "title"] } } },
  { type: "function", function: { name: "check_approval", description: "Check the status of an approval queue item created with request_approval. Returns pending | approved | rejected.", parameters: { type: "object", properties: { approval_id: { type: "string" } }, required: ["approval_id"] } } },
  { type: "function", function: { name: "generate_video", description: `Start a real 30-second natural-motion video ad. HARD CAP: ${ONBOARDING_VIDEO_BUDGET} videos per client for the whole onboarding, one per style (podcast, street_interview, walk_and_talk, broll). Returns job_id to poll with check_video_job. If the tool reports the budget is exhausted, the videos are finished — never call it again.`, parameters: { type: "object", properties: { client_id: { type: "string" }, creative_id: { type: "string" }, image_url: { type: "string" }, prompt: { type: "string", description: "The approved script/hook for this video. Motion + style direction is added automatically." }, style: { type: "string", description: "podcast | street_interview | walk_and_talk | broll" }, duration: { type: "number", description: "Seconds. Defaults to 30." }, aspect_ratio: { type: "string" }, resolution: { type: "string" }, model: { type: "string" } }, required: ["image_url", "prompt"] } } },
  { type: "function", function: { name: "check_video_job", description: "Poll a video generation job started with generate_video.", parameters: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } } },
  { type: "function", function: { name: "record_decision", description: "Record a decision Jarvis (with Jeremy) made about an asset or strategy. Shows on the mission feed and in the final report.", parameters: { type: "object", properties: { subject: { type: "string" }, decision: { type: "string" }, rationale: { type: "string" }, jeremy_verdict: { type: "string" } }, required: ["subject", "decision"] } } },
  { type: "function", function: { name: "log_progress", description: "Post a progress note to the live mission feed.", parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] } } },
  { type: "function", function: { name: "notify_team", description: "Send an SMS from the agency number (e.g. Zac +19167097345).", parameters: { type: "object", properties: { phone: { type: "string" }, message: { type: "string" } }, required: ["phone", "message"] } } },
  { type: "function", function: { name: "finish_mission", description: "End the mission. Provide the full markdown report and counts.", parameters: { type: "object", properties: { status: { type: "string", description: "completed | failed" }, report_md: { type: "string" }, counts: { type: "object" } }, required: ["report_md"] } } },
];

async function orChat(body: Record<string, unknown>) {
  let lastErr = "";
  const pref = (body as any).model || (await preferredModel());
  // UI/settings values may carry a legacy "openrouter/" prefix. OpenRouter
  // rejects that as an invalid model ID, so strip it before sending.
  const norm = (m: string) => m.trim().replace(/^openrouter\//, "");
  const chain = [...new Set([...(pref ? [norm(pref as string)] : []), ...MODEL_CHAIN.map(norm)])];
  for (const model of chain) {
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

/** Honour the agency-wide Jarvis model preference (same setting the chat UI uses). */
let _preferred: string | null | undefined;
async function preferredModel() {
  if (_preferred !== undefined) return _preferred;
  const { data } = await supa.from("agency_settings").select("jarvis_model").limit(1).maybeSingle();
  _preferred = (data as any)?.jarvis_model || null;
  return _preferred;
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

/**
 * Put a deliverable on the AI Studio canvas for the user who launched the mission,
 * so everything the agents build shows up in one place for the team.
 */
async function pushToCanvas(goal: any, clientId: string, payload: any, kind = "text_artifact") {
  try {
    const userId = goal.created_by;
    if (!userId) return { ok: false, error: "mission has no owner user; canvas skipped" };
    let convoId: string | null = null;
    const { data: existing } = await supa
      .from("ai_studio_conversations")
      .select("id")
      .eq("user_id", userId)
      .eq("client_id", clientId)
      .maybeSingle();
    convoId = (existing as any)?.id || null;
    if (!convoId) {
      const { data: created, error } = await supa
        .from("ai_studio_conversations")
        .insert({ user_id: userId, client_id: clientId, title: "Onboarding build" })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      convoId = created.id;
    }
    const { error: ciErr } = await supa.from("ai_studio_canvas_items").insert({
      conversation_id: convoId,
      user_id: userId,
      kind,
      payload: payload as any,
    });
    if (ciErr) return { ok: false, error: ciErr.message };
    return { ok: true, conversation_id: convoId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function _askJeremyLegacy(question: string, clientId: string | null) {
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
      case "save_asset": {
        const cid = args.client_id || goal.client_id;
        if (!cid) return { error: "client_id required" };
        const content = String(args.content_md || "");
        const ins = await supa.from("client_assets").insert({
          client_id: cid,
          asset_type: String(args.asset_type),
          title: String(args.title).slice(0, 200),
          status: "draft",
          content: { markdown: content, source: "onboarding_build", goal_id: goal.id, notes: args.notes || null } as any,
        }).select("id").single();
        const canvas = await pushToCanvas(goal, cid, {
          artifact_type: args.asset_type,
          title: args.title,
          content,
          chars: content.length,
          notes: args.notes || null,
        });
        return { ok: true, asset_id: ins.data?.id || null, on_canvas: canvas.ok, canvas_error: canvas.error };
      }
      case "create_client_avatar": {
        const cid = args.client_id || goal.client_id;
        if (!cid) return { error: "client_id required" };
        const { data: client } = await supa.from("clients").select("name").eq("id", cid).maybeSingle();
        const gender = args.gender || "female";
        const ageRange = args.age_range || "26-35";
        const description = args.description ||
          `Attractive, polished professional woman around 30, warm and trustworthy on camera, presenting ${client?.name || "the fund"}'s investment opportunity. Modern office, natural lighting.`;
        const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({
            gender, ageRange, ethnicity: "mixed", style: args.style || "ugc",
            background: "office",
            backgroundPrompt: "Modern bright office with soft daylight, tasteful depth of field",
            aspectRatio: "3:4", realism_level: "high", look_type: "professional",
            avatar_description: description,
          }),
        });
        const jr = await r.json().catch(() => ({}));
        if (!r.ok || !jr?.imageUrl) return { error: jr?.error || `generate-avatar ${r.status}` };
        const ins = await supa.from("avatars").insert({
          name: args.name || `${client?.name || "Client"} Spokesperson`,
          client_id: cid,
          image_url: jr.imageUrl,
          base_image_url: jr.imageUrl,
          is_active: true,
          style: args.style || "ugc",
          gender, age_range: ageRange,
          description,
        }).select("id").single();
        await pushToCanvas(goal, cid, { image_url: jr.imageUrl, prompt: description, aspect_ratio: "3:4", title: "Client avatar" }, "image");
        return { ok: true, avatar_id: ins.data?.id || null, image_url: jr.imageUrl };
      }
      case "generate_static_ads": {
        const cid = args.client_id || goal.client_id;
        if (!cid) return { error: "client_id required" };
        // HARD CAP against real rows. The model does not get to decide this.
        const budget = await remainingBudget(cid, "static");
        if (budget.remaining <= 0) {
          return {
            done: true,
            generated: 0,
            used: budget.used,
            budget: budget.budget,
            note: `STATIC BUDGET EXHAUSTED (${budget.used}/${budget.budget}). The static ads for this client are COMPLETE. Do NOT call generate_static_ads again — move on to the next deliverable or finish the mission.`,
          };
        }
        const asked = Math.max(1, Math.min(ONBOARDING_STATIC_BUDGET, Number(args.count) || budget.remaining));
        const count = Math.min(asked, budget.remaining);
        // One distinct concept slot per creative, so no two statics look alike.
        const taken = await usedStaticSlots(cid);
        const queue = STATIC_CONCEPTS.filter((c) => !taken.has(c.slot)).slice(0, count);
        if (!queue.length) {
          return { done: true, generated: 0, note: "All 10 static concepts already produced. Do not call this tool again." };
        }
        const { data: styles } = await supa
          .from("ad_styles")
          .select("*")
          .or("name.ilike.%capital%,name.ilike.%winning%")
          .order("name")
          .limit(1);
        const style = styles?.[0];
        if (!style) {
          return { error: "No ad style found (expected 'Capital Creative'). Refusing to generate style-less duplicate statics." };
        }
        const { data: client } = await supa.from("clients").select("name, brand_colors, brand_fonts").eq("id", cid).maybeSingle();
        const made: any[] = []; const errors: string[] = [];
        for (const concept of queue) {
          const ratio = concept.ratio;
          const conceptPrompt = [
            args.prompt || "",
            `CONCEPT (${concept.slot}): ${concept.direction}`,
            "This creative must be visually and structurally DISTINCT from the client's other statics.",
          ].filter(Boolean).join("\n\n");
          const r = await fetch(`${SUPABASE_URL}/functions/v1/generate-static-ad`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
            body: JSON.stringify({
              prompt: conceptPrompt,
              stylePrompt: style?.prompt_template || "",
              styleName: style?.name || "Capital Raising",
              aspectRatio: ratio,
              productDescription: args.offer_description || "",
              offerDescription: args.offer_description || "",
              brandColors: (client as any)?.brand_colors || [],
              brandFonts: (client as any)?.brand_fonts || [],
              projectId: `onboarding-${cid}`,
              clientId: cid,
              referenceImages: style?.reference_images || [],
              primaryReferenceImage: style?.reference_images?.[0] || null,
            }),
          });
          const jr = await r.json().catch(() => ({}));
          if (r.ok && jr?.imageUrl) {
            const cr = await supa.from("creatives").insert({
              client_id: cid,
              title: `${client?.name || "Onboarding"} — [${concept.slot}] ${ratio}`,
              type: "image", file_url: jr.imageUrl, status: "draft",
              source: "onboarding-build", aspect_ratio: ratio,
            }).select("id").single();
            await pushToCanvas(goal, cid, { image_url: jr.imageUrl, aspect_ratio: ratio, concept: concept.slot, prompt: conceptPrompt }, "image");
            made.push({ creative_id: cr.data?.id, concept: concept.slot, aspect_ratio: ratio, image_url: jr.imageUrl });
          } else {
            errors.push(`${concept.slot}: ${jr?.error || `generate-static-ad ${r.status}`}`);
          }
        }
        const after = await remainingBudget(cid, "static");
        return {
          generated: made.length,
          creatives: made,
          errors,
          used: after.used,
          budget: after.budget,
          remaining: after.remaining,
          note: after.remaining <= 0
            ? `Static budget now exhausted (${after.used}/${after.budget}). Statics are COMPLETE — do not call generate_static_ads again.`
            : `${after.remaining} static(s) of the 10-creative budget remain.`,
        };
      }
      case "request_approval": {
        const cid = args.client_id || goal.client_id;
        const ins = await supa.from("approval_queue").insert({
          client_id: cid || null,
          queue_type: String(args.queue_type),
          title: String(args.title).slice(0, 200),
          summary: args.summary || null,
          priority: Math.max(1, Math.min(5, Number(args.priority) || 2)),
          status: "pending",
          preview_payload: { ...(args.payload || {}), goal_id: goal.id } as any,
          agent_reasoning: "Created by Jarvis during the onboarding asset build.",
        }).select("id").single();
        if (ins.error) return { error: ins.error.message };
        await emit(goal.id, "progress", `Sent for approval: ${args.title}`, args.summary || null, { approval_id: ins.data?.id });
        return { ok: true, approval_id: ins.data?.id, note: "Poll with check_approval. Do NOT produce avatar videos until video-script approval is 'approved'." };
      }
      case "check_approval": {
        const { data, error } = await supa
          .from("approval_queue")
          .select("id, status, rejection_reason, title, resolved_at")
          .eq("id", args.approval_id)
          .maybeSingle();
        if (error) return { error: error.message };
        if (!data) return { error: "approval not found" };
        return data;
      }
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
        const vcid = args.client_id || goal.client_id || null;
        // HARD CAP: onboarding produces at most 4 videos. Enforced on real job rows.
        if (vcid) {
          const vb = await remainingBudget(vcid, "video");
          if (vb.remaining <= 0) {
            return {
              done: true,
              used: vb.used,
              budget: vb.budget,
              note: `VIDEO BUDGET EXHAUSTED (${vb.used}/${vb.budget}). The videos for this client are COMPLETE. Do NOT call generate_video again — finish the mission.`,
            };
          }
        }
        // Natural-motion style is mandatory: pick the requested slot, else the
        // next unused one, so the 4 videos are podcast / street / walk / b-roll.
        const wanted = String(args.style || "").toLowerCase().replace(/[^a-z]/g, "_");
        const usedJobs = vcid
          ? (await supa.from("creative_video_jobs").select("prompt").eq("client_id", vcid)).data || []
          : [];
        const takenSlots = new Set(
          usedJobs.map((r: any) => /\[style:([a-z_]+)\]/.exec(String(r.prompt || ""))?.[1]).filter(Boolean) as string[],
        );
        const style =
          VIDEO_STYLES.find((s) => s.slot === wanted) ||
          VIDEO_STYLES.find((s) => !takenSlots.has(s.slot)) ||
          VIDEO_STYLES[0];
        const motionPrompt = [
          `[style:${style.slot}]`,
          `${style.label}: ${style.direction}`,
          String(args.prompt || ""),
          "Continuous natural motion throughout — the subject and camera must never be static. Realistic, documentary-grade, not stiff or AI-looking.",
        ].filter(Boolean).join("\n\n");
        const r = await fetch(`${SUPABASE_URL}/functions/v1/animate-creative`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({
            action: "start",
            creativeId: args.creative_id || null,
            clientId: vcid,
            imageUrl: args.image_url,
            prompt: motionPrompt,
            // Onboarding videos are 30s ads, assembled from the provider's max clip length.
            duration: Math.max(1, Math.min(30, Number(args.duration) || 30)),
            aspectRatio: args.aspect_ratio || "9:16",
            // MiniMax H3 supports 720p and native 2K only.
            resolution: String(args.resolution || "").toLowerCase() === "720p" ? "720p" : "2k",
            ...(args.model ? { model: args.model } : {}),
          }),
        });
        const jr = await r.json().catch(() => ({}));
        if (!r.ok) return { error: jr?.error || `animate-creative ${r.status}` };
        const vbAfter = vcid ? await remainingBudget(vcid, "video") : null;
        return {
          job_id: jr.jobId,
          model: jr.model,
          style: style.slot,
          remaining: vbAfter?.remaining ?? null,
          note: `Style ${style.slot} started. Poll with check_video_job on a later step.${vbAfter && vbAfter.remaining <= 0 ? " Video budget is now exhausted — do not start more." : ""}`,
        };
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