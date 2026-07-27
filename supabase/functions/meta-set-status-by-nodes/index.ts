// Flip Meta campaign/adset/ad status by Meta node IDs (no local row lookup).
// Used by the launch wizard's "Activate now" button, since freshly-created ads
// aren't in meta_ads yet.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const G = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { clientId, nodeIds, status } = await req.json() as {
      clientId: string; nodeIds: string[]; status: "ACTIVE" | "PAUSED";
    };
    if (!clientId || !Array.isArray(nodeIds) || !nodeIds.length || !status) {
      throw new Error("clientId, nodeIds[], status required");
    }
    if (!["ACTIVE", "PAUSED"].includes(status)) throw new Error("status must be ACTIVE or PAUSED");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client } = await supabase.from("clients")
      .select("meta_access_token").eq("id", clientId).single();
    const token = client?.meta_access_token || Deno.env.get("META_SHARED_ACCESS_TOKEN");
    if (!token) throw new Error("No Meta access token");

    const results: any[] = [];
    for (const id of nodeIds) {
      const r = await fetch(`${G}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ status, access_token: token }),
      });
      const j = await r.json().catch(() => ({}));
      results.push({ id, ok: r.ok, response: j });
      if (!r.ok) throw new Error(`Meta ${id} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    }

    // Update local cache for the campaign + adset (ads may not be synced yet)
    for (const id of nodeIds) {
      await supabase.from("meta_campaigns").update({ status, effective_status: status, updated_at: new Date().toISOString() })
        .eq("meta_campaign_id", id).eq("client_id", clientId);
      await supabase.from("meta_ad_sets").update({ status, effective_status: status, updated_at: new Date().toISOString() })
        .eq("meta_adset_id", id).eq("client_id", clientId);
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});