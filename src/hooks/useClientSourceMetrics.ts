import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SourceAggregatedMetrics } from './useSourceMetrics';
import { DailyMetric } from './useMetrics';

const DASHBOARD_QUERY_TIMEOUT_MS = 12000;

async function withTimeout<T>(promise: Promise<T>, label: string, ms = DASHBOARD_QUERY_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

interface ClientSourceMetricsRow {
  client_id: string;
  total_leads: number;
  spam_leads: number;
  total_calls: number;
  showed_calls: number;
  reconnect_calls: number;
  reconnect_showed: number;
  funded_count: number;
  funded_dollars: number;
  commitment_dollars: number;
  avg_time_to_fund: number;
  avg_calls_to_fund: number;
}

/**
 * Fetches per-client aggregated metrics via a database RPC function.
 * This bypasses the 1000-row Supabase limit by aggregating in the database.
 */
export function useClientSourceMetrics(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['client-source-metrics', startDate, endDate],
    queryFn: async () => {
      // Pass plain date strings (YYYY-MM-DD) — the RPC uses ::date cast
      // to ensure UTC-date-level filtering regardless of client timezone
      const params: Record<string, string | null> = {
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      };

      try {
        const { data, error } = await withTimeout(
          supabase.rpc('get_client_source_metrics', params),
          'Client source metrics'
        );
        if (error) throw error;
        return (data || []) as ClientSourceMetricsRow[];
      } catch (error) {
        console.error('[dashboard] Client source metrics unavailable', error);
        return [];
      }
    },
    retry: 0,
    staleTime: 60 * 1000,
  });
}

/**
 * Converts RPC results + daily_metrics into per-client SourceAggregatedMetrics
 */
export function buildClientMetricsFromRPC(
  rpcData: ClientSourceMetricsRow[],
  dailyMetrics: DailyMetric[],
  clientFullSettings: Record<string, any>
): Record<string, SourceAggregatedMetrics> {
  const result: Record<string, SourceAggregatedMetrics> = {};

  // Pre-group daily metrics by client
  const dailyByClient: Record<string, DailyMetric[]> = {};
  for (const m of dailyMetrics) {
    if (!dailyByClient[m.client_id]) dailyByClient[m.client_id] = [];
    dailyByClient[m.client_id].push(m);
  }

  for (const row of rpcData) {
    const clientDailyMetrics = dailyByClient[row.client_id] || [];
    const dailyTotals = clientDailyMetrics.reduce(
      (acc, day) => ({
        totalAdSpend: acc.totalAdSpend + Number(day.ad_spend || 0),
        totalClicks: acc.totalClicks + (day.clicks || 0),
        totalImpressions: acc.totalImpressions + (day.impressions || 0),
        totalCommitments: acc.totalCommitments + (day.commitments || 0),
        commitmentDollars: acc.commitmentDollars + Number(day.commitment_dollars || 0),
      }),
      { totalAdSpend: 0, totalClicks: 0, totalImpressions: 0, totalCommitments: 0, commitmentDollars: 0 }
    );

    const totalAdSpend = dailyTotals.totalAdSpend;
    const totalLeads = Number(row.total_leads);
    const totalCalls = Number(row.total_calls);
    const showedCalls = Number(row.showed_calls);
    const reconnectCalls = Number(row.reconnect_calls);
    const reconnectShowed = Number(row.reconnect_showed);
    const fundedCount = Number(row.funded_count);
    const fundedDollars = Number(row.funded_dollars);

    const defaultPipelineValue = clientFullSettings[row.client_id]?.default_lead_pipeline_value || 0;
    const pipelineValue = defaultPipelineValue > 0 ? totalLeads * defaultPipelineValue : 0;

    result[row.client_id] = {
      totalAdSpend,
      totalLeads,
      spamLeads: Number(row.spam_leads),
      totalCalls,
      showedCalls,
      reconnectCalls,
      reconnectShowed,
      totalCommitments: dailyTotals.totalCommitments,
      commitmentDollars: dailyTotals.commitmentDollars,
      fundedInvestors: fundedCount,
      fundedDollars,
      ctr: dailyTotals.totalImpressions > 0 ? (dailyTotals.totalClicks / dailyTotals.totalImpressions) * 100 : 0,
      costPerLead: totalLeads > 0 ? totalAdSpend / totalLeads : 0,
      costPerCall: totalCalls > 0 ? totalAdSpend / totalCalls : 0,
      showedPercent: totalCalls > 0 ? (showedCalls / totalCalls) * 100 : 0,
      costPerShow: showedCalls > 0 ? totalAdSpend / showedCalls : 0,
      costPerInvestor: fundedCount > 0 ? totalAdSpend / fundedCount : 0,
      costOfCapital: fundedDollars > 0 ? (totalAdSpend / fundedDollars) * 100 : 0,
      avgTimeToFund: Number(row.avg_time_to_fund),
      avgCallsToFund: Number(row.avg_calls_to_fund),
      leadToBookedPercent: totalLeads > 0 ? (totalCalls / totalLeads) * 100 : 0,
      closeRate: showedCalls > 0 ? (fundedCount / showedCalls) * 100 : 0,
      pipelineValue,
      costPerReconnectCall: reconnectCalls > 0 ? totalAdSpend / reconnectCalls : 0,
      costPerReconnectShowed: reconnectShowed > 0 ? totalAdSpend / reconnectShowed : 0,
    };
  }

  return result;
}
