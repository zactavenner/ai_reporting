// Ads Manager AI Insights — analyzes recent ad/campaign performance and returns
// prioritized, actionable recommendations (pause, scale, refresh creative, adjust bid, etc.).
// Uses Lovable AI Gateway (no client-side keys).
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

interface AdRow {
  id: string;
  name?: string;
  client_id?: string;
  campaign_id?: string;
  adset_id?: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  reach?: number;
  frequency?: number;
  meta_reported_leads?: number;
  attributed_leads?: number;
  attributed_funded?: number;
  attributed_funded_dollars?: number;
  status?: string;
  created_time?: string;
}

interface CampaignRow {
  id: string;
  name?: string;
  client_id?: string;
  spend?: number;
  ctr?: number;
  attributed_leads?: number;
  attributed_funded?: number;
  attributed_funded_dollars?: number;
  daily_budget?: number;
  lifetime_budget?: number;
  status?: string;
}

function summarize(ads: AdRow[], campaigns: CampaignRow[]) {
  // Trim to top performers / spenders / underperformers to keep prompt small.
  const sortedBySpend = [...ads].sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0));
  const topSpenders = sortedBySpend.slice(0, 25);
  const noResultHighSpend = ads
    .filter(a => (Number(a.spend) || 0) > 200 && (Number(a.attributed_leads) || 0) === 0)
    .slice(0, 15);
  const winners = ads
    .filter(a => {
      const spend = Number(a.spend) || 0;
      const dollars = Number(a.attributed_funded_dollars) || 0;
      return spend > 100 && dollars / Math.max(spend, 1) > 2;
    })
    .slice(0, 15);
  const seen = new Set<string>();
  const merged = [...topSpenders, ...noResultHighSpend, ...winners].filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  return {
    ads: merged.map(a => ({
      id: a.id,
      name: a.name,
      campaign_id: a.campaign_id,
      spend: Number(a.spend) || 0,
      impressions: Number(a.impressions) || 0,
      clicks: Number(a.clicks) || 0,
      ctr: Number(a.ctr) || 0,
      cpc: Number(a.cpc) || 0,
      cpm: Number(a.cpm) || 0,
      frequency: Number(a.frequency) || 0,
      leads: Number(a.attributed_leads ?? a.meta_reported_leads) || 0,
      funded: Number(a.attributed_funded) || 0,
      revenue: Number(a.attributed_funded_dollars) || 0,
      status: a.status,
    })),
    campaigns: campaigns.slice(0, 25).map(c => ({
      id: c.id,
      name: c.name,
      spend: Number(c.spend) || 0,
      ctr: Number(c.ctr) || 0,
      leads: Number(c.attributed_leads) || 0,
      funded: Number(c.attributed_funded) || 0,
      revenue: Number(c.attributed_funded_dollars) || 0,
      daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      status: c.status,
    })),
  };
}

const SYSTEM = `You are a senior paid-media strategist for a direct-response capital-raising agency.
Analyze the supplied Meta/Google Ads performance snapshot and return a JSON object with prioritized, concrete recommendations.

Heuristics to apply (treat as guidance, not absolutes):
- Pause candidates: spend > $300 with 0 leads/funded after 7+ days, or CTR < 0.6% with > $200 spend.
- Scale candidates: ROAS (revenue / spend) > 2 OR attributed_funded > 0 with healthy CTR (> 1.2%).
- Creative fatigue: frequency > 3.5 with declining CTR — recommend refreshing creative.
- Bid/budget tweaks: high CPC (> $8) with weak CTR — refine audience or test new hook.
- Audience refinement: high impressions, low CTR (< 0.5%) — narrow targeting.

Compliance: Never use the word "guaranteed" in any copy suggestion. Use "targeted returns" phrasing.

Return STRICT JSON shaped exactly like:
{
  "summary": "1–2 sentence overview of the account's current state.",
  "insights": [
    {
      "id": "stable-slug",
      "severity": "critical" | "warning" | "opportunity" | "info",
      "action": "pause" | "scale" | "refresh_creative" | "adjust_bid" | "refine_audience" | "review",
      "title": "Short imperative (max 70 chars).",
      "rationale": "1–2 sentences explaining the data signals.",
      "target_type": "ad" | "campaign" | "account",
      "target_ids": ["…"],
      "target_names": ["…"],
      "metric_snapshot": { "spend": 0, "ctr": 0, "leads": 0, "funded": 0 }
    }
  ]
}
Return at most 8 insights, ordered by impact. If there is no actionable signal, return an empty insights array.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    const body = await req.json().catch(() => ({}));
    const ads: AdRow[] = Array.isArray(body.ads) ? body.ads : [];
    const campaigns: CampaignRow[] = Array.isArray(body.campaigns) ? body.campaigns : [];
    const dateRange = body.dateRange || null;

    if (ads.length === 0 && campaigns.length === 0) {
      return new Response(
        JSON.stringify({ summary: "No ads or campaigns in scope.", insights: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const payload = summarize(ads, campaigns);

    const userMsg = `Date range: ${dateRange ? JSON.stringify(dateRange) : "last 30 days"}.
Ads (${payload.ads.length}) and campaigns (${payload.campaigns.length}) follow as JSON. Return JSON only.

CAMPAIGNS:
${JSON.stringify(payload.campaigns)}

ADS:
${JSON.stringify(payload.ads)}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached. Try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Lovable settings." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway ${aiResp.status}: ${txt}`);
    }

    const aiJson = await aiResp.json();
    const content = aiJson?.choices?.[0]?.message?.content || "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = { summary: "", insights: [] }; }
    if (!Array.isArray(parsed.insights)) parsed.insights = [];

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("ads-insights error:", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});