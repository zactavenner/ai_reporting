import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';

export function useApifySettings() {
  return useQuery({
    queryKey: ['apify-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('apify_settings')
        .select('id, actor_id, monthly_spend_limit_cents, current_month_spend_cents, spend_reset_date, is_active, created_at, updated_at')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveApifySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: {
      apify_token?: string;
      actor_id?: string;
      monthly_spend_limit_cents?: number;
      is_active?: boolean;
    }) => {
      // Check if settings row exists
      const { data: existing } = await supabase
        .from('apify_settings')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('apify_settings')
          .update(settings)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('apify_settings')
          .insert(settings);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apify-settings'] });
    },
  });
}

export function useTestApifyConnection() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('test-apify-connection', {
        headers: dashboardAuthHeaders(),
      });
      if (error) throw error;
      return data as { success: boolean; username?: string; plan?: string; error?: string };
    },
  });
}

export function useInstagramScrapeJobs() {
  return useQuery({
    queryKey: ['instagram-scrape-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('instagram_scrape_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (jobs?.some(j => j.status === 'pending' || j.status === 'running')) return 5000;
      return false;
    },
  });
}

/**
 * Paid Apify discovery is a two-step, server-enforced flow: the run is QUOTED
 * (exact target count, result limit and maximum cost, spends nothing), then the
 * operator's click approves that persisted quote and the server runs it inside
 * both the Jeremy policy caps and the Apify monthly spend limit.
 */
export function useQuoteInstagramScrape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      clientId: string;
      scrapeType: 'profile' | 'hashtag' | 'url';
      targets: string[];
      resultsLimit: number;
    }) => {
      const { data, error } = await supabase.functions.invoke('run-instagram-scrape', {
        body: {
          mode: 'quote',
          client_id: params.clientId,
          scrapeType: params.scrapeType,
          targets: params.targets,
          resultsLimit: params.resultsLimit,
        },
        headers: dashboardAuthHeaders(),
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error);
      return data as {
        job: { id: string; status: string; estimated_cost_usd: number; quote: Record<string, unknown> };
        policy_gate?: { allowed: boolean; reason: string };
        apify_gate?: { allowed: boolean; reason: string };
      };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instagram-scrape-jobs'] }),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useRunInstagramScrape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      clientId: string;
      jobId: string;
      scrapeType: 'profile' | 'hashtag' | 'url';
      targets: string[];
      resultsLimit: number;
    }) => {
      const { data, error } = await supabase.functions.invoke('run-instagram-scrape', {
        body: {
          mode: 'approve_and_run',
          client_id: params.clientId,
          job_id: params.jobId,
          scrapeType: params.scrapeType,
          targets: params.targets,
          resultsLimit: params.resultsLimit,
        },
        headers: dashboardAuthHeaders(),
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error);
      return data as { jobId: string; status: string; resultsCount: number; duplicates?: number; costUsd?: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['instagram-scrape-jobs'] });
      qc.invalidateQueries({ queryKey: ['instagram-creatives'] });
      qc.invalidateQueries({ queryKey: ['apify-settings'] });
      toast.success(`Scrape ${data.status}: ${data.resultsCount} new posts ($${(data.costUsd ?? 0).toFixed(2)})`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useInstagramCreatives(filters?: {
  jobId?: string;
  postType?: string;
  search?: string;
  inspirationOnly?: boolean;
}) {
  return useQuery({
    queryKey: ['instagram-creatives', filters],
    queryFn: async () => {
      let query = (supabase
        .from('instagram_creatives') as any)
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.jobId) query = query.eq('job_id', filters.jobId);
      if (filters?.postType) query = query.eq('post_type', filters.postType);
      if (filters?.inspirationOnly) query = query.eq('is_inspiration_source', true);
      if (filters?.search) {
        query = query.or(`caption.ilike.%${filters.search}%,owner_username.ilike.%${filters.search}%`);
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;
      return data;
    },
  });
}

export function useToggleInspiration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase
        .from('instagram_creatives')
        .update({ is_inspiration_source: value })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instagram-creatives'] });
      toast.success('Inspiration status updated');
    },
  });
}
