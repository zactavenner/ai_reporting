// Media Buyer (JEREMY) — reviews live Meta campaigns/ad sets/ads for a client
// and writes reviewable recommendations into meta_ad_recommendations.
// JEREMY never touches Meta: a human applies each recommendation explicitly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyDashboardToken, readDashboardToken } from "../_shared/dashboardToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dashboard-token",
};
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MIN_SPEND_FOR_ACTION = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function summarize(row: Record<string, unknown>, entityType: string) {
  const spend = num(row.spend);
  const leads = num(row.attributed_leads);
  const funded = num(row.attributed_funded);
  const fundedDollars = num(row.attributed_funded_dollars);
  return {
    entity_type: entityType,
    meta_entity_id: String(row.meta_campaign_id || row.meta_adset_id || row.meta_ad_id || ""),
    entity_name: String(row.name || "Unnamed"),
    status: String(row.effective_status || row.status || "UNKNOWN"),
    spend: Math.round(spend * 100) / 100,
    impressions: num(row.impressions),
    ctr: Math.round(num(row.ctr) * 100) / 100,
    cpm: Math.round(num(row.cpm) * 100) / 100,
    leads,
    spam_leads: num(row.attributed_spam_leads),
    calls: num(row.attributed_calls),
    showed: num(row.attributed_showed),
    funded,
    funded_dollars: Math.round(fundedDollars),
    cost_per_lead: leads ? Math.round((spend / leads) * 100) / 100 : null,
    cost_per_funded: funded ? Math.round((spend / funded) * 100) / 100 : null,
    funded_roas: spend ? Math.round((fundedDollars / spend) * 100) / 100 : null,
    daily_budget: row.daily_budget != null ? num(row.daily_budget) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const member = await verifyDashboardToken(readDashboardToken(req, body));
    if (!member) return json({ success: false, error: "Session expired — please sign in again." }, 401);

    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    if (!clientId) return json({ success: false, error: "client_id required" }, 400);

    const key = (Deno.env.get("OPENROUTER_API_KEY") || "").trim().replace(/^['"]|['"]$/g, "");
    if (!key.startsWith("sk-or-")) return json({ success: false, error: "OPENROUTER_API_KEY not configured" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: agent } = await supabase
      .from("agency_agents")
      .select("system_prompt, default_model, is_active")
      .eq("slug", "media_buyer_jeremy")
      .maybeSingle();
    if (!agent?.is_active) {
      return json({ success: false, error: "Media Buyer (JEREMY) is disabled — enable the agent first." }, 400);
    }

    const [{ data: campaigns }, { data: adsets }, { data: ads }, { data: client }] = await Promise.all([
      supabase.from("meta_campaigns").select("*").eq("client_id", clientId).order("spend", { ascending: false }).limit(25),
      supabase.from("meta_ad_sets").select("*").eq("client_id", clientId).order("spend", { ascending: false }).limit(40),
      supabase.from("meta_ads").select("*").eq("client_id", clientId).order("spend", { ascending: false }).limit(60),
      supabase.from("clients").select("name").eq("id", clientId).maybeSingle(),
    ]);

    const inventory = [
      ...(campaigns || []).map((r) => summarize(r as never, "campaign")),
      ...(adsets || []).map((r) => summarize(r as never, "adset")),
      ...(ads || []).map((r) => summarize(r as never, "ad")),
    ].filter((r) => r.meta_entity_id);

    if (!inventory.length) {
      return json({ success: false, error: "No synced Meta entities for this client yet — run an Ads sync first." }, 400);
    }

    const totalSpend = inventory.filter((i) => i.entity_type === "campaign").reduce((s, i) => s + i.spend, 0);
    const totalFunded = inventory.filter((i) => i.entity_type === "campaign").reduce((s, i) => s + i.funded, 0);

    const prompt = `Client: ${client?.name || clientId}
Portfolio spend (campaign level): $${Math.round(totalSpend)} | funded investors: ${totalFunded}

Entities (JSON):
${JSON.stringify(inventory, null, 1)}

Rules:
- Judge on funded outcomes and cost per funded first, cost per lead second, CTR/CPM third.
- Do NOT recommend pause/budget changes on entities with less than $${MIN_SPEND_FOR_ACTION} spend; use action "hold" and explain what data is still needed.
- A proven winner is >= $250 spend AND funded_roas >= 3. Recommend scaling those (adjust_budget upward, max +30% of current daily_budget).
- Only use meta_entity_id values that appear above.
- adjust_budget is only valid for campaign or adset, and proposed_daily_budget is in whole dollars.

Reply with STRICT JSON only:
{"health_score": 0-100, "summary": "2-3 sentences for the operator",
 "recommendations": [{"entity_type":"campaign|adset|ad","meta_entity_id":"...","entity_name":"...","action":"pause|resume|adjust_budget|hold","proposed_daily_budget":null,"reason":"specific, cite the numbers","confidence":0.0-1.0}]}
Maximum 12 recommendations, highest impact first.`;

    const aiRes = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: agent.default_model || "openrouter/owl-alpha",
        messages: [
          { role: "system", content: agent.system_prompt || "You are Media Buyer (JEREMY)." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });
    const aiBody = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) throw new Error(`Model call failed (${aiRes.status}): ${JSON.stringify(aiBody).slice(0, 300)}`);

    const raw = aiBody?.choices?.[0]?.message?.content || "";
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON");
    const parsed = JSON.parse(match[0]);

    const validIds = new Map(inventory.map((i) => [i.meta_entity_id, i]));
    const runId = crypto.randomUUID();
    const rows = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
      .slice(0, 12)
      .map((r: Record<string, unknown>) => {
        const entity = validIds.get(String(r.meta_entity_id));
        if (!entity) return null;
        let action = String(r.action || "hold");
        if (!["pause", "resume", "adjust_budget", "hold"].includes(action)) action = "hold";
        if (action !== "hold" && entity.spend < MIN_SPEND_FOR_ACTION) action = "hold";
        if (action === "adjust_budget" && entity.entity_type === "ad") action = "hold";
        const proposed = Number(r.proposed_daily_budget);
        return {
          client_id: clientId,
          run_id: runId,
          entity_type: entity.entity_type,
          entity_name: entity.entity_name,
          meta_entity_id: entity.meta_entity_id,
          action,
          reason: String(r.reason || "No reason supplied").slice(0, 2000),
          confidence: Math.min(1, Math.max(0, Number(r.confidence) || 0.5)),
          proposed_daily_budget: action === "adjust_budget" && Number.isFinite(proposed) && proposed >= 5 ? proposed : null,
          health_score: Math.min(100, Math.max(0, Math.round(Number(parsed.health_score) || 0))),
          summary: String(parsed.summary || "").slice(0, 2000),
          metrics_snapshot: entity,
          status: "pending",
        };
      })
      .filter(Boolean)
      .filter((r: Record<string, unknown>) => r.action !== "adjust_budget" || r.proposed_daily_budget != null);

    // Supersede the previous un-actioned batch so the queue never stacks stale advice.
    await supabase
      .from("meta_ad_recommendations")
      .update({ status: "acknowledged", decided_by: "superseded by newer review" })
      .eq("client_id", clientId)
      .eq("status", "pending");

    if (rows.length) {
      const { error: insertErr } = await supabase.from("meta_ad_recommendations").insert(rows);
      if (insertErr) throw new Error(`Could not save recommendations: ${insertErr.message}`);
    }

    return json({
      success: true,
      runId,
      healthScore: Math.min(100, Math.max(0, Math.round(Number(parsed.health_score) || 0))),
      summary: String(parsed.summary || ""),
      created: rows.length,
      reviewed: inventory.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("jeremy-media-buyer-review failed:", message);
    return json({ success: false, error: message }, 500);
  }
});