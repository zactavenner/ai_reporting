// Jarvis Command Center — Jarvis is the COO with DIRECT platform data access
// (clients, offers, ads, metrics, per-client account-manager context). He does
// NOT delegate reads to Hermes; Hermes is inbound-only (via hermes-inbound).
// Streams SSE with delta / thought / tool_call / tool_result events so the UI
// can render live reasoning and tool activity.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_KEY = (Deno.env.get("OPENROUTER_API_KEY") || "").trim().replace(/^['"]|['"]$/g, "");

function getOpenRouterKey() {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
  if (!OPENROUTER_KEY.startsWith("sk-or-")) throw new Error("OPENROUTER_API_KEY has an invalid format. It must be an OpenRouter key (sk-or-...).");
  return OPENROUTER_KEY;
}

// Tool-capable model chain. Nemotron is the persistent default; fallbacks are
// only used if OpenRouter rejects/limits that model.
const TOOL_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemini-2.0-flash-001",
  "openai/gpt-4o-mini",
];

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

const JARVIS_SYSTEM = `You are JARVIS — Chief of Staff / COO for High Performance Ads. Calm, sharp, executive.

YOU HAVE DIRECT PLATFORM ACCESS via tools:
 - list_clients / get_client — every client in the roster
 - list_offers / get_offer — every active offer per client
 - list_active_ads — live Meta ads with spend/leads/CPL
 - get_client_metrics — 30-day performance rollups
 - ask_account_manager — talk to the per-client Jarvis Account Manager (mini-Jarvis) who owns that client's full context (offers, brain, live ads, agents)
 - web_search — pull external info when needed

RULES:
 - Use tools FIRST for any factual question about clients / offers / ads / links / performance. Never say "I don't have that data" — call a tool.
 - You are ABOVE Hermes. Hermes is inbound only (he sends you requests). You do NOT ask Hermes for data.
 - For anything client-specific, prefer ask_account_manager(client_id, question) — the AM has the deepest context for that client.
 - Answer concisely, executive-style. Markdown is fine. Cite counts / IDs where useful.`;

// ---------- Tool definitions ----------
const TOOLS = [
  { type: "function", function: { name: "list_clients", description: "List all clients in the agency roster with id, name, status, industry.", parameters: { type: "object", properties: { status: { type: "string", description: "Optional filter: active|paused|churned" } } } } },
  { type: "function", function: { name: "get_client", description: "Get full detail for one client by id or slug.", parameters: { type: "object", properties: { client: { type: "string", description: "Client id (uuid) or slug or name substring" } }, required: ["client"] } } },
  { type: "function", function: { name: "list_offers", description: "List offers. Optionally filter by client.", parameters: { type: "object", properties: { client_id: { type: "string" } } } } },
  { type: "function", function: { name: "get_offer", description: "Get one offer with full details.", parameters: { type: "object", properties: { offer_id: { type: "string" } }, required: ["offer_id"] } } },
  { type: "function", function: { name: "list_active_ads", description: "List live Meta ads for a client with spend, leads, CPL.", parameters: { type: "object", properties: { client_id: { type: "string" }, limit: { type: "number" } }, required: ["client_id"] } } },
  { type: "function", function: { name: "get_client_metrics", description: "Get 30-day performance rollup for a client (spend, leads, calls, funded).", parameters: { type: "object", properties: { client_id: { type: "string" }, days: { type: "number" } }, required: ["client_id"] } } },
  { type: "function", function: { name: "ask_account_manager", description: "Ask the per-client Jarvis Account Manager (mini-Jarvis) a question. They have that client's full context (brain, offers, live ads, agents). Use for anything client-specific requiring judgment.", parameters: { type: "object", properties: { client_id: { type: "string" }, question: { type: "string" } }, required: ["client_id", "question"] } } },
  { type: "function", function: { name: "web_search", description: "Search the web for external / current info.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
];

async function resolveClientId(supa: any, ref: string): Promise<string | null> {
  if (/^[0-9a-f-]{36}$/i.test(ref)) return ref;
  const { data } = await supa.from("clients").select("id,name,slug").or(`slug.eq.${ref},name.ilike.%${ref}%`).limit(1);
  return data?.[0]?.id || null;
}

async function execTool(name: string, args: any, supa: any): Promise<any> {
  try {
    switch (name) {
      case "list_clients": {
        let q = supa.from("clients").select("id,name,status,industry,slug").order("name").limit(200);
        if (args?.status) q = q.eq("status", args.status);
        const { data, error } = await q;
        if (error) throw error;
        return { count: data?.length || 0, clients: data };
      }
      case "get_client": {
        const id = await resolveClientId(supa, String(args.client || ""));
        if (!id) return { error: "client not found" };
        const { data } = await supa.from("clients").select("id,name,status,industry,slug,website_url,description,media_buyer,account_manager,meta_ad_account_ids,ghl_location_id").eq("id", id).maybeSingle();
        return data || { error: "not found" };
      }
      case "list_offers": {
        let q = supa.from("client_offers").select("id,client_id,fund_name,fund_type,raise_amount,status,targeted_returns").limit(200);
        if (args?.client_id) q = q.eq("client_id", args.client_id);
        const { data, error } = await q;
        if (error) throw error;
        return { count: data?.length || 0, offers: data };
      }
      case "get_offer": {
        const { data } = await supa.from("client_offers").select("*").eq("id", args.offer_id).maybeSingle();
        return data || { error: "not found" };
      }
      case "list_active_ads": {
        const limit = Math.min(args?.limit || 25, 100);
        const { data, error } = await supa.from("meta_ads")
          .select("id,name,effective_status,spend,impressions,clicks,ctr,cpc,attributed_leads,cost_per_lead,link_url,preview_url,thumbnail_url")
          .eq("client_id", args.client_id).eq("effective_status", "ACTIVE")
          .order("spend", { ascending: false }).limit(limit);
        if (error) throw error;
        return { count: data?.length || 0, ads: data };
      }
      case "get_client_metrics": {
        const days = Math.min(args?.days || 30, 90);
        const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        const { data } = await supa.from("v_client_performance_daily")
          .select("date,spend,leads,calls_booked,showed,funded,funded_dollars")
          .eq("client_id", args.client_id).gte("date", from);
        const totals = (data || []).reduce((a: any, r: any) => ({
          spend: a.spend + Number(r.spend || 0), leads: a.leads + Number(r.leads || 0),
          calls: a.calls + Number(r.calls_booked || 0), showed: a.showed + Number(r.showed || 0),
          funded: a.funded + Number(r.funded || 0), funded_dollars: a.funded_dollars + Number(r.funded_dollars || 0),
        }), { spend: 0, leads: 0, calls: 0, showed: 0, funded: 0, funded_dollars: 0 });
        return { days, totals, cpl: totals.leads ? +(totals.spend / totals.leads).toFixed(2) : null, days_sampled: data?.length || 0 };
      }
      case "ask_account_manager": {
        // Mini-Jarvis for the client: assemble that client's brain + offers + recent ads + agents
        const cid = args.client_id;
        const [client, brain, offers, ads, metrics] = await Promise.all([
          supa.from("clients").select("id,name,industry,description,website_url").eq("id", cid).maybeSingle(),
          supa.from("client_brain").select("*").eq("client_id", cid).maybeSingle(),
          supa.from("client_offers").select("fund_name,fund_type,raise_amount,targeted_returns,min_investment,status").eq("client_id", cid),
          supa.from("meta_ads").select("name,spend,attributed_leads,cost_per_lead,link_url").eq("client_id", cid).eq("effective_status", "ACTIVE").order("spend", { ascending: false }).limit(10),
          supa.from("v_client_performance_daily").select("spend,leads,funded").eq("client_id", cid).gte("date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
        ]);
        const ctx = {
          client: client.data,
          brain: brain.data ? { context: (brain.data as any).context, notes: (brain.data as any).notes } : null,
          offers: offers.data,
          top_ads: ads.data,
          last_30d: (metrics.data || []).reduce((a: any, r: any) => ({ spend: a.spend + Number(r.spend || 0), leads: a.leads + Number(r.leads || 0), funded: a.funded + Number(r.funded || 0) }), { spend: 0, leads: 0, funded: 0 }),
        };
        // Call mini-Jarvis LLM scoped to this client
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${getOpenRouterKey()}`, "Content-Type": "application/json", "HTTP-Referer": "https://reporting.highperformanceads.com", "X-Title": "HPA Jarvis AM" },
          body: JSON.stringify({
            model: "nvidia/nemotron-3-ultra-550b-a55b:free",
            temperature: 0.3,
            messages: [
              { role: "system", content: `You are the JARVIS ACCOUNT MANAGER for ${client.data?.name || "this client"}. You have this client's full context below. Answer Jarvis's (COO) question tightly and factually. Cite numbers from the context. Under 200 words.\n\nCLIENT CONTEXT (JSON):\n${JSON.stringify(ctx).slice(0, 12000)}` },
              { role: "user", content: args.question },
            ],
          }),
        });
        const jr = await res.json();
        return { answer: jr.choices?.[0]?.message?.content || "(no reply)", client_name: client.data?.name };
      }
      case "web_search": {
        const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1`, { headers: { "User-Agent": "JarvisBot/1.0" } });
        const text = await res.text();
        return { query: args.query, snippet: text.slice(0, 3000) };
      }
      default:
        return { error: `unknown tool ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function callWithTools(messages: any[], signal?: AbortSignal): Promise<Response> {
  let lastErr = "";
  for (const model of TOOL_MODELS) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${getOpenRouterKey()}`, "Content-Type": "application/json", "HTTP-Referer": "https://reporting.highperformanceads.com", "X-Title": "HPA Jarvis" },
      signal,
      body: JSON.stringify({ model, messages, tools: TOOLS, stream: true, temperature: 0.5 }),
    });
    if (res.ok && res.body) return res;
    lastErr = await res.text().catch(() => "");
    console.warn(`[jarvis] ${model} -> ${res.status}: ${lastErr.slice(0, 200)}`);
  }
  throw new Error(`All models failed: ${lastErr.slice(0, 300)}`);
}

async function readStream(res: Response, onDelta: (d: string) => void): Promise<{ content: string; tool_calls: any[] }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const jsn = JSON.parse(payload);
        const delta = jsn.choices?.[0]?.delta;
        if (delta?.content) { content += delta.content; onDelta(delta.content); }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = toolAcc.get(idx) || { id: "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolAcc.set(idx, cur);
          }
        }
      } catch { /* noop */ }
    }
  }
  return { content, tool_calls: Array.from(toolAcc.values()) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const supa = createClient(SUPABASE_URL, SERVICE);
    const body = await req.json().catch(() => ({}));
    const { conversation_id, message, team_member_id } = body || {};
    if (!message || typeof message !== "string") return j({ error: "message required" }, 400);

    let userId: string = typeof team_member_id === "string" && team_member_id ? team_member_id : "anonymous";
    if (userId === "anonymous") {
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (token) {
        const uc = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
        const { data: ures } = await uc.auth.getUser();
        if (ures?.user?.id) userId = ures.user.id;
      }
    }

    let convId: string = conversation_id;
    if (!convId) {
      const { data: created, error: e1 } = await supa.from("jarvis_conversations")
        .insert({ user_id: userId, title: message.slice(0, 60) }).select("id").single();
      if (e1) throw e1;
      convId = created!.id;
    }

    await supa.from("jarvis_messages").insert({
      conversation_id: convId, user_id: userId, channel: "main", speaker: "user", role: "user", content: message,
    });

    const { data: hist } = await supa.from("jarvis_messages")
      .select("speaker, role, content").eq("conversation_id", convId).eq("channel", "main")
      .order("created_at", { ascending: true }).limit(40);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: any) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          send("meta", { conversation_id: convId });

          const messages: any[] = [
            { role: "system", content: JARVIS_SYSTEM },
            ...(hist || []).map((m: any) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
          ];

          let finalContent = "";
          for (let step = 0; step < 6; step++) {
            send("thought", { stage: "thinking", text: step === 0 ? "Analyzing…" : `Continuing (step ${step + 1})…` });
            const res = await callWithTools(messages);
            let stepContent = "";
            const { content, tool_calls } = await readStream(res, (d) => { stepContent += d; send("delta", { text: d }); });
            finalContent = content;

            if (!tool_calls.length) break;

            // Reset streamed draft — model will re-emit final answer after tool results
            send("reset_main", {});
            messages.push({ role: "assistant", content: content || null, tool_calls: tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args || "{}" } })) });

            for (const tc of tool_calls) {
              let parsedArgs: any = {};
              try { parsedArgs = JSON.parse(tc.args || "{}"); } catch { /* noop */ }
              send("tool_call", { name: tc.name, args: parsedArgs });
              const result = await execTool(tc.name, parsedArgs, supa);
              const resultStr = JSON.stringify(result).slice(0, 8000);
              send("tool_result", { name: tc.name, preview: resultStr.slice(0, 400) });
              // Persist tool activity to inter_agent channel
              await supa.from("jarvis_messages").insert({
                conversation_id: convId, user_id: userId, channel: "inter_agent",
                speaker: tc.name === "ask_account_manager" ? "hermes" : "jarvis",
                role: "assistant",
                content: `🔧 ${tc.name}(${JSON.stringify(parsedArgs).slice(0, 200)}) → ${resultStr.slice(0, 600)}`,
              });
              messages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: resultStr });
            }
          }

          const { data: assistantMsg } = await supa.from("jarvis_messages").insert({
            conversation_id: convId, user_id: userId, channel: "main", speaker: "jarvis", role: "assistant", content: finalContent,
          }).select("id").single();

          send("done", { conversation_id: convId, message_id: assistantMsg?.id });
          controller.close();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[jarvis-chat]", msg);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" },
    });
  } catch (e) {
    console.error("[jarvis-chat]", e);
    return j({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});