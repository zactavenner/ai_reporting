// Runs one agency agent's scheduled task end-to-end.
// Memory (agency_agents.memory_md + instructions_md + client overrides) and
// connector results (agent_connectors) are injected as context, then the task
// prompt goes to the agent's OpenRouter model. Output is written back to
// Supabase. No external orchestrator.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { routeTaskType } from "../_shared/agentRouting.ts";
import { McpClient, toOpenAiTools, type McpTool } from "../_shared/mcpClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function runConnectors(agentId: string, clientId: string | null) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/agent-connector-run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify({ agent_id: agentId, client_id: clientId }),
  });
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  return Array.isArray(data?.results) ? data.results : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const clientId: string | null = body.client_id ?? null;
    const slug: string | undefined = body.agent_slug || (body.task_type ? routeTaskType(body.task_type) : undefined);

    let q = sb.from("agency_agents").select("*").is("archived_at", null).limit(1);
    q = body.agent_id ? q.eq("id", body.agent_id) : q.eq("slug", slug || "account_manager");
    const { data: agents, error } = await q;
    if (error) return json({ error: error.message }, 500);
    const agent = agents?.[0];
    if (!agent) return json({ error: "Agent not found" }, 404);

    const OPENROUTER_API_KEY = (Deno.env.get("OPENROUTER_API_KEY") || "").trim().replace(/^['"]|['"]$/g, "");
    if (!OPENROUTER_API_KEY.startsWith("sk-or-")) return json({ error: "OPENROUTER_API_KEY not configured" }, 500);

    // ---- memory layer -------------------------------------------------------
    const memoryParts: string[] = [];
    if (agent.instructions_md) memoryParts.push(`# Instructions\n${agent.instructions_md}`);
    if (agent.memory_md) memoryParts.push(`# Master memory\n${agent.memory_md}`);

    if (clientId) {
      const [{ data: overrides }, { data: brain }] = await Promise.all([
        sb.from("client_agent_overrides").select("*").eq("agent_id", agent.id).eq("client_id", clientId).limit(1),
        sb.from("client_brain").select("content_md").eq("client_id", clientId).limit(1),
      ]);
      const ov: any = overrides?.[0];
      if (ov?.instructions_md) memoryParts.push(`# Client instruction overrides\n${ov.instructions_md}`);
      if (ov?.memory_md) memoryParts.push(`# Client memory\n${ov.memory_md}`);
      if ((brain?.[0] as any)?.content_md) memoryParts.push(`# Client brain\n${(brain![0] as any).content_md}`);
    }

    const { data: training } = await sb
      .from("agency_agent_training")
      .select("title, content")
      .eq("agent_id", agent.id)
      .limit(20);
    for (const t of training || []) {
      if ((t as any)?.content) memoryParts.push(`# Trained: ${(t as any).title || "note"}\n${String((t as any).content).slice(0, 4000)}`);
    }

    // ---- connector layer ----------------------------------------------------
    const connectorResults = await runConnectors(agent.id, clientId);
    const connectorContext = connectorResults
      .map((c: any) =>
        c.status === "ok"
          ? `## ${c.label} (${c.kind}:${c.target}) — ${c.row_count} rows\n${JSON.stringify(c.sample).slice(0, 6000)}`
          : `## ${c.label} (${c.kind}:${c.target}) — ERROR: ${c.error}`,
      )
      .join("\n\n");

    const taskPrompt: string = body.prompt || agent.schedule_prompt || "Run your standard cadence and report back.";
    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = [
      memoryParts.join("\n\n").slice(0, 60000),
      connectorContext ? `# Live Supabase connector data (${today})\n${connectorContext}` : "",
      "Use only the data above. If a number is missing, say it is missing instead of inventing it.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const models = [agent.default_model, ...((agent.fallback_models as string[]) || [])].filter(Boolean);

    // ---- MCP layer ----------------------------------------------------------
    let mcp: McpClient | null = null;
    let mcpTools: McpTool[] = [];
    const mcpCalls: { tool: string; ok: boolean; error?: string }[] = [];
    if (agent.mcp_enabled && agent.mcp_url) {
      const token = agent.mcp_token_env ? Deno.env.get(agent.mcp_token_env) || null : null;
      try {
        mcp = new McpClient(agent.mcp_url, token);
        mcpTools = await mcp.listTools();
      } catch (e) {
        mcp = null;
        mcpCalls.push({ tool: "tools/list", ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: taskPrompt },
    ];

    const callModel = () =>
      fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://reporting.highperformanceads.com",
          "X-Title": `HPA Agent · ${agent.name}`,
        },
        body: JSON.stringify({
          model: models[0],
          models,
          messages,
          temperature: 0.4,
          ...(mcpTools.length ? { tools: toOpenAiTools(mcpTools), tool_choice: "auto" } : {}),
        }),
      });

    let aiRes = await callModel();
    let aiData: any = null;

    // Tool-call loop (MCP agents only).
    for (let hop = 0; hop < 6 && aiRes.ok; hop++) {
      aiData = await aiRes.json();
      const msg = aiData.choices?.[0]?.message;
      const toolCalls = msg?.tool_calls || [];
      if (!mcp || !toolCalls.length) break;
      messages.push(msg);
      for (const tc of toolCalls) {
        const name = tc.function?.name || "";
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* ignore */ }
        let content = "";
        try {
          content = await mcp.callTool(name, args);
          mcpCalls.push({ tool: name, ok: !content.startsWith("TOOL ERROR") });
        } catch (e) {
          content = `TOOL ERROR: ${e instanceof Error ? e.message : String(e)}`;
          mcpCalls.push({ tool: name, ok: false, error: content });
        }
        messages.push({ role: "tool", tool_call_id: tc.id, name, content: content.slice(0, 30000) });
      }
      aiRes = await callModel();
    }

    if (!aiRes.ok) {
      const errText = (await aiRes.text()).slice(0, 500);
      await sb.from("agent_task_runs").insert({
        agent_id: agent.id,
        client_id: clientId,
        status: "failed",
        prompt: taskPrompt,
        model: models[0],
        error: `OpenRouter ${aiRes.status}: ${errText}`,
        connectors_used: connectorResults.map((c: any) => ({ label: c.label, status: c.status, rows: c.row_count ?? null })),
        duration_ms: Date.now() - startedAt,
      });
      return json({ error: `OpenRouter ${aiRes.status}: ${errText}` }, aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 502);
    }

    if (!aiData || aiData.choices?.[0]?.message?.tool_calls?.length) aiData = await aiRes.json();
    const output = aiData.choices?.[0]?.message?.content || "";
    const usage = aiData.usage || {};

    const { data: runRow } = await sb
      .from("agent_task_runs")
      .insert({
        agent_id: agent.id,
        client_id: clientId,
        status: "completed",
        prompt: taskPrompt,
        model: aiData.model || models[0],
        output_md: output,
        connectors_used: connectorResults.map((c: any) => ({ label: c.label, status: c.status, rows: c.row_count ?? null })),
        mcp_calls: mcpCalls.length ? mcpCalls : null,
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        duration_ms: Date.now() - startedAt,
      })
      .select("id")
      .single();

    if (clientId && output) {
      await sb.from("client_agent_journal").insert({
        client_id: clientId,
        agent_id: agent.id,
        entry_type: "run",
        scope: "adhoc",
        title: `${agent.name} · scheduled run`,
        body_md: output.slice(0, 20000),
        metadata: { run_id: runRow?.id, model: aiData.model || models[0] },
        tokens_used: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      });
    }

    await sb.from("agency_agents").update({ last_run_at: new Date().toISOString() }).eq("id", agent.id);

    return json({
      ok: true,
      agent: { id: agent.id, slug: agent.slug, name: agent.name },
      run_id: runRow?.id ?? null,
      model: aiData.model || models[0],
      connectors: connectorResults.map((c: any) => ({ label: c.label, status: c.status, rows: c.row_count ?? null })),
      mcp_tools: mcpTools.map((t) => t.name),
      mcp_calls: mcpCalls,
      output,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
