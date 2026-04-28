// Duplicates a Meta campaign, ad set, or ad using Meta's /copies endpoint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientId, level, rowId, newName, statusOption = "PAUSED" } = await req.json();
    if (!clientId || !level || !rowId) throw new Error("clientId, level, rowId required");
    if (!["campaign", "adset", "ad"].includes(level)) throw new Error("level must be campaign|adset|ad");

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

    const tableMap: Record<string, { table: string; id: string }> = {
      campaign: { table: "meta_campaigns", id: "meta_campaign_id" },
      adset:    { table: "meta_ad_sets",   id: "meta_adset_id" },
      ad:       { table: "meta_ads",       id: "meta_ad_id" },
    };
    const m = tableMap[level];
    const { data: row } = await supabase
      .from(m.table)
      .select(`id, name, ${m.id}`)
      .eq("id", rowId).eq("client_id", clientId).single();
    const metaId = (row as any)?.[m.id];
    if (!metaId) throw new Error(`${level} not found or missing Meta id`);

    const params = new URLSearchParams({
      access_token: accessToken,
      status_option: statusOption,
    });
    if (newName) params.set("rename_options", JSON.stringify({ rename_strategy: "NO_RENAME", rename_suffix: "" }));
    // Meta deep_copy is supported on campaign+adset
    if (level !== "ad") params.set("deep_copy", "true");

    const res = await fetch(`${META}/${metaId}/copies`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(`Meta copy failed: ${data?.error?.message || JSON.stringify(data)}`);
    }

    return new Response(JSON.stringify({
      success: true,
      copiedId: data.copied_campaign_id || data.copied_adset_id || data.copied_ad_id || data.id,
      raw: data,
      message: "Duplicated on Meta. Run a sync to pull the new object.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("duplicate-meta-object error", e);
    return new Response(JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});