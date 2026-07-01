import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfMonth, format } from 'date-fns';

// Real-time MTD ad spend per client, driven by daily_metrics.
export function useClientMonthAdSpend(clientIds: string[]) {
  return useQuery({
    queryKey: ['client-mtd-adspend', clientIds.slice().sort().join(',')],
    queryFn: async () => {
      const map: Record<string, number> = {};
      if (!clientIds.length) return map;
      const start = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('daily_metrics')
        .select('client_id, ad_spend')
        .in('client_id', clientIds)
        .gte('date', start);
      if (error) throw error;
      for (const row of data || []) {
        const id = (row as any).client_id as string;
        map[id] = (map[id] || 0) + Number((row as any).ad_spend || 0);
      }
      return map;
    },
    enabled: clientIds.length > 0,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
