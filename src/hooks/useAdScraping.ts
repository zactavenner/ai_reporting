import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ScrapedAd {
  id: string;
  client_id: string | null;
  source: string | null;
  advertiser_name: string | null;
  ad_id: string | null;
  headline: string | null;
  body: string | null;
  description: string | null;
  image_url: string | null;
  video_url: string | null;
  platform: string | null;
  start_date: string | null;
  end_date: string | null;
  impressions_range: string | null;
  spend_range: string | null;
  tags: string[];
  is_swipe_file: boolean;
  metadata: any;
  scraped_at: string | null;
  created_at: string;
  iterated: boolean;
  selected: boolean;
  company: string | null;
  ad_format: string | null;
  status: string | null;
  category: string | null;
  saves: number;
  views: number;
  source_url: string | null;
  reach: number;
  ad_count: number;
  monitoring_target_id: string | null;
}

export interface MonitoringTarget {
  id: string;
  advertiser_name: string;
  page_id: string | null;
  platform: string | null;
  is_active: boolean;
  created_at: string;
  last_scraped_at: string | null;
  type: string | null;
  value: string | null;
  client_id: string | null;
}

export function useScrapedAds(opts?: { clientId?: string | null; limit?: number }) {
  const clientId = opts?.clientId ?? null;
  // PostgREST default cap is 1000; bump explicitly so we don't silently
  // truncate large libraries. Callers can override per surface.
  const limit = opts?.limit ?? 5000;
  return useQuery({
    queryKey: ['scraped-ads', clientId, limit],
    queryFn: async () => {
      let q = supabase
        .from('scraped_ads')
        .select('*')
        .order('scraped_at', { ascending: false })
        .limit(limit);
      if (clientId) q = q.eq('client_id', clientId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as ScrapedAd[];
    },
  });
}

export function useMonitoringTargets() {
  return useQuery({
    queryKey: ['monitoring-targets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('monitoring_targets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as MonitoringTarget[];
    },
  });
}

export function useStartTracking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ advertiser_name, page_id }: { advertiser_name: string; page_id?: string }) => {
      const { data: target, error: targetError } = await supabase
        .from('monitoring_targets')
        .insert({ advertiser_name, page_id: page_id || null })
        .select()
        .single();
      if (targetError) throw targetError;

      const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('scrape-ads', {
        body: { keyword: advertiser_name, targetId: target.id },
      });

      if (scrapeError) throw scrapeError;
      if (!scrapeResult?.success) throw new Error(scrapeResult?.error || 'Scraping failed');

      const ads = (scrapeResult.ads || []).filter((ad: any) => {
        if (!ad.image_url) return false;
        const url = ad.image_url.toLowerCase();
        if (/favicon|icon|logo|avatar|profile|placeholder|blank|spacer|pixel|tracking|1x1|\.svg|\.ico|base64|data:image|gravatar|widget|spinner|loading/i.test(url)) return false;
        if (url.length < 30) return false;
        return true;
      });

      if (ads.length > 0) {
        const { error: insertError } = await supabase.from('scraped_ads').insert(ads);
        if (insertError) throw insertError;
      }

      await supabase
        .from('monitoring_targets')
        .update({ last_scraped_at: new Date().toISOString() })
        .eq('id', target.id);

      return { target, adsCount: ads.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scraped-ads'] });
      queryClient.invalidateQueries({ queryKey: ['monitoring-targets'] });
    },
  });
}

export function useDeleteMonitoringTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('monitoring_targets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitoring-targets'] });
      queryClient.invalidateQueries({ queryKey: ['scraped-ads'] });
    },
  });
}

export function useDeleteScrapedAd() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('scraped_ads').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scraped-ads'] });
    },
  });
}

export function useBulkDeleteScrapedAds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('scraped_ads').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scraped-ads'] });
    },
  });
}

export function useAssignAdToClients() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ adId, clientIds, notes }: { adId: string; clientIds: string[]; notes?: string }) => {
      const rows = clientIds.map(clientId => ({
        creative_id: adId,
        client_id: clientId,
        notes: notes || null,
      }));
      const { error } = await supabase.from('client_ad_assignments').insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-ad-assignments'] });
    },
  });
}

export function useClientAssignedAds(clientId: string | undefined) {
  return useQuery({
    queryKey: ['client-ad-assignments', clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from('client_ad_assignments')
        .select('*')
        .eq('client_id', clientId)
        .order('assigned_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as { id: string; client_id: string; creative_id: string; assigned_at: string; assigned_by: string | null; notes: string | null }[];
    },
    enabled: !!clientId,
  });
}

export function useRemoveAdAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase.from('client_ad_assignments').delete().eq('id', assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-ad-assignments'] });
    },
  });
}
