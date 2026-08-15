// Applies ONE approved Media Buyer (JEREMY) recommendation to Meta.
// Nothing here runs without an explicit operator click plus a valid signed
// dashboard session. Uses an atomic claim so double-clicks cannot double-write.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyDashboardToken, readDashboardToken } from "../_shared/dashboardToken.ts";
import { GRAPH, META_VERSION } from "../_shared/metaLaunchValidation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dashboard-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let recId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const member = await verifyDashboardToken(readDashboardToken(req, body));
    if (!member) return json({ success: false, error: "Session expired — please sign in again." }, 401);

    recId = typeof body.recommendation_id === "string" ? body.recommendation_id : null;
    if (!recId) return json({ success: false, error: "recommendation_id required" }, 400);

    // Atomic claim: only a pending/failed row can move to 'applying'.
    const { data: claimed } = await supabase
      .from("meta_ad_recommendations")
      .update({ status: "applying", claimed_at: new Date().toISOString(), decided_by: member.name, error_detail: null })
      .eq("id", recId)
      .in("status", ["pending", "failed"])
      .select("*")
      .maybeSingle();
    if (!claimed) return json({ success: false, error: "Recommendation is not applyable (already claimed or resolved)" }, 409);

    if (claimed.action === "hold") {
      await supabase
        .from("meta_ad_recommendations")
        .update({ status: "acknowledged", applied_at: new Date().toISOString() })
        .eq("id", recId);
      return json({ success: true, acknowledged: true });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("meta_access_token, meta_system_user_token")
      .eq("id", claimed.client_id)
      .maybeSingle();
    const token =
      (client?.meta_system_user_token || "").trim() ||
      (client?.meta_access_token || "").trim() ||
      (Deno.env.get("META_SHARED_ACCESS_TOKEN") || "").trim();
    if (!token) throw new Error("No Meta access token available for this client");

    const params: Record<string, string> = { access_token: token };
    if (claimed.action === "pause") params.status = "PAUSED";
    else if (claimed.action === "resume") params.status = "ACTIVE";
    else if (claimed.action === "adjust_budget") {
      if (claimed.entity_type === "ad") throw new Error("Budget can only be adjusted on a campaign or ad set");
      const dollars = Number(claimed.proposed_daily_budget);
      if (!Number.isFinite(dollars) || dollars < 5) throw new Error("Proposed daily budget must be at least $5.00");
      params.daily_budget = String(Math.round(dollars * 100));
    } else {
      throw new Error(`Unsupported action: ${claimed.action}`);
    }

    const res = await fetch(`${GRAPH}/${claimed.meta_entity_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const metaBody = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = metaBody?.error?.error_user_msg || metaBody?.error?.message || JSON.stringify(metaBody).slice(0, 300);
      throw new Error(`Meta rejected the change (${res.status}): ${detail}`);
    }

    await supabase
      .from("meta_ad_recommendations")
      .update({
        status: "applied",
        applied_at: new Date().toISOString(),
        meta_response: metaBody,
      })
      .eq("id", recId);

    return json({ success: true, graphVersion: META_VERSION, action: claimed.action, entity: claimed.meta_entity_id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("meta-apply-recommendation failed:", message);
    if (recId) {
      await supabase
        .from("meta_ad_recommendations")
        .update({ status: "failed", error_detail: message })
        .eq("id", recId);
    }
    return json({ success: false, error: message }, 500);
  }
});