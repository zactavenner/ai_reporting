import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchAllRowsPaginated(supabase: any, table: string, select: string, filters: { column: string; op: string; value: any }[]): Promise<any[]> {
  const PAGE_SIZE = 1000;
  const all: any[] = [];
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    let query = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    for (const f of filters) {
      if (f.op === 'eq') query = query.eq(f.column, f.value);
      else if (f.op === 'gte') query = query.gte(f.column, f.value);
      else if (f.op === 'lte') query = query.lte(f.column, f.value);
    }
    const { data, error } = await query;
    if (error) { console.error(`Pagination error on ${table}:`, error); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    hasMore = data.length === PAGE_SIZE;
    from += PAGE_SIZE;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { clientId, startDate, endDate } = await req.json();
    if (!clientId) {
      return new Response(JSON.stringify({ success: false, error: "clientId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load per-client attribution config (UTM field mapping + window).
    // Saved by AttributionSettings UI under webhook_mappings.attribution.
    const { data: settingsRow } = await supabase
      .from("client_settings")
      .select("webhook_mappings")
      .eq("client_id", clientId)
      .maybeSingle();
    const attrCfg = (settingsRow?.webhook_mappings as any)?.attribution || {};
    const utmSourceField: string = attrCfg.utm_source_field || "utm_source";
    const utmMediumField: string = attrCfg.utm_medium_field || "utm_medium";
    const utmCampaignField: string = attrCfg.utm_campaign_field || "utm_campaign";
    const utmContentField: string = attrCfg.utm_content_field || "utm_content";
    const windowDays: number = Number(attrCfg.attribution_window_days) || 0;

    // If caller didn't supply a window and config has one, derive endDate=now, startDate=now-windowDays.
    let effStart = startDate;
    let effEnd = endDate;
    if (!effStart && !effEnd && windowDays > 0) {
      const end = new Date();
      const start = new Date(end.getTime() - windowDays * 86400000);
      effStart = start.toISOString().slice(0, 10);
      effEnd = end.toISOString().slice(0, 10);
    }
    const dateStart = effStart ? `${effStart}T00:00:00.000Z` : null;
    const dateEnd = effEnd ? `${effEnd}T23:59:59.999Z` : null;
    console.log(`Attribution config: window=${windowDays}d, utmFields=${utmSourceField}/${utmMediumField}/${utmCampaignField}/${utmContentField}, range=${dateStart}..${dateEnd}`);

    // 1. Get meta entities
    const { data: metaCampaigns } = await supabase.from("meta_campaigns").select("id, name, spend, meta_campaign_id").eq("client_id", clientId);
    const { data: metaAdSets } = await supabase.from("meta_ad_sets").select("id, name, spend, meta_adset_id").eq("client_id", clientId);
    const { data: metaAds } = await supabase.from("meta_ads").select("id, name, spend, ad_set_id, meta_ad_id, meta_adset_id").eq("client_id", clientId);

    if (!metaCampaigns?.length) {
      return new Response(JSON.stringify({ success: true, message: "No meta campaigns" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Get CRM data with pagination
    const leadFilters: { column: string; op: string; value: any }[] = [{ column: "client_id", op: "eq", value: clientId }];
    if (dateStart) leadFilters.push({ column: "created_at", op: "gte", value: dateStart });
    if (dateEnd) leadFilters.push({ column: "created_at", op: "lte", value: dateEnd });
    const leads = await fetchAllRowsPaginated(supabase, "leads", "id, campaign_name, ad_set_name, ad_id, is_spam, utm_source, utm_medium, utm_campaign, utm_content, source", leadFilters);

    const callFilters: { column: string; op: string; value: any }[] = [{ column: "client_id", op: "eq", value: clientId }];
    if (dateStart) callFilters.push({ column: "booked_at", op: "gte", value: dateStart });
    if (dateEnd) callFilters.push({ column: "booked_at", op: "lte", value: dateEnd });
    const calls = await fetchAllRowsPaginated(supabase, "calls", "id, lead_id, showed", callFilters);

    const fundedFilters: { column: string; op: string; value: any }[] = [{ column: "client_id", op: "eq", value: clientId }];
    if (dateStart) fundedFilters.push({ column: "funded_at", op: "gte", value: dateStart });
    if (dateEnd) fundedFilters.push({ column: "funded_at", op: "lte", value: dateEnd });
    const funded = await fetchAllRowsPaginated(supabase, "funded_investors", "id, lead_id, funded_amount, commitment_amount", fundedFilters);

    console.log(`Attribution: ${leads.length} leads, ${calls.length} calls, ${funded.length} funded`);

    // 3. Build lookup maps
    const callsByLead = new Map<string, { total: number; showed: number }>();
    for (const c of calls || []) {
      if (!c.lead_id) continue;
      const existing = callsByLead.get(c.lead_id) || { total: 0, showed: 0 };
      existing.total++;
      if (c.showed) existing.showed++;
      callsByLead.set(c.lead_id, existing);
    }

    const fundedByLead = new Map<string, { count: number; dollars: number }>();
    for (const f of funded || []) {
      if (!f.lead_id) continue;
      const existing = fundedByLead.get(f.lead_id) || { count: 0, dollars: 0 };
      existing.count++;
      existing.dollars += (Number(f.funded_amount) > 0) ? Number(f.funded_amount) : (Number(f.commitment_amount) || 0);
      fundedByLead.set(f.lead_id, existing);
    }

    // 4. Build entity maps
    const campaignByName = new Map<string, any>();
    const campaignByMetaId = new Map<string, any>();
    for (const c of metaCampaigns) {
      campaignByName.set(c.name, c);
      campaignByMetaId.set(c.meta_campaign_id, c);
    }

    const adSetByName = new Map<string, any>();
    for (const as of (metaAdSets || [])) adSetByName.set(as.name, as);

    const adsByAdSetId = new Map<string, any[]>();
    const metaAdByMetaId = new Map<string, any>();
    for (const ad of (metaAds || [])) {
      metaAdByMetaId.set(ad.meta_ad_id, ad);
      if (ad.ad_set_id) {
        const existing = adsByAdSetId.get(ad.ad_set_id) || [];
        existing.push(ad);
        adsByAdSetId.set(ad.ad_set_id, existing);
      }
    }

    // 5. Attribution loop
    type Stats = { leads: number; spamLeads: number; calls: number; showed: number; funded: number; fundedDollars: number };
    const campaignStats = new Map<string, Stats>();
    const adSetStats = new Map<string, Stats>();
    const adStats = new Map<string, Stats>();
    let unattributedCount = 0;

    function addStats(map: Map<string, Stats>, key: string, leadId: string, isSpam: boolean) {
      const stats = map.get(key) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
      if (isSpam) { stats.spamLeads++; } else { stats.leads++; }
      if (!isSpam) {
        const lc = callsByLead.get(leadId);
        if (lc) { stats.calls += lc.total; stats.showed += lc.showed; }
        const lf = fundedByLead.get(leadId);
        if (lf) { stats.funded += lf.count; stats.fundedDollars += lf.dollars; }
      }
      map.set(key, stats);
    }

    for (const lead of leads || []) {
      const isSpam = !!lead.is_spam;
      let attributed = false;

      // Campaign matching: campaign_name or utm_campaign
      const campaignName = lead.campaign_name || lead[utmCampaignField] || lead.utm_campaign;
      if (campaignName) {
        if (campaignByName.has(campaignName)) {
          addStats(campaignStats, campaignName, lead.id, isSpam);
          attributed = true;
        } else if (campaignByMetaId.has(campaignName)) {
          const mc = campaignByMetaId.get(campaignName);
          addStats(campaignStats, mc.name, lead.id, isSpam);
          attributed = true;
        }
      }

      // Ad set matching: ad_set_name or utm_medium
      // NOTE: utm_medium is commonly normalized to a platform name elsewhere
      // (e.g. "Facebook"), so prefer the configured field; only fall back to
      // utm_medium if it actually matches a known ad-set name.
      const cfgMedium = lead[utmMediumField];
      const adSetName = lead.ad_set_name || cfgMedium || lead.utm_medium;
      if (adSetName) {
        if (adSetByName.has(adSetName)) {
          addStats(adSetStats, adSetName, lead.id, isSpam);
          attributed = true;
        } else {
          const match = (metaAdSets || []).find((as: any) => as.meta_adset_id === adSetName);
          if (match) { addStats(adSetStats, match.name, lead.id, isSpam); attributed = true; }
        }
      }

      // Ad matching: ad_id or utm_content
      let matchedAdId: string | null = null;
      const adIdToMatch = lead.ad_id || lead[utmContentField] || lead.utm_content;
      if (adIdToMatch) {
        const directAd = metaAdByMetaId.get(adIdToMatch);
        if (directAd) matchedAdId = directAd.id;
        // Also try matching by ad name
        if (!matchedAdId) {
          const adByName = (metaAds || []).find((a: any) => a.name === adIdToMatch);
          if (adByName) matchedAdId = adByName.id;
        }
      }
      if (!matchedAdId && adSetName) {
        const matchedAdSet = adSetByName.get(adSetName) || (metaAdSets || []).find((as: any) => as.meta_adset_id === adSetName);
        if (matchedAdSet) {
          const adsInSet = adsByAdSetId.get(matchedAdSet.id) || [];
          if (adsInSet.length === 1) matchedAdId = adsInSet[0].id;
        }
      }
      if (matchedAdId) { addStats(adStats, matchedAdId, lead.id, isSpam); attributed = true; }

      if (!attributed && !isSpam) unattributedCount++;
    }

    console.log(`Attribution done: ${campaignStats.size} campaigns, ${adSetStats.size} ad sets, ${adStats.size} ads, ${unattributedCount} unattributed`);

    // ── Proportional fallback: distribute campaign-level attribution down to ad
    // sets and ads by spend share when sub-level UTMs are missing. ──
    function distribute(total: number, weights: number[]): number[] {
      const sum = weights.reduce((a, b) => a + b, 0);
      if (sum <= 0 || total <= 0) return weights.map(() => 0);
      const raw = weights.map(w => (w / sum) * total);
      const floored = raw.map(v => Math.floor(v));
      let remainder = Math.round(total - floored.reduce((a, b) => a + b, 0));
      const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
      for (const { i } of order) { if (remainder <= 0) break; floored[i]++; remainder--; }
      return floored;
    }

    const adSetsByCampaignId = new Map<string, any[]>();
    const campaignByDbId = new Map<string, any>();
    for (const c of metaCampaigns) campaignByDbId.set(c.id, c);
    // Need ad set -> campaign linkage; refetch with campaign_id
    const { data: adSetsWithCampaign } = await supabase
      .from("meta_ad_sets")
      .select("id, name, spend, campaign_id")
      .eq("client_id", clientId);
    for (const as of (adSetsWithCampaign || [])) {
      if (!as.campaign_id) continue;
      const arr = adSetsByCampaignId.get(as.campaign_id) || [];
      arr.push(as);
      adSetsByCampaignId.set(as.campaign_id, arr);
    }

    for (const campaign of metaCampaigns) {
      const cStats = campaignStats.get(campaign.name);
      if (!cStats) continue;
      const childAdSets = adSetsByCampaignId.get(campaign.id) || [];
      if (childAdSets.length === 0) continue;

      const direct = childAdSets.reduce((acc, as) => {
        const s = adSetStats.get(as.name);
        if (s) {
          acc.leads += s.leads; acc.spamLeads += s.spamLeads;
          acc.calls += s.calls; acc.showed += s.showed;
          acc.funded += s.funded; acc.fundedDollars += s.fundedDollars;
        }
        return acc;
      }, { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 });

      const rem = {
        leads: Math.max(0, cStats.leads - direct.leads),
        spamLeads: Math.max(0, cStats.spamLeads - direct.spamLeads),
        calls: Math.max(0, cStats.calls - direct.calls),
        showed: Math.max(0, cStats.showed - direct.showed),
        funded: Math.max(0, cStats.funded - direct.funded),
        fundedDollars: Math.max(0, cStats.fundedDollars - direct.fundedDollars),
      };
      const weights = childAdSets.map((as: any) => Number(as.spend) || 0);
      const totalChildSpend = weights.reduce((a, b) => a + b, 0);
      if (totalChildSpend <= 0) continue;

      const lD = distribute(rem.leads, weights);
      const sD = distribute(rem.spamLeads, weights);
      const cD = distribute(rem.calls, weights);
      const shD = distribute(rem.showed, weights);
      const fD = distribute(rem.funded, weights);

      childAdSets.forEach((as: any, idx: number) => {
        const ex = adSetStats.get(as.name) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
        ex.leads += lD[idx];
        ex.spamLeads += sD[idx];
        ex.calls += cD[idx];
        ex.showed += shD[idx];
        ex.funded += fD[idx];
        ex.fundedDollars += rem.fundedDollars * (weights[idx] / totalChildSpend);
        adSetStats.set(as.name, ex);
      });
    }

    for (const adSet of (metaAdSets || [])) {
      const asStats = adSetStats.get(adSet.name);
      if (!asStats) continue;
      const childAds = adsByAdSetId.get(adSet.id) || [];
      if (childAds.length === 0) continue;

      const direct = childAds.reduce((acc, ad) => {
        const s = adStats.get(ad.id);
        if (s) {
          acc.leads += s.leads; acc.spamLeads += s.spamLeads;
          acc.calls += s.calls; acc.showed += s.showed;
          acc.funded += s.funded; acc.fundedDollars += s.fundedDollars;
        }
        return acc;
      }, { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 });

      const rem = {
        leads: Math.max(0, asStats.leads - direct.leads),
        spamLeads: Math.max(0, asStats.spamLeads - direct.spamLeads),
        calls: Math.max(0, asStats.calls - direct.calls),
        showed: Math.max(0, asStats.showed - direct.showed),
        funded: Math.max(0, asStats.funded - direct.funded),
        fundedDollars: Math.max(0, asStats.fundedDollars - direct.fundedDollars),
      };
      const weights = childAds.map((ad: any) => Number(ad.spend) || 0);
      const totalChildSpend = weights.reduce((a, b) => a + b, 0);
      if (totalChildSpend <= 0) continue;

      const lD = distribute(rem.leads, weights);
      const sD = distribute(rem.spamLeads, weights);
      const cD = distribute(rem.calls, weights);
      const shD = distribute(rem.showed, weights);
      const fD = distribute(rem.funded, weights);

      childAds.forEach((ad: any, idx: number) => {
        const ex = adStats.get(ad.id) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
        ex.leads += lD[idx];
        ex.spamLeads += sD[idx];
        ex.calls += cD[idx];
        ex.showed += shD[idx];
        ex.funded += fD[idx];
        ex.fundedDollars += rem.fundedDollars * (weights[idx] / totalChildSpend);
        adStats.set(ad.id, ex);
      });
    }

    // 6. Batched writes — single upsert per table (one round-trip instead of N).
    // Upsert on PK (`id`) overwrites only the attribution columns we send;
    // all other columns are preserved by Postgres because the upsert payload
    // here also includes every other "owned" attribute (we only touch attributed_*
    // and cost_per_*). Falls back to chunked update via .in() if needed.
    const buildRow = (e: any, stats: any) => {
      const spend = Number(e.spend) || 0;
      return {
        id: e.id,
        attributed_leads: stats.leads,
        attributed_spam_leads: stats.spamLeads,
        attributed_calls: stats.calls,
        attributed_showed: stats.showed,
        attributed_funded: stats.funded,
        attributed_funded_dollars: stats.fundedDollars,
        cost_per_lead: stats.leads > 0 ? Math.round((spend / stats.leads) * 100) / 100 : 0,
        cost_per_call: stats.calls > 0 ? Math.round((spend / stats.calls) * 100) / 100 : 0,
        cost_per_funded: stats.funded > 0 ? Math.round((spend / stats.funded) * 100) / 100 : 0,
      };
    };
    const EMPTY = { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };

    // Use parallel chunked .update() to avoid clobbering non-attribution columns.
    // 50 rows per chunk × N parallel keeps round-trips ~10× lower than serial.
    async function flush(table: string, rows: any[]) {
      const CHUNK = 25;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        await Promise.all(chunk.map(r => {
          const { id, ...patch } = r;
          return supabase.from(table).update(patch).eq("id", id);
        }));
      }
    }

    const campaignRows = metaCampaigns.map(c => buildRow(c, campaignStats.get(c.name) || EMPTY));
    const adSetRows = (metaAdSets || []).map(s => buildRow(s, adSetStats.get(s.name) || EMPTY));
    const adRows = (metaAds || []).map(a => buildRow(a, adStats.get(a.id) || EMPTY));

    await Promise.all([
      flush("meta_campaigns", campaignRows),
      flush("meta_ad_sets", adSetRows),
      flush("meta_ads", adRows),
    ]);

    return new Response(JSON.stringify({
      success: true,
      campaignsAttributed: campaignStats.size,
      adSetsAttributed: adSetStats.size,
      adsAttributed: adStats.size,
      unattributed: unattributedCount,
      totalLeads: leads.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("run-attribution error:", error);
    return new Response(JSON.stringify({
      success: false, error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
