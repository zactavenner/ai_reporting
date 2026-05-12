import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fetchAllRows } from '@/lib/fetchAllRows';

export function useMetaCampaigns(clientId: string | undefined) {
  return useQuery({
    queryKey: ['meta-campaigns', clientId],
    queryFn: async () => {
      if (!clientId) return [];
      return await fetchAllRows((sb) =>
        sb.from('meta_campaigns')
          .select('*')
          .eq('client_id', clientId)
          .order('spend', { ascending: false })
      );
    },
    enabled: !!clientId,
  });
}

export function useMetaAdSets(clientId: string | undefined, campaignId?: string) {
  return useQuery({
    queryKey: ['meta-ad-sets', clientId, campaignId],
    queryFn: async () => {
      if (!clientId) return [];
      return await fetchAllRows((sb) => {
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
    },
    enabled: !!clientId,
  });
}

export function useMetaAds(clientId: string | undefined, adSetId?: string) {
  return useQuery({
    queryKey: ['meta-ads', clientId, adSetId],
    queryFn: async () => {
      if (!clientId) return [];
      return await fetchAllRows((sb) => {
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
