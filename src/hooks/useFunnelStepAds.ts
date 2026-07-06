import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface FunnelStepAd {
  id: string;
  step_id: string;
  creative_id: string;
  sort_order: number;
  created_at: string;
}

export function useFunnelStepAds(stepIds: string[]) {
  return useQuery({
    queryKey: ['funnel-step-ads', stepIds.slice().sort().join(',')],
    queryFn: async () => {
      if (stepIds.length === 0) return [];
      const { data, error } = await supabase
        .from('funnel_step_ads')
        .select('*')
        .in('step_id', stepIds)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data || []) as FunnelStepAd[];
    },
    enabled: stepIds.length > 0,
  });
}

export function useSetFunnelStepAds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, creativeIds }: { stepId: string; creativeIds: string[] }) => {
      // Replace all links for this step
      const { error: delErr } = await supabase.from('funnel_step_ads').delete().eq('step_id', stepId);
      if (delErr) throw delErr;
      if (creativeIds.length === 0) return { stepId };
      const rows = creativeIds.slice(0, 3).map((cid, i) => ({
        step_id: stepId,
        creative_id: cid,
        sort_order: i,
      }));
      const { error } = await supabase.from('funnel_step_ads').insert(rows);
      if (error) throw error;
      return { stepId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['funnel-step-ads'] });
      toast.success('Ad selection saved');
    },
    onError: (e: any) => toast.error('Failed to save ads: ' + e.message),
  });
}