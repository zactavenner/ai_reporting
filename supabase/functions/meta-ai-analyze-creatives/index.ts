import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";
const GATEWAY = "https://openrouter.ai/api/v1/chat/completions";

async function ai(prompt: string, system: string) {
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${(Deno.env.get("OPENROUTER_API_KEY") || "").trim().replace(/^['\"]|['\"]$/g, "")}`,
      "HTTP-Referer": "https://reporting.highperformanceads.com",
      "X-Title": "HPA Creative Insights",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return JSON.parse(j.choices?.[0]?.message?.content || "{}");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const clientId: string | undefined = body.client_id;
    const limit = body.limit || 20;

    const adQ = supabase
      .from("meta_ads")
      .select("id, client_id, meta_ad_id, name, headline, primary_text, description, cta, spend, attributed_leads, cost_per_lead, frequency")
      .gt("spend", 0)
      .order("spend", { ascending: false })
      .limit(limit);
    const { data: ads, error } = clientId
      ? await adQ.eq("client_id", clientId)
      : await adQ;
    if (error) throw error;

    if (!ads || ads.length === 0) {
      return new Response(JSON.stringify({ ok: true, insights: 0, note: "no ads" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // group by client; one AI call per client over its top ads
    const byClient = new Map<string, any[]>();
    for (const a of ads) {
      if (!a.client_id) continue;
      if (!byClient.has(a.client_id)) byClient.set(a.client_id, []);
      byClient.get(a.client_id)!.push(a);
    }

    const today = new Date().toISOString().slice(0, 10);
    let totalInsights = 0;

    for (const [cid, list] of byClient) {
      const summary = list.map((a, i) => `#${i + 1} [${a.meta_ad_id}] spend $${Number(a.spend).toFixed(0)} leads ${a.attributed_leads || 0} CPL $${Number(a.cost_per_lead || 0).toFixed(2)} freq ${Number(a.frequency || 0).toFixed(2)}\n  headline: ${a.headline || ""}\n  body: ${(a.primary_text || "").slice(0, 240)}\n  cta: ${a.cta || ""}`).join("\n\n");

      let result: any;
      try {
        result = await ai(
          `Analyze the following Meta ads and identify winning patterns. Return JSON with shape: {"insights":[{"insight_type":"hook|headline|offer|angle|imagery|cta|summary","title":"...","body":"...","confidence":0-1,"evidence":{}}]}\n\nADS:\n${summary}`,
          "You are a senior direct-response media buyer. Find concrete, evidence-backed patterns across the supplied ads (winning hooks, offers, angles, CTAs). Quantify lift when possible. 4-8 insights, no fluff, no investment guarantees.",
        );
      } catch (e) {
        console.error("AI failed for client", cid, e);
        continue;
      }

      const rows = (result.insights || []).slice(0, 12).map((ins: any) => ({
        client_id: cid,
        scope: "account",
        insight_type: ins.insight_type || "summary",
        title: (ins.title || "").slice(0, 200),
        body: ins.body || "",
        evidence: ins.evidence || {},
        confidence: typeof ins.confidence === "number" ? ins.confidence : null,
        model: MODEL,
        generated_for_date: today,
      }));
      if (rows.length) {
        await supabase.from("meta_ai_creative_insights").insert(rows);
        totalInsights += rows.length;
      }
    }

    return new Response(JSON.stringify({ ok: true, insights: totalInsights, clients: byClient.size }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});