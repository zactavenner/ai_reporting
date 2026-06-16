import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v21.0";

async function fetchAll(url: string, token: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | undefined = `${url}${url.includes("?") ? "&" : "?"}access_token=${token}`;
  let guard = 0;
  while (next && guard++ < 25) {
    const res = await fetch(next);
    if (!res.ok) {
      console.error("Meta error", res.status, await res.text());
      break;
    }
    const json: any = await res.json();
    if (Array.isArray(json.data)) out.push(...json.data);
    next = json.paging?.next;
  }
  return out;
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

    const q = supabase
      .from("clients")
      .select("id, name, meta_access_token, meta_ad_account_id")
      .eq("status", "active")
      .not("meta_ad_account_id", "is", null);
    const { data: clients, error } = clientId ? await q.eq("id", clientId) : await q;
    if (error) throw error;

    let totalForms = 0;
    const results: any[] = [];

    for (const client of clients || []) {
      const token = client.meta_access_token || Deno.env.get("META_SHARED_ACCESS_TOKEN");
      if (!token) continue;
      const acctId = client.meta_ad_account_id!.startsWith("act_")
        ? client.meta_ad_account_id!
        : `act_${client.meta_ad_account_id}`;

      // 1) Get pages on this ad account
      const pages = await fetchAll(
        `${GRAPH}/${acctId}/promote_pages?fields=id,name`,
        token,
      );

      let clientForms = 0;
      for (const page of pages) {
        const forms = await fetchAll(
          `${GRAPH}/${page.id}/leadgen_forms?fields=id,name,status,locale,questions,question_page_custom_headline,thank_you_page,privacy_policy_url,leads_count`,
          token,
        );
        for (const f of forms) {
          await supabase.from("meta_lead_forms").upsert(
            {
              client_id: client.id,
              meta_ad_account_id: acctId,
              meta_page_id: page.id,
              meta_form_id: f.id,
              name: f.name,
              status: f.status,
              locale: f.locale,
              questions: f.questions || [],
              thank_you_page: f.thank_you_page || {},
              privacy_policy_url: f.privacy_policy_url || null,
              leads_count: f.leads_count || 0,
              last_synced_at: new Date().toISOString(),
              raw: f,
            },
            { onConflict: "meta_form_id" },
          );
          clientForms++;
        }
      }
      totalForms += clientForms;
      results.push({ client_id: client.id, forms: clientForms });
    }

    return new Response(JSON.stringify({ ok: true, total: totalForms, results }), {
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