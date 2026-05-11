import { useQueries } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AggregatedMetrics } from '@/hooks/useMetrics';
import type { ClientSettings } from '@/hooks/useClientSettings';

function parseSheetUrl(url?: string | null): { sheet_id: string; gid?: string } | null {
  if (!url) return null;
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#?&]gid=(\d+)/);
  return { sheet_id: idMatch[1], gid: gidMatch?.[1] };
}

/**
 * For each client with a configured kpi_google_sheet_url in client_settings,
 * fetches metrics from their KPI sheet via fetch-sheet-metrics.
 * Returns a map keyed by client_id. Clients without a sheet are omitted.
 */
export function useSheetClientMetrics(
  clientIds: string[],
  settings: Record<string, ClientSettings>,
  startDate?: string,
  endDate?: string,
): { data: Record<string, AggregatedMetrics>; isLoading: boolean } {
  const targets = clientIds
    .map((id) => {
      const url = (settings[id] as any)?.kpi_google_sheet_url as string | undefined;
      const parsed = parseSheetUrl(url);
      return parsed ? { id, ...parsed } : null;
    })
    .filter((t): t is { id: string; sheet_id: string; gid?: string } => !!t);

  const queries = useQueries({
    queries: targets.map((t) => ({
      queryKey: ['sheet-client-metrics', t.id, t.sheet_id, t.gid, startDate, endDate],
      queryFn: async () => {
        const { data, error } = await supabase.functions.invoke('fetch-sheet-metrics', {
          body: {
            sheet_id: t.sheet_id,
            gid: t.gid,
            start_date: startDate,
            end_date: endDate,
          },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        return { id: t.id, aggregated: (data as any)?.aggregated as AggregatedMetrics | null };
      },
      staleTime: 5 * 60 * 1000,
      retry: 0,
    })),
  });

  const map: Record<string, AggregatedMetrics> = {};
  queries.forEach((q) => {
    if (q.data?.aggregated) map[q.data.id] = q.data.aggregated;
  });
  const isLoading = queries.some((q) => q.isLoading);
  return { data: map, isLoading };
}
