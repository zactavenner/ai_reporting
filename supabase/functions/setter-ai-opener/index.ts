import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTERNAL_PASSWORD = "HPA1234$";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body?.password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { lead_id, channel = "sms" } = body;
    if (!lead_id) throw new Error("lead_id required");

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: lead } = await sb
      .from("leads")
      .select("id, name, email, phone, source, utm_source, utm_campaign, campaign_name, questions, client_id, clients(name, industry)")
      .eq("id", lead_id)
      .maybeSingle();
    if (!lead) throw new Error("lead not found");

    const clientName = (lead as any).clients?.name || "our team";
    const industry = (lead as any).clients?.industry || "";
    const firstName = (lead.name || "").split(" ")[0] || "there";

    const questionsText = Array.isArray(lead.questions)
      ? lead.questions.map((q: any) => `${q.question || q.q || ""}: ${q.answer || q.a || ""}`).filter(Boolean).slice(0, 5).join("; ")
      : "";

    const system = `You are a fast, friendly setter for ${clientName}${industry ? ` (${industry})` : ""}. Write ONE opening ${channel === "email" ? "email" : "SMS"} to a brand-new inbound lead — the lead just came in minutes ago. Rules:
- Sound like a real person, not marketing.
- Reference their interest naturally if the form answers reveal it.
- Ask ONE simple question or propose a quick call.
- ${channel === "sms" ? "Under 300 characters. No emojis. No links unless essential." : "Under 90 words. One short paragraph. Clear subject line prefixed with 'Subject:' on its own first line."}
- Never invent facts. Never mention 'AI' or 'automated'.`;

    const user = `Lead name: ${lead.name || "Unknown"}
Source: ${lead.source || "meta"}${lead.utm_source ? ` / ${lead.utm_source}` : ""}
Campaign: ${lead.campaign_name || lead.utm_campaign || "-"}
Form answers: ${questionsText || "(none)"}
Draft the opener now.`;

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openrouter/owl-alpha",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.6,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return new Response(JSON.stringify({ error: `ai failed [${resp.status}]`, details: t }), {
        status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const j = await resp.json();
    const raw = j?.choices?.[0]?.message?.content?.trim() || "";
    let subject: string | null = null;
    let text = raw;
    if (channel === "email") {
      const m = raw.match(/^Subject:\s*(.+?)\n([\s\S]*)$/i);
      if (m) { subject = m[1].trim(); text = m[2].trim(); }
    }
    return new Response(JSON.stringify({ ok: true, subject, text, firstName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[setter-ai-opener]", e?.message || e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});