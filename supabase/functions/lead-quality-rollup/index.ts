// Nightly rollup: per client + meta_ad_id, computes 7d/30d qualified/bad/booked/funded
// rates from lead_dispositions joined against leads.ad_id. Upserts ad_lead_quality.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QUALIFIED = new Set(["qualified", "booked", "showed", "opportunity", "funded"]);
const BAD = new Set(["bad_lead", "bad_contact_info", "unqualified", "not_accredited"]);
const BOOKED = new Set(["booked", "showed", "opportunity", "funded"]);
const FUNDED = new Set(["funded"]);

async function rollupWindow(sb: any, days: number, dateStr: string) {
  const start = new Date(Date.now() - days * 86400_000).toISOString();

  // Pull leads with an ad_id created in window with their latest disposition
  const { data: leads, error } = await sb
    .from("leads")
    .select("id, client_id, ad_id, current_disposition, created_at")
    .gte("created_at", start)
    .not("ad_id", "is", null)
    .not("client_id", "is", null)
    .limit(50000);
  if (error) throw new Error(error.message);

  type Bucket = { client_id: string; meta_ad_id: string; leads: number; qualified: number; bad: number; booked: number; funded: number };
  const map = new Map<string, Bucket>();
  for (const l of leads ?? []) {
    const key = `${l.client_id}::${l.ad_id}`;
    const b = map.get(key) ?? { client_id: l.client_id, meta_ad_id: l.ad_id, leads: 0, qualified: 0, bad: 0, booked: 0, funded: 0 };
    b.leads++;
    const d = l.current_disposition ?? "";
    if (QUALIFIED.has(d)) b.qualified++;
    if (BAD.has(d)) b.bad++;
    if (BOOKED.has(d)) b.booked++;
    if (FUNDED.has(d)) b.funded++;
    map.set(key, b);
  }

  const rows = [...map.values()].map((b) => ({
    client_id: b.client_id,
    meta_ad_id: b.meta_ad_id,
    window_size: `${days}d`,
    date: dateStr,
    leads: b.leads,
    qualified: b.qualified,
    qualified_rate: b.leads > 0 ? Number(((b.qualified / b.leads) * 100).toFixed(2)) : 0,
    bad_rate: b.leads > 0 ? Number(((b.bad / b.leads) * 100).toFixed(2)) : 0,
    booked_rate: b.leads > 0 ? Number(((b.booked / b.leads) * 100).toFixed(2)) : 0,
    funded: b.funded,
  }));

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error: uErr } = await sb.from("ad_lead_quality").upsert(chunk, { onConflict: "meta_ad_id,window_size,date" });
    if (uErr) throw new Error(uErr.message);
    written += chunk.length;
  }
  return { rows: written, leads_considered: leads?.length ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const dateStr = new Date().toISOString().slice(0, 10);

  try {
    const r7 = await rollupWindow(sb, 7, dateStr);
    const r30 = await rollupWindow(sb, 30, dateStr);
    return new Response(JSON.stringify({ success: true, date: dateStr, "7d": r7, "30d": r30 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});