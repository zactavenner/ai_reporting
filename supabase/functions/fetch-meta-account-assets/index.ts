// Fetches Pages, Pixels, and Instagram actors available to a Meta ad account
// and caches them in meta_ad_accounts so create-campaign / create-ad dialogs
// can populate dropdowns instead of asking users to paste IDs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_GRAPH_API_VERSION = "v21.0";
const META = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

async function safeJson(res: Response) {
  try { return await res.json(); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { clientId, adAccountId: explicitAcct } = await req.json();
    if (!clientId) throw new Error("clientId required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: client } = await supabase
      .from("clients")
      .select("meta_access_token, meta_ad_account_id, meta_ad_account_ids, name")
      .eq("id", clientId).single();

    if (!client) throw new Error("Client not found");
    const accessToken = client.meta_access_token || Deno.env.get("META_SHARED_ACCESS_TOKEN");
    if (!accessToken) throw new Error("No Meta access token");

    const accounts: string[] = [];
    if (explicitAcct) accounts.push(String(explicitAcct).replace(/^act_/, ""));
    else {
      if (client.meta_ad_account_id) accounts.push(String(client.meta_ad_account_id).replace(/^act_/, ""));
      const extras: string[] = Array.isArray(client.meta_ad_account_ids) ? client.meta_ad_account_ids : [];
      extras.forEach((a) => a && accounts.push(String(a).replace(/^act_/, "")));
    }
    if (accounts.length === 0) throw new Error("Client has no Meta ad accounts configured");

    const results: any[] = [];
    for (const accId of Array.from(new Set(accounts))) {
      const actId = `act_${accId}`;

      // Pages: promote_pages (account-level page access)
      const pagesRes = await fetch(
        `${META}/${actId}/promote_pages?fields=id,name,access_token,picture&access_token=${accessToken}`
      );
      const pagesData = await safeJson(pagesRes);
      const pages = (pagesData?.data || []).map((p: any) => ({
        id: p.id, name: p.name, picture: p.picture?.data?.url || null,
      }));

      // Pixels
      const pixelsRes = await fetch(
        `${META}/${actId}/adspixels?fields=id,name,last_fired_time&access_token=${accessToken}`
      );
      const pixelsData = await safeJson(pixelsRes);
      const pixels = (pixelsData?.data || []).map((p: any) => ({
        id: p.id, name: p.name, last_fired_time: p.last_fired_time || null,
      }));

      // Instagram actors
      const igRes = await fetch(
        `${META}/${actId}/instagram_accounts?fields=id,username&access_token=${accessToken}`
      );
      const igData = await safeJson(igRes);
      const instagram_actors = (igData?.data || []).map((a: any) => ({
        id: a.id, username: a.username || null,
      }));

      // Get account name if missing
      let account_name: string | null = null;
      const accRes = await fetch(`${META}/${actId}?fields=name&access_token=${accessToken}`);
      const accData = await safeJson(accRes);
      account_name = accData?.name || null;

      const row: any = {
        ad_account_id: accId,
        pages,
        pixels,
        instagram_actors,
        assets_synced_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      };
      if (account_name) row.account_name = account_name;

      const { error: upErr } = await supabase
        .from("meta_ad_accounts")
        .upsert(row, { onConflict: "ad_account_id" });
      if (upErr) console.error("upsert", upErr);

      results.push({ adAccountId: accId, pages: pages.length, pixels: pixels.length, instagram_actors: instagram_actors.length });
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fetch-meta-account-assets error", e);
    return new Response(JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});