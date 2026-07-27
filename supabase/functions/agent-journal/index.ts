// Journal for per-client agent history + self-improvement loop.
// POST { action: "log", client_id, agent_id, entry_type, scope, title, body_md, metadata? }
// POST { action: "reflect", client_id, agent_id, window_days? } — reads recent journal
//   entries + client override memory, asks the model to synthesize what's working /
//   what to change, writes a `reflection` journal entry, AND appends distilled
//   learnings into client_agent_overrides.memory_md so the agent gets smarter.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const action = body.action || "log";
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);

    if (action === "log") {
      const { client_id, agent_id, entry_type = "run", scope = "adhoc", title, body_md, metadata = {}, tokens_used = 0, cost_usd = 0 } = body;
      if (!client_id || !agent_id || !title || !body_md) {
        return json({ error: "client_id, agent_id, title, body_md required" }, 400);
      }
      const { data, error } = await supa.from("client_agent_journal").insert({
        client_id, agent_id, entry_type, scope, title, body_md, metadata, tokens_used, cost_usd,
      }).select("id, created_at").single();
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, id: data.id, created_at: data.created_at });
    }

    if (action === "reflect") {
      if (!LOVABLE_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);
      const { client_id, agent_id, window_days = 7 } = body;
      if (!client_id || !agent_id) return json({ error: "client_id and agent_id required" }, 400);

      const since = new Date(Date.now() - window_days * 24 * 3600 * 1000).toISOString();

      const [agentQ, entriesQ, overrideQ, clientQ] = await Promise.all([
        supa.from("agency_agents").select("name, role, memory_md, instructions_md").eq("id", agent_id).maybeSingle(),
        supa.from("client_agent_journal").select("entry_type, scope, title, body_md, created_at")
          .eq("client_id", client_id).eq("agent_id", agent_id)
          .gte("created_at", since).order("created_at", { ascending: false }).limit(60),
        supa.from("client_agent_overrides").select("memory_md, instructions_md")
          .eq("client_id", client_id).eq("agent_id", agent_id).maybeSingle(),
        supa.from("clients").select("name").eq("id", client_id).maybeSingle(),
      ]);
      const agent = agentQ.data;
      const entries = entriesQ.data || [];
      const override = overrideQ.data;
      const clientName = (clientQ.data as any)?.name || "client";
      if (!agent) return json({ error: "Agent not found" }, 404);
      if (entries.length === 0) return json({ error: "No journal entries yet in that window — the agent has nothing to reflect on." }, 400);

      const digest = entries.map((e: any) => `### ${e.created_at.slice(0, 16).replace("T", " ")} · ${e.entry_type}/${e.scope} · ${e.title}\n${(e.body_md || "").slice(0, 1500)}`).join("\n\n");
      const currentMem = override?.memory_md || agent.memory_md || "(empty)";

      const sys = `You are ${agent.name} — ${agent.role}.\nYou are performing a REFLECTION pass for client "${clientName}".\n\nInputs you will read:\n1. Your CURRENT client-specific memory (rules you already follow).\n2. Your JOURNAL (${entries.length} recent entries covering the last ${window_days} day(s)).\n\nProduce a strict-markdown reflection with these H2 sections in this order:\n\n## What I did\n- Bullet list of concrete actions/decisions across the window.\n\n## What worked\n- Patterns/decisions with evidence they helped. Reference journal entries by date.\n\n## What did not work\n- Mistakes, dead ends, misfires — be blunt. Reference dates.\n\n## New rules for me\n- Small numbered list (max 8) of NEW durable rules to add to my memory. Each rule must be one imperative sentence I can follow next time. No fluff, no "I will try".\n\n## Metrics to track\n- Concrete numbers I should watch next window (CPL, CPA, ROAS, response rate, etc.) — client-appropriate.\n\nBe specific, numeric, and honest. Do not repeat rules already in current memory.`;

      const user = `# Current client memory\n${currentMem}\n\n# Journal (${entries.length} entries, last ${window_days}d)\n${digest}`;

      const model = "google/gemini-2.5-flash";
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": LOVABLE_KEY,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: sys }, { role: "user", content: user }],
          temperature: 0.3,
        }),
      });
      const text = await res.text();
      if (!res.ok) return json({ error: `Reflection failed [${res.status}]: ${text.slice(0, 500)}` }, 500);
      const data = JSON.parse(text);
      const reflection = data.choices?.[0]?.message?.content || "(empty reflection)";

      // Extract "New rules for me" block and append to client override memory
      const rulesMatch = reflection.match(/##\s*New rules for me\s*\n([\s\S]*?)(?=\n##\s|$)/i);
      const newRules = rulesMatch ? rulesMatch[1].trim() : "";

      // Persist the reflection as a journal entry
      await supa.from("client_agent_journal").insert({
        client_id, agent_id,
        entry_type: "reflection",
        scope: window_days <= 1 ? "daily" : window_days <= 8 ? "weekly" : "monthly",
        title: `Reflection · last ${window_days}d · ${entries.length} entries`,
        body_md: reflection,
        metadata: { window_days, source_entries: entries.length, model },
      });

      // Loop-improvement: append new rules to client override memory
      if (newRules) {
        const prior = override?.memory_md || "";
        const stamp = new Date().toISOString().slice(0, 10);
        const nextMem = `${prior}${prior ? "\n\n" : ""}## Learnings ${stamp}\n${newRules}`.slice(0, 40000);
        await supa.from("client_agent_overrides").upsert({
          client_id, agent_id,
          memory_md: nextMem,
          instructions_md: override?.instructions_md || null,
        }, { onConflict: "client_id,agent_id" });
      }

      return json({ ok: true, reflection, new_rules: newRules, entries_reviewed: entries.length });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}