// Updates the daily or lifetime budget of a Meta campaign or ad set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientId, level, rowId, dailyBudgetCents, lifetimeBudgetCents } = await req.json();
    if (!clientId || !level || !rowId) throw new Error("clientId, level, rowId required");
    if (!dailyBudgetCents && !lifetimeBudgetCents) throw new Error("dailyBudgetCents or lifetimeBudgetCents required");
    if (!["campaign", "adset"].includes(level)) throw new Error("level must be campaign or adset");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: client } = await supabase
      .from("clients")
      .select("meta_access_token")
      .eq("id", clientId).single();
    const accessToken = client?.meta_access_token || Deno.env.get("META_SHARED_ACCESS_TOKEN");
    if (!accessToken) throw new Error("No Meta access token");

    const table = level === "campaign" ? "meta_campaigns" : "meta_ad_sets";
    const idField = level === "campaign" ? "meta_campaign_id" : "meta_adset_id";

    const { data: row } = await supabase
      .from(table)
      .select(`id, ${idField}`)
      .eq("id", rowId)
      .eq("client_id", clientId)
      .single();
    const metaId = (row as any)?.[idField];
    if (!metaId) throw new Error(`${level} not found or missing Meta id`);

    const params = new URLSearchParams({ access_token: accessToken });
    if (dailyBudgetCents) params.set("daily_budget", String(dailyBudgetCents));
    if (lifetimeBudgetCents) params.set("lifetime_budget", String(lifetimeBudgetCents));

    const res = await fetch(`${META}/${metaId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`Meta budget update failed: ${data?.error?.message || JSON.stringify(data)}`);
    }

    // Mirror locally (stored as dollars, not cents)
    const local: any = {};
    if (dailyBudgetCents) local.daily_budget = Number(dailyBudgetCents) / 100;
    if (lifetimeBudgetCents) local.lifetime_budget = Number(lifetimeBudgetCents) / 100;
    await supabase.from(table).update(local).eq("id", rowId);

    return new Response(JSON.stringify({ success: true, message: "Budget updated on Meta" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("update-meta-budget error", e);
    return new Response(JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});