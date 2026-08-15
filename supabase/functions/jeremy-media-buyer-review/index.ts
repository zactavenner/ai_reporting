// Media Buyer (JEREMY) — operator endpoint for the funded-outcome review.
// The review logic itself lives in _shared/jeremyReview.ts so the automatic
// morning cadence and the internal MCP server run exactly the same code.
// JEREMY never touches Meta: a human applies each recommendation explicitly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyDashboardToken, readDashboardToken } from "../_shared/dashboardToken.ts";
import { runJeremyReview } from "../_shared/jeremyReview.ts";

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

  try {
    const body = await req.json().catch(() => ({}));
    const member = await verifyDashboardToken(readDashboardToken(req, body));
    if (!member) return json({ success: false, error: "Session expired — please sign in again." }, 401);

    const clientId = typeof body.client_id === "string" ? body.client_id : null;
    if (!clientId) return json({ success: false, error: "client_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const result = await runJeremyReview(supabase, clientId, `operator:${member.name}`);
    if (!result.success) return json(result, result.status ?? 400);
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("jeremy-media-buyer-review failed:", message);
    return json({ success: false, error: message }, 500);
  }
});