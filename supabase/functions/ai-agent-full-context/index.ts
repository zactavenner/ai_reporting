import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "X-Context-Tokens, X-System-Tokens",
};

const MODEL_MAP: Record<string, string> = {
  "gemini-2.5-pro": "nvidia/nemotron-3-ultra-550b-a55b:free",
  "gemini-3-pro": "google/gemini-3-pro-preview",
  "gemini-3-flash": "nvidia/nemotron-3-ultra-550b-a55b:free",
  "gpt-5": "openai/gpt-5",
  "grok": "xai-grok",  // handled separately
  "grok-4-reasoning": "xai-grok-4-reasoning",  // handled separately
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, model = "nvidia/nemotron-3-ultra-550b-a55b:free", clientFilter } = await req.json();

    const OPENROUTER_API_KEY = (Deno.env.get('OPENROUTER_API_KEY') || '').trim().replace(/^['"]|['"]$/g, '');
    if (!OPENROUTER_API_KEY.startsWith('sk-or-')) throw new Error("OPENROUTER_API_KEY is not configured or invalid");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch all data in parallel
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

    const clientQuery = supabase.from("clients").select("id, name, status, industry, slug");
    if (clientFilter && clientFilter !== "all") {
      clientQuery.eq("id", clientFilter);
    }

    const [
      { data: clients },
      { data: dailyMetrics },
      { data: leads },
      { data: calls },
      { data: fundedInvestors },
      { data: tasks },
      { data: meetings },
      { data: pipelines },
      { data: agencySettings },
      { data: offers },
    ] = await Promise.all([
      clientQuery,
      supabase
        .from("daily_metrics")
        .select("client_id, date, ad_spend, leads, calls, showed_calls, funded_investors, funded_dollars, spam_leads, commitment_dollars, commitments, reconnect_calls, reconnect_showed")
        .gte("date", thirtyDaysAgoStr),
      supabase
        .from("leads")
        .select("id, client_id, source, status, is_spam, created_at, name, utm_source, utm_campaign, opportunity_value")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("calls")
        .select("id, client_id, showed, outcome, scheduled_at, contact_name, is_reconnect, appointment_status")
        .gte("created_at", thirtyDaysAgo.toISOString())
        .limit(500),
      supabase
        .from("funded_investors")
        .select("id, client_id, name, funded_amount, funded_at, commitment_amount, source, time_to_fund_days, calls_to_fund")
        .order("funded_at", { ascending: false })
        .limit(300),
      supabase
        .from("tasks")
        .select("id, client_id, title, status, priority, due_date, stage, assigned_client_name")
        .in("status", ["todo", "in_progress"]),
      supabase
        .from("agency_meetings")
        .select("id, client_id, title, meeting_date, summary, duration_minutes, action_items")
        .gte("meeting_date", thirtyDaysAgo.toISOString())
        .order("meeting_date", { ascending: false })
        .limit(50),
      supabase
        .from("client_pipelines")
        .select("id, client_id, name, ghl_pipeline_id")
        .limit(100),
      supabase
        .from("agency_settings")
        .select("ai_prompt_agency, selected_openai_model, selected_gemini_model, selected_grok_model, xai_api_key")
        .limit(1)
        .single(),
      supabase
        .from("client_offers")
        .select("id, client_id, title, offer_type, fund_type, raise_amount, min_investment, description")
        .limit(500),
    ]);

    // Build comprehensive context per client
    const clientDataBlocks: string[] = [];
    const clientList = clients || [];

    for (const client of clientList) {
      const cId = client.id;
      const cMetrics = (dailyMetrics || []).filter((m: any) => m.client_id === cId);
      const cLeads = (leads || []).filter((l: any) => l.client_id === cId);
      const cCalls = (calls || []).filter((c: any) => c.client_id === cId);
      const cFunded = (fundedInvestors || []).filter((f: any) => f.client_id === cId);
      const cTasks = (tasks || []).filter((t: any) => t.client_id === cId);
      const cMeetings = (meetings || []).filter((m: any) => m.client_id === cId);
      const cPipelines = (pipelines || []).filter((p: any) => p.client_id === cId);
      const cOffers = (offers || []).filter((o: any) => o.client_id === cId);

      // Aggregate metrics
      const totalAdSpend = cMetrics.reduce((s: number, m: any) => s + (m.ad_spend || 0), 0);
      const totalLeads = cMetrics.reduce((s: number, m: any) => s + (m.leads || 0), 0);
      const totalCalls = cMetrics.reduce((s: number, m: any) => s + (m.calls || 0), 0);
      const totalShowed = cMetrics.reduce((s: number, m: any) => s + (m.showed_calls || 0), 0);
      const totalFundedCount = cMetrics.reduce((s: number, m: any) => s + (m.funded_investors || 0), 0);
      const totalFundedDollars = cMetrics.reduce((s: number, m: any) => s + (m.funded_dollars || 0), 0);
      const totalSpam = cMetrics.reduce((s: number, m: any) => s + (m.spam_leads || 0), 0);
      const cpl = totalLeads > 0 ? totalAdSpend / totalLeads : 0;
      const cpc = totalCalls > 0 ? totalAdSpend / totalCalls : 0;
      const costOfCapital = totalFundedDollars > 0 ? (totalAdSpend / totalFundedDollars) * 100 : 0;

      // Lead sources breakdown
      const sourceMap: Record<string, number> = {};
      cLeads.forEach((l: any) => {
        const src = l.utm_source || l.source || "unknown";
        sourceMap[src] = (sourceMap[src] || 0) + 1;
      });

      const openTasks = cTasks.filter((t: any) => t.status !== "done");
      const overdueTasks = openTasks.filter((t: any) => t.due_date && new Date(t.due_date) < new Date());

      let block = `\n## ${client.name} (${client.status})${client.industry ? ` | ${client.industry}` : ""}
**30-Day Metrics:**
- Ad Spend: $${totalAdSpend.toLocaleString()} | Leads: ${totalLeads} (${totalSpam} spam) | CPL: $${cpl.toFixed(2)}
- Calls: ${totalCalls} | Shows: ${totalShowed} (${totalCalls > 0 ? ((totalShowed / totalCalls) * 100).toFixed(1) : 0}%) | CPC: $${cpc.toFixed(2)}
- Funded: ${totalFundedCount} investors, $${totalFundedDollars.toLocaleString()} | Cost of Capital: ${costOfCapital.toFixed(2)}%`;

      if (Object.keys(sourceMap).length > 0) {
        block += `\n**Lead Sources:** ${Object.entries(sourceMap).map(([s, c]) => `${s}: ${c}`).join(", ")}`;
      }

      if (cFunded.length > 0) {
        const recentFunded = cFunded.slice(0, 5);
        block += `\n**Recent Funded:** ${recentFunded.map((f: any) => `${f.name || "Unknown"} ($${(f.funded_amount || 0).toLocaleString()}, ${f.time_to_fund_days || "?"} days)`).join("; ")}`;
      }

      if (openTasks.length > 0) {
        block += `\n**Open Tasks:** ${openTasks.length} (${overdueTasks.length} overdue)`;
        const topTasks = openTasks.slice(0, 3);
        block += ` — ${topTasks.map((t: any) => `"${t.title}" [${t.priority}]`).join(", ")}`;
      }

      if (cMeetings.length > 0) {
        block += `\n**Recent Meetings:** ${cMeetings.slice(0, 3).map((m: any) => `${m.title} (${m.meeting_date?.split("T")[0] || "?"}): ${(m.summary || "").slice(0, 150)}`).join(" | ")}`;
      }

      if (cPipelines.length > 0) {
        block += `\n**Pipelines:** ${cPipelines.map((p: any) => p.name).join(", ")}`;
      }

      if (cOffers.length > 0) {
        block += `\n**Offers (source of truth — tailor every recommendation, ad, script, email to these):**`;
        cOffers.slice(0, 5).forEach((o: any) => {
          const meta = [o.offer_type, o.fund_type, o.raise_amount ? `raise $${Number(o.raise_amount).toLocaleString()}` : null, o.min_investment ? `min $${Number(o.min_investment).toLocaleString()}` : null].filter(Boolean).join(" · ");
          block += `\n  • ${o.title}${meta ? ` (${meta})` : ""}${o.description ? `\n    ↳ ${String(o.description).slice(0, 400)}` : ""}`;
        });
        if (cOffers.length > 5) block += `\n  …and ${cOffers.length - 5} more offer(s).`;
      }

      clientDataBlocks.push(block);
    }

    // Build system prompt
    const customPrompt = agencySettings?.ai_prompt_agency || "";
    const systemPrompt = `You are an expert agency performance analyst with COMPLETE access to all client data across the portfolio.
${customPrompt ? `\nAgency Instructions: ${customPrompt}` : ""}

Today's Date: ${new Date().toISOString().split("T")[0]}
Total Clients: ${clientList.length} (${clientList.filter((c: any) => c.status === "active").length} active)

# Full Portfolio Data (Last 30 Days)
${clientDataBlocks.join("\n")}

---
Provide specific, data-driven insights. Reference exact numbers. Compare clients when relevant. Flag concerning trends proactively.`;

    // Estimate tokens
    const systemTokens = Math.ceil(systemPrompt.length / 4);
    const conversationTokens = (messages || []).reduce(
      (sum: number, m: any) => sum + Math.ceil((m.content || "").length / 4),
      0
    );
    const totalTokens = systemTokens + conversationTokens;

    // Resolve model using stored preferences from agency_settings
    const selectedGrokModel = agencySettings?.selected_grok_model || "grok-3";
    const selectedOpenaiModel = agencySettings?.selected_openai_model || "gpt-5";
    const selectedGeminiModel = agencySettings?.selected_gemini_model || "gemini-2.5-pro";

    const GATEWAY_MODEL_MAP: Record<string, string> = {
      "nvidia/nemotron-3-ultra-550b-a55b:free": "nvidia/nemotron-3-ultra-550b-a55b:free",
      "gemini-2.5-pro": `google/${selectedGeminiModel === "gemini-2.5-pro" ? "gemini-2.5-pro" : selectedGeminiModel.replace("gemini-3-pro", "gemini-3-pro-preview").replace("gemini-3-flash", "gemini-3-flash-preview")}`,
      "gemini-3-pro": `google/${selectedGeminiModel.replace("gemini-3-pro", "gemini-3-pro-preview").replace("gemini-3-flash", "gemini-3-flash-preview")}`,
      "gemini-3-flash": `google/${selectedGeminiModel.replace("gemini-3-pro", "gemini-3-pro-preview").replace("gemini-3-flash", "gemini-3-flash-preview")}`,
      "gpt-5": `openai/${selectedOpenaiModel}`,
    };

    const resolvedModel = GATEWAY_MODEL_MAP[model] || "nvidia/nemotron-3-ultra-550b-a55b:free";
    const isGrok = model === "grok" || model === "grok-4-reasoning";

    let response: Response;

    if (isGrok) {
      const xaiKey = agencySettings?.xai_api_key || Deno.env.get("XAI_API_KEY");
      if (!xaiKey) {
        return new Response(
          JSON.stringify({ error: "xAI API key is not configured. Please add it in Agency Settings → API Keys." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${xaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model === "grok-4-reasoning" ? "grok-4-fast-reasoning" : selectedGrokModel,
          messages: [
            { role: "system", content: systemPrompt },
            ...(messages || []),
          ],
          stream: true,
        }),
      });
    } else {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://reporting.highperformanceads.com",
          "X-Title": "HPA Agent Full Context",
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: "system", content: systemPrompt },
            ...(messages || []),
          ],
          stream: true,
        }),
      });
    }

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Context-Tokens": String(totalTokens),
        "X-System-Tokens": String(systemTokens),
      },
    });
  } catch (e) {
    console.error("ai-agent-full-context error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
