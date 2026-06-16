import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Heuristic thresholds — tunable per client later
const MIN_SPEND_FOR_TAG = 50;
const WINNER_CPL_MULTIPLIER = 0.7; // CPL < 70% of account median
const FATIGUE_FREQUENCY = 3.5;
const UNDERPERFORM_CPL_MULTIPLIER = 1.5;
const EMERGING_DAYS = 7;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const clientId: string | undefined = body.client_id;

    const adQ = supabase
      .from("meta_ads")
      .select("id, meta_ad_id, client_id, spend, attributed_leads, attributed_funded_dollars, cost_per_lead, frequency, created_at, status")
      .gte("spend", MIN_SPEND_FOR_TAG);
    const { data: ads, error } = clientId
      ? await adQ.eq("client_id", clientId)
      : await adQ;
    if (error) throw error;

    // group by client to compute medians
    const byClient = new Map<string, any[]>();
    for (const a of ads || []) {
      if (!a.client_id) continue;
      if (!byClient.has(a.client_id)) byClient.set(a.client_id, []);
      byClient.get(a.client_id)!.push(a);
    }

    let tagged = 0;
    const upserts: any[] = [];

    for (const [clientIdKey, list] of byClient) {
      const cpls = list.map((a) => Number(a.cost_per_lead || 0)).filter((v) => v > 0).sort((x, y) => x - y);
      const median = cpls.length ? cpls[Math.floor(cpls.length / 2)] : 0;
      const now = Date.now();

      for (const ad of list) {
        const tags: { tag: string; score: number; reasons: any }[] = [];
        const cpl = Number(ad.cost_per_lead || 0);
        const freq = Number(ad.frequency || 0);
        const ageDays = (now - new Date(ad.created_at).getTime()) / 86400000;

        if (median > 0 && cpl > 0 && cpl <= median * WINNER_CPL_MULTIPLIER) {
          tags.push({ tag: "winner", score: median / cpl, reasons: { cpl, median } });
        }
        if (ageDays <= EMERGING_DAYS && cpl > 0 && cpl <= median * 1.0) {
          tags.push({ tag: "emerging", score: 1, reasons: { age_days: ageDays, cpl } });
        }
        if (freq >= FATIGUE_FREQUENCY) {
          tags.push({ tag: "fatigued", score: freq, reasons: { frequency: freq } });
        }
        if (median > 0 && cpl > 0 && cpl >= median * UNDERPERFORM_CPL_MULTIPLIER) {
          tags.push({ tag: "underperforming", score: cpl / median, reasons: { cpl, median } });
        }

        for (const t of tags) {
          upserts.push({
            client_id: clientIdKey,
            meta_ad_id: ad.meta_ad_id,
            tag: t.tag,
            source: "auto",
            score: t.score,
            reasons: t.reasons,
            computed_at: new Date().toISOString(),
          });
          tagged++;
        }
      }
    }

    if (upserts.length) {
      // chunk to avoid payload limits
      for (let i = 0; i < upserts.length; i += 500) {
        await supabase
          .from("meta_creative_tags")
          .upsert(upserts.slice(i, i + 500), { onConflict: "meta_ad_id,tag,source" });
      }
    }

    return new Response(JSON.stringify({ ok: true, tagged, clients: byClient.size }), {
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