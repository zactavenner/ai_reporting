import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BillingTarget {
  id: string;
  period_type: 'quarter' | 'year';
  period_key: string;
  target_amount: number;
  notes: string | null;
}

export function useBillingTargets() {
  return useQuery({
    queryKey: ['billing-targets'],
    queryFn: async (): Promise<BillingTarget[]> => {
      const { data, error } = await (supabase as any)
        .from('billing_targets')
        .select('*')
        .order('period_key', { ascending: true });
      if (error) throw error;
      return (data || []) as BillingTarget[];
    },
    staleTime: 30_000,
  });
}

export function useUpsertBillingTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: { period_type: 'quarter' | 'year'; period_key: string; target_amount: number; notes?: string | null }) => {
      const { data, error } = await (supabase as any)
        .from('billing_targets')
        .upsert(
          {
            period_type: t.period_type,
            period_key: t.period_key,
            target_amount: t.target_amount,
            notes: t.notes ?? null,
          },
          { onConflict: 'period_type,period_key' }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing-targets'] }),
  });
}