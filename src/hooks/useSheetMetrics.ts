import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { DailyMetric } from './useMetrics';
import type { SourceAggregatedMetrics } from './useSourceMetrics';

export interface SheetMetricsResult {
  daily: DailyMetric[];
  aggregated: SourceAggregatedMetrics | null;
  sheetTitle?: string;
  fetchedAt?: string;
  rowCount?: number;
  tabsScanned?: string[];
  tabsUsed?: string[];
  tabsSkipped?: { title: string; reason: string }[];
  tabsBreakdown?: TabBreakdown[];
}

export interface TabBreakdown {
  title: string;
  isPrimary: boolean;
  dayCount: number;
  dateRange: { start: string; end: string } | null;
  overlapDayCount: number;
  adSpend: number;
  impressions: number;
  clicks: number;
  leads: number;
  spamLeads: number;
  calls: number;
  showedCalls: number;
  commitments: number;
  commitmentDollars: number;
  fundedInvestors: number;
  fundedDollars: number;
}

/**
 * Fetches metrics from a Google Sheet via the fetch-sheet-metrics edge function.
 * Returns the same shape as DB-backed hooks so KPI/chart components are agnostic.
 */
export function useSheetMetrics(
  clientId: string | undefined,
  sheetId: string | undefined | null,
  gid: string | undefined | null,
  startDate?: string,
  endDate?: string,
  mapping?: Record<string, string> | null,
) {
  return useQuery<SheetMetricsResult>({
    queryKey: ['sheet-metrics', clientId, sheetId, gid, startDate, endDate, mapping],
    queryFn: async () => {
      if (!sheetId) return { daily: [], aggregated: null };
      const { data, error } = await supabase.functions.invoke('fetch-sheet-metrics', {
        body: {
          sheet_id: sheetId,
          gid: gid || undefined,
          start_date: startDate,
          end_date: endDate,
          mapping: mapping || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as SheetMetricsResult;
    },
    enabled: !!sheetId,
    staleTime: 5 * 60 * 1000,
  });
}