import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Creative Performance Loop — scale winners, retire losers.
 *
 * The existing cpl-creative-trigger reacts to BAD performance (high CPL → new creative).
 * This function closes the other half of the loop: it finds the BEST performers
 * and generates variations of what's already working.
 *
 * Loop per client:
 *   1. Rank ads by revenue attribution (attributed_funded_dollars / ROAS from meta_ads,
 *      falling back to CPL when no funded data exists yet)
 *   2. Winners = top ads meeting thresholds (min spend, min ROAS or CPL under target)
 *   3. Losers  = ads with spend above threshold and zero results
 *   4. For each winner: call generate-ad-variations (existing function) to produce
 *      static + video variant briefs based on the winning creative
 *   5. For each loser: queue a pause_ad proposal in agent_actions (approval_slack tier)
 *   6. Everything is logged; nothing launches or pauses without going through
 *      the agent_actions approval flow.
 *
 * Body: { clientId?, minSpend?, minRoas?, maxWinners?, dryRun? }
 * Called from daily-master-sync (Step 5c) or on-demand from the dashboard.
 */

interface AdPerformance {
  id: string;
  meta_ad_id: string;
  meta_campaign_id: string | null;
  name: string;
  spend: number;
  attributed_leads: number;
  attributed_funded: number;
  attributed_funded_dollars: number;
  cost_per_lead: number;
  image_url: string | null;
  video_source_url: string | null;
  media_type: string | null;
  status: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      clientId = null,
      minSpend = 500,       // don't judge ads under $500 spend
      minRoas = 2.0,        // winner threshold when funded data exists
      maxWinners = 3,       // cap variant generation per client per run
      dryRun = false,
    } = body;

    // Clients to process
    let clientsQuery = supabase.from("clients")
      .select("id, name, cpl_target:client_settings(cpl_threshold_yellow)")
      .in("status", ["active", "onboarding"]);
    if (clientId) clientsQuery = clientsQuery.eq("id", clientId);
    const { data: clients, error: clientErr } = await clientsQuery;
    if (clientErr || !clients) throw new Error(`Failed to fetch clients: ${clientErr?.message}`);

    const results: any[] = [];

    for (const client of clients) {
      try {
        // 1. Fetch active ads with meaningful spend
        const { data: ads, error: adsErr } = await supabase
          .from("meta_ads")
          .select("id, meta_ad_id, meta_campaign_id, name, spend, attributed_leads, attributed_funded, attributed_funded_dollars, cost_per_lead, image_url, video_source_url, media_type, status")
          .eq("client_id", client.id)
          .gte("spend", minSpend);
        if (adsErr) throw new Error(`Failed to fetch ads: ${adsErr.message}`);

        const perf = (ads || []) as AdPerformance[];
        if (perf.length === 0) {
          results.push({ client: client.name, skipped: true, reason: `no ads with spend >= $${minSpend}` });
          continue;
        }

        const cplTarget = Number((client as any).cpl_target?.[0]?.cpl_threshold_yellow) || 50;

        // 2. Score: ROAS when funded data exists, else inverse CPL
        const scored = perf.map(ad => {
          const roas = ad.spend > 0 ? (Number(ad.attributed_funded_dollars) || 0) / ad.spend : 0;
          const cpl = Number(ad.cost_per_lead) || 0;
          const hasFunded = (Number(ad.attributed_funded_dollars) || 0) > 0;
          const isWinner = hasFunded ? roas >= minRoas : (cpl > 0 && cpl <= cplTarget);
          const isLoser = ad.status === "ACTIVE"
            && ad.spend >= minSpend * 2
            && (Number(ad.attributed_leads) || 0) === 0
            && !hasFunded;
          return { ad, roas, cpl, isWinner, isLoser };
        });

        const winners = scored.filter(s => s.isWinner)
          .sort((a, b) => b.roas - a.roas || a.cpl - b.cpl)
          .slice(0, maxWinners);
        const losers = scored.filter(s => s.isLoser);

        let variantsQueued = 0;
        let pausesProposed = 0;

        // 3. Generate variants of winners (via existing generate-ad-variations)
        for (const w of winners) {
          if (dryRun) { variantsQueued++; continue; }
          try {
            const res = await fetch(`${supabaseUrl}/functions/v1/generate-ad-variations`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseKey}` },
              body: JSON.stringify({
                clientId: client.id,
                sourceAdId: w.ad.meta_ad_id,
                sourceName: w.ad.name,
                sourceImageUrl: w.ad.image_url,
                sourceVideoUrl: w.ad.video_source_url,
                mediaType: w.ad.media_type,
                reason: `Top performer: ROAS ${w.roas.toFixed(2)}x, CPL $${w.cpl.toFixed(2)}. Generating scale variants.`,
              }),
            });
            const ok = res.ok;
            // Log the generation as an executed auto action
            await supabase.from("agent_actions").insert({
              client_id: client.id,
              action_type: "create_creative",
              action_label: `Generate variants of winning ad "${w.ad.name}" (ROAS ${w.roas.toFixed(2)}x)`,
              approval_tier: "auto",
              status: ok ? "executed" : "failed",
              executed_at: new Date().toISOString(),
              executed_by: "creative-loop",
              reasoning: `Ad has $${w.ad.spend.toFixed(0)} spend with ${w.roas > 0 ? `${w.roas.toFixed(2)}x ROAS` : `$${w.cpl.toFixed(2)} CPL (target $${cplTarget})`} — scaling what works.`,
              confidence: Math.min(0.95, 0.5 + w.roas / 10),
              metadata: { source_ad_id: w.ad.meta_ad_id, roas: w.roas, cpl: w.cpl },
            });
            if (ok) variantsQueued++;
          } catch (genErr) {
            console.warn(`[creative-loop] Variant generation failed for ${w.ad.name}:`, genErr);
          }
        }

        // 4. Propose pausing losers (approval required — goes to pending queue)
        for (const l of losers) {
          if (dryRun) { pausesProposed++; continue; }
          const { error: propErr } = await supabase.from("agent_actions").insert({
            client_id: client.id,
            action_type: "pause_ad",
            action_label: `Pause underperformer "${l.ad.name}" ($${l.ad.spend.toFixed(0)} spent, 0 leads)`,
            approval_tier: "approval_slack",
            status: "pending",
            before_state: { status: l.ad.status, spend: l.ad.spend, leads: l.ad.attributed_leads },
            rollback_payload: { operation: "enable_ad", params: { adId: l.ad.meta_ad_id } },
            executed_by: "creative-loop",
            reasoning: `Ad spent $${l.ad.spend.toFixed(0)} (>2x the $${minSpend} evaluation threshold) with zero attributed leads or funded dollars. Recommend pausing and reallocating budget to winners.`,
            confidence: 0.85,
            metadata: { operation: "pause_ad", params: { adId: l.ad.meta_ad_id } },
          });
          if (!propErr) pausesProposed++;
        }

        results.push({
          client: client.name,
          adsEvaluated: perf.length,
          winners: winners.map(w => ({ name: w.ad.name, roas: Number(w.roas.toFixed(2)), cpl: Number(w.cpl.toFixed(2)) })),
          losers: losers.map(l => ({ name: l.ad.name, spend: l.ad.spend })),
          variantsQueued,
          pausesProposed,
          dryRun,
        });

        // Observability
        await supabase.from("sync_runs").insert({
          client_id: client.id,
          source: "reconciliation",
          function_name: "creative-loop",
          finished_at: new Date().toISOString(),
          status: "success",
          rows_written: variantsQueued + pausesProposed,
          metadata: { winners: winners.length, losers: losers.length, dryRun },
        }).then(() => {});
      } catch (clientErr2) {
        const msg = clientErr2 instanceof Error ? clientErr2.message : "Unknown error";
        console.error(`[creative-loop] ${client.name} failed:`, msg);
        results.push({ client: client.name, error: msg });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[creative-loop] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
