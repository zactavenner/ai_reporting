// Test any agency agent live. Loads master profile (agency_agents) + optional
// client override (client_agent_overrides) + client brain (client_brain) +
// attached files list (agency_agent_files) and calls OpenRouter with the
// agent's default_model. Returns a single assistant reply.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = (Deno.env.get("OPENROUTER_API_KEY") || "").trim().replace(/^['"]|['"]$/g, "");

type Msg = { role: "user" | "assistant" | "system"; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { agent_id, client_id, messages } = await req.json() as {
      agent_id: string; client_id?: string | null; messages: Msg[];
    };
    if (!agent_id || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: "agent_id and messages[] required" }, 400);
    }
    if (!OPENROUTER_API_KEY.startsWith("sk-or-")) {
      return json({ error: "OPENROUTER_API_KEY not configured on the server" }, 500);
    }

    const supa = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Master agent record
    const { data: agent, error: agentErr } = await supa
      .from("agency_agents")
      .select("id, name, role, default_model, system_prompt, memory_md, instructions_md, connectors, capabilities")
      .eq("id", agent_id)
      .maybeSingle();
    if (agentErr || !agent) return json({ error: "Agent not found" }, 404);

    // 2. Optional client override + brain
    let override: any = null;
    let brain: any = null;
    let clientName: string | null = null;
    if (client_id) {
      const [ov, br, cli] = await Promise.all([
        supa.from("client_agent_overrides").select("memory_md, instructions_md").eq("client_id", client_id).eq("agent_id", agent_id).maybeSingle(),
        supa.from("client_brain").select("voice, icp, brand_guidelines, do_not_say").eq("client_id", client_id).maybeSingle(),
        supa.from("clients").select("name").eq("id", client_id).maybeSingle(),
      ]);
      override = ov.data;
      brain = br.data;
      clientName = (cli.data as any)?.name || null;
    }

    // 3. Files list (metadata only — model sees filenames as references)
    const filesQ = supa.from("agency_agent_files").select("name, mime, size_bytes, client_id").eq("agent_id", agent_id);
    const { data: files } = client_id
      ? await filesQ.or(`client_id.is.null,client_id.eq.${client_id}`)
      : await filesQ.is("client_id", null);

    // 4. Compose system prompt
    const sys: string[] = [];
    sys.push(`You are ${agent.name} — ${agent.role}.`);
    if (agent.system_prompt) sys.push(agent.system_prompt);
    if (agent.memory_md) sys.push(`\n## Master memory\n${agent.memory_md}`);
    if (agent.instructions_md) sys.push(`\n## Master instructions\n${agent.instructions_md}`);
    if (override?.memory_md) sys.push(`\n## Client memory addendum (${clientName || "client"})\n${override.memory_md}`);
    if (override?.instructions_md) sys.push(`\n## Client instructions addendum (${clientName || "client"})\n${override.instructions_md}`);
    if (brain) {
      const b: string[] = [];
      if (brain.voice) b.push(`Voice: ${brain.voice}`);
      if (brain.icp) b.push(`ICP: ${brain.icp}`);
      if (brain.brand_guidelines) b.push(`Brand guidelines: ${brain.brand_guidelines}`);
      if (brain.do_not_say) b.push(`Do NOT say: ${brain.do_not_say}`);
      if (b.length) sys.push(`\n## Client brain\n${b.join("\n")}`);
    }
    if (files && files.length) {
      sys.push(`\n## Reference files available to you (${files.length})\n` +
        files.map((f: any) => `- ${f.name}${f.client_id ? " (client-specific)" : ""}`).join("\n"));
    }
    sys.push(`\nYou are being tested inside the Agent Workforce template. Answer directly, follow the memory/instructions above precisely, and be concise. This is a live test — respond as the agent, not as a generic assistant.`);

    const model = agent.default_model || "openrouter/deepseek/deepseek-v4-flash";
    const cleanModel = model.startsWith("openrouter/") ? model.slice("openrouter/".length) : model;

    // 5. Call OpenRouter
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://reporting.highperformanceads.com",
        "X-Title": "Agent Test Chat",
      },
      body: JSON.stringify({
        model: cleanModel,
        messages: [{ role: "system", content: sys.join("\n") }, ...messages],
        temperature: 0.4,
      }),
    });
    const text = await res.text();
    if (!res.ok) return json({ error: `Model call failed [${res.status}]: ${text.slice(0, 500)}` }, 500);
    const data = JSON.parse(text);
    const reply = data.choices?.[0]?.message?.content || "(no reply)";

    // Auto-journal: when this test is scoped to a client, log the turn so the
    // agent builds a durable per-client history it can reflect on later.
    if (client_id) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      const promptLine = lastUser.split("\n")[0].slice(0, 80) || "chat";
      const body_md = `**User:**\n\n${lastUser}\n\n**${agent.name}:**\n\n${reply}`;
      supa.from("client_agent_journal").insert({
        client_id, agent_id,
        entry_type: "run",
        scope: "adhoc",
        title: `Chat · ${promptLine}`,
        body_md,
        metadata: { model: cleanModel, turns: messages.length },
        tokens_used: (data.usage?.total_tokens as number) || 0,
      }).then(() => {}, () => {});
    }

    return json({
      reply,
      model_used: cleanModel,
      context_summary: {
        has_memory: !!agent.memory_md,
        has_instructions: !!agent.instructions_md,
        client_override: !!(override?.memory_md || override?.instructions_md),
        client_brain: !!brain,
        files_count: files?.length || 0,
      },
    });
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}