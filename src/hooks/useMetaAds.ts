import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fetchAllRows } from '@/lib/fetchAllRows';

// ─────────────────────────────────────────────────────────────────────────────
// Date-range aggregation from meta_ad_daily_insights.
// The base tables (meta_campaigns / meta_ad_sets / meta_ads) store the
// snapshot from the LAST sync range, not the user-selected date filter. To
// keep numbers matching Meta Ads Manager for the current date filter, we
// aggregate per-day insights across the range and overlay them on each row.
// ─────────────────────────────────────────────────────────────────────────────

type DailyRow = {
  date?: string;
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  reach: number | null;
  leads: number | null;
};

export type MetaDailyPoint = {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  leads: number;
};

export type MetaDailySummary = Agg & {
  daily: MetaDailyPoint[];
  hasData: boolean;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  costPerLead: number;
};

type Agg = {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  leads: number;
};

const emptyAgg = (): Agg => ({ spend: 0, impressions: 0, clicks: 0, reach: 0, leads: 0 });

function addToAgg(a: Agg, r: DailyRow) {
  a.spend += Number(r.spend) || 0;
  a.impressions += Number(r.impressions) || 0;
  a.clicks += Number(r.clicks) || 0;
  a.reach += Number(r.reach) || 0;
  a.leads += Number(r.leads) || 0;
}

function deriveMetrics(a: Agg) {
  const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
  const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
  const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
  const frequency = a.reach > 0 ? a.impressions / a.reach : 0;
  const cost_per_lead = a.leads > 0 ? a.spend / a.leads : 0;
  return {
    spend: a.spend,
    impressions: a.impressions,
    clicks: a.clicks,
    reach: a.reach,
    frequency,
    ctr,
    cpc,
    cpm,
    meta_reported_leads: a.leads,
    cost_per_lead,
  };
}

async function fetchDailyAggregates(
  clientId: string,
  startDate: string,
  endDate: string,
): Promise<{
  byAd: Map<string, Agg>;
  byAdset: Map<string, Agg>;
  byCampaign: Map<string, Agg>;
}> {
  const rows = await fetchAllRows((sb) =>
    sb
      .from('meta_ad_daily_insights')
      .select('meta_ad_id,meta_adset_id,meta_campaign_id,spend,impressions,clicks,reach,leads')
      .eq('client_id', clientId)
      .gte('date', startDate)
      .lte('date', endDate),
  );
  const byAd = new Map<string, Agg>();
  const byAdset = new Map<string, Agg>();
  const byCampaign = new Map<string, Agg>();
  for (const raw of (rows || []) as DailyRow[]) {
    if (raw.meta_ad_id) {
      let g = byAd.get(raw.meta_ad_id);
      if (!g) { g = emptyAgg(); byAd.set(raw.meta_ad_id, g); }
      addToAgg(g, raw);
    }
    if (raw.meta_adset_id) {
      let g = byAdset.get(raw.meta_adset_id);
      if (!g) { g = emptyAgg(); byAdset.set(raw.meta_adset_id, g); }
      addToAgg(g, raw);
    }
    if (raw.meta_campaign_id) {
      let g = byCampaign.get(raw.meta_campaign_id);
      if (!g) { g = emptyAgg(); byCampaign.set(raw.meta_campaign_id, g); }
      addToAgg(g, raw);
    }
  }
  return { byAd, byAdset, byCampaign };
}

async function fetchDailyRows(clientId: string, startDate: string, endDate: string): Promise<DailyRow[]> {
  return await fetchAllRows<DailyRow>((sb) =>
    sb
      .from('meta_ad_daily_insights')
      .select('date,meta_ad_id,meta_adset_id,meta_campaign_id,spend,impressions,clicks,reach,leads')
      .eq('client_id', clientId)
      .gte('date', startDate)
      .lte('date', endDate),
  );
}

function normalizeMetaLeadMetrics<T extends Record<string, any>>(row: T): T {
  const spend = Number(row.spend) || 0;
  const metaLeads = Number(row.meta_reported_leads) || 0;
  return {
    ...row,
    cost_per_lead: metaLeads > 0 ? spend / metaLeads : 0,
  };
}

function applyMetaAggregate<T extends Record<string, any>>(row: T, agg: Agg): T {
  return normalizeMetaLeadMetrics({ ...row, ...deriveMetrics(agg) });
}

export function useMetaDailySummary(clientId: string | undefined, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['meta-daily-summary', clientId, startDate ?? null, endDate ?? null],
    queryFn: async (): Promise<MetaDailySummary> => {
      if (!clientId || !startDate || !endDate) {
        return { ...emptyAgg(), daily: [], hasData: false, ctr: 0, cpc: 0, cpm: 0, frequency: 0, costPerLead: 0 };
      }
      const rows = await fetchDailyRows(clientId, startDate, endDate);
      const total = emptyAgg();
      const byDate = new Map<string, Agg>();
      for (const row of rows) {
        addToAgg(total, row);
        const date = row.date;
        if (!date) continue;
        let day = byDate.get(date);
        if (!day) { day = emptyAgg(); byDate.set(date, day); }
        addToAgg(day, row);
      }
      const derived = deriveMetrics(total);
      const daily = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, agg]) => ({ date, ...agg }));
      return {
        ...total,
        daily,
        hasData: rows.length > 0,
        ctr: derived.ctr,
        cpc: derived.cpc,
        cpm: derived.cpm,
        frequency: derived.frequency,
        costPerLead: derived.cost_per_lead,
      };
    },
    enabled: !!clientId && !!startDate && !!endDate,
  });
}

export function useMetaCampaigns(clientId: string | undefined, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['meta-campaigns', clientId, startDate ?? null, endDate ?? null],
    queryFn: async () => {
      if (!clientId) return [];
      const base = await fetchAllRows((sb) =>
        sb.from('meta_campaigns')
          .select('*')
          .eq('client_id', clientId)
          .order('spend', { ascending: false })
      );
      if (!startDate || !endDate) return base.map(normalizeMetaLeadMetrics);
      const { byCampaign } = await fetchDailyAggregates(clientId, startDate, endDate);
      if (byCampaign.size === 0) return base.map(normalizeMetaLeadMetrics);
      return base.map((c: any) => {
        const agg = byCampaign.get(c.meta_campaign_id) || emptyAgg();
        return applyMetaAggregate(c, agg);
      });
    },
    enabled: !!clientId,
  });
}

export function useMetaAdSets(clientId: string | undefined, campaignId?: string, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['meta-ad-sets', clientId, campaignId, startDate ?? null, endDate ?? null],
    queryFn: async () => {
      if (!clientId) return [];
      const base = await fetchAllRows((sb) => {
        let query = sb
          .from('meta_ad_sets')
          .select('*')
          .eq('client_id', clientId)
          .order('spend', { ascending: false });
        if (campaignId) {
          query = query.eq('campaign_id', campaignId);
        }
        return query;
      });
      if (!startDate || !endDate) return base.map(normalizeMetaLeadMetrics);
      const { byAdset } = await fetchDailyAggregates(clientId, startDate, endDate);
      if (byAdset.size === 0) return base.map(normalizeMetaLeadMetrics);
      return base.map((r: any) => {
        const key = r.meta_adset_id || r.meta_ad_set_id;
        const agg = (key && byAdset.get(key)) || emptyAgg();
        return applyMetaAggregate(r, agg);
      });
    },
    enabled: !!clientId,
  });
}

export function useMetaAds(clientId: string | undefined, adSetId?: string, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['meta-ads', clientId, adSetId, startDate ?? null, endDate ?? null],
    queryFn: async () => {
      if (!clientId) return [];
      const base = await fetchAllRows((sb) => {
        let query = sb
          .from('meta_ads')
          .select('*')
          .eq('client_id', clientId)
          .order('spend', { ascending: false });
        if (adSetId) {
          query = query.eq('ad_set_id', adSetId);
        }
        return query;
      });
      if (!startDate || !endDate) return base.map(normalizeMetaLeadMetrics);
      const { byAd } = await fetchDailyAggregates(clientId, startDate, endDate);
      if (byAd.size === 0) return base.map(normalizeMetaLeadMetrics);
      return base.map((r: any) => {
        const agg = (r.meta_ad_id && byAd.get(r.meta_ad_id)) || emptyAgg();
        return applyMetaAggregate(r, agg);
      });
    },
    enabled: !!clientId,
  });
}

export function useSyncMetaAds() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, startDate, endDate }: { clientId: string; startDate?: string; endDate?: string }) => {
      const { data, error } = await supabase.functions.invoke('sync-meta-ads', {
        body: { clientId, startDate, endDate },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Sync failed');
      return data;
    },
    onSuccess: (data, { clientId }) => {
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns', clientId] });
      queryClient.invalidateQueries({ queryKey: ['meta-ad-sets', clientId] });
      queryClient.invalidateQueries({ queryKey: ['meta-ads', clientId] });
      queryClient.invalidateQueries({ queryKey: ['meta-daily-summary', clientId] });
      queryClient.invalidateQueries({ queryKey: ['top-creative', clientId] });
      queryClient.invalidateQueries({ queryKey: ['sheet-metrics', clientId] });
      toast.success(`Synced ${data.campaigns} campaigns, ${data.adSets} ad sets, ${data.ads} ads (${data.metaApiCalls} API calls)`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to sync Meta Ads');
    },
  });
}

export function useToggleMetaStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId, level, rowId, status,
    }: {
      clientId: string;
      level: 'campaign' | 'adset' | 'ad';
      rowId: string;
      status: 'ACTIVE' | 'PAUSED';
    }) => {
      const { data, error } = await supabase.functions.invoke('toggle-meta-status', {
        body: { clientId, level, rowId, status },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Toggle failed');
      return data;
    },
    onMutate: async ({ clientId, level, rowId, status }) => {
      const keyMap = {
        campaign: ['meta-campaigns', clientId],
        adset: ['meta-ad-sets', clientId],
        ad: ['meta-ads', clientId],
      } as const;
      const baseKey = keyMap[level];
      await queryClient.cancelQueries({ queryKey: baseKey });
      const snapshots = queryClient.getQueriesData({ queryKey: baseKey });
      queryClient.setQueriesData({ queryKey: baseKey }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((r: any) => r.id === rowId ? { ...r, status, effective_status: status } : r);
      });
      return { snapshots };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.snapshots) ctx.snapshots.forEach(([key, data]) => queryClient.setQueryData(key as any, data));
      toast.error(error instanceof Error ? error.message : 'Failed to toggle status');
    },
    onSuccess: (_d, { status }) => {
      toast.success(status === 'ACTIVE' ? 'Resumed on Meta' : 'Paused on Meta');
    },
    onSettled: (_d, _e, { clientId, level }) => {
      const keyMap = {
        campaign: ['meta-campaigns', clientId],
        adset: ['meta-ad-sets', clientId],
        ad: ['meta-ads', clientId],
      } as const;
      queryClient.invalidateQueries({ queryKey: keyMap[level] });
    },
  });
}
