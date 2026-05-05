import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SourceAggregatedMetrics } from './useSourceMetrics';
import { DailyMetric } from './useMetrics';

interface ClientSourceMetricsRow {
  client_id: string;
  total_leads: number;
  spam_leads: number;
  crm_leads: number;
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

      const { data, error } = await supabase.rpc('get_client_source_metrics', params);
      if (error) throw error;
      return (data || []) as ClientSourceMetricsRow[];
    },
  });
}

/**
 * Aggregates daily metrics into totals for a single client
 */
function aggregateDailyTotals(dailyMetrics: DailyMetric[]) {
  return dailyMetrics.reduce(
    (acc, day) => ({
      totalAdSpend: acc.totalAdSpend + Number(day.ad_spend || 0),
      totalClicks: acc.totalClicks + (day.clicks || 0),
      totalImpressions: acc.totalImpressions + (day.impressions || 0),
      totalCommitments: acc.totalCommitments + (day.commitments || 0),
      commitmentDollars: acc.commitmentDollars + Number(day.commitment_dollars || 0),
    }),
    { totalAdSpend: 0, totalClicks: 0, totalImpressions: 0, totalCommitments: 0, commitmentDollars: 0 }
  );
}

/**
 * Builds a SourceAggregatedMetrics entry for a single client
 */
function buildSingleClientMetrics(
  dailyTotals: ReturnType<typeof aggregateDailyTotals>,
  row: ClientSourceMetricsRow | null,
  defaultPipelineValue: number
): SourceAggregatedMetrics {
  const totalAdSpend = dailyTotals.totalAdSpend;
  const totalLeads = row ? Number(row.total_leads) : 0;
  const totalCalls = row ? Number(row.total_calls) : 0;
  const showedCalls = row ? Number(row.showed_calls) : 0;
  const reconnectCalls = row ? Number(row.reconnect_calls) : 0;
  const reconnectShowed = row ? Number(row.reconnect_showed) : 0;
  const fundedCount = row ? Number(row.funded_count) : 0;
  const fundedDollars = row ? Number(row.funded_dollars) : 0;
  const pipelineValue = defaultPipelineValue > 0 ? totalLeads * defaultPipelineValue : 0;

  return {
    totalAdSpend,
    totalLeads,
    spamLeads: row ? Number(row.spam_leads) : 0,
    crmLeads: row ? Number(row.crm_leads || 0) : 0,
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
    avgTimeToFund: row ? Number(row.avg_time_to_fund) : 0,
    avgCallsToFund: row ? Number(row.avg_calls_to_fund) : 0,
    leadToBookedPercent: totalLeads > 0 ? (totalCalls / totalLeads) * 100 : 0,
    closeRate: showedCalls > 0 ? (fundedCount / showedCalls) * 100 : 0,
    pipelineValue,
    costPerReconnectCall: reconnectCalls > 0 ? totalAdSpend / reconnectCalls : 0,
    costPerReconnectShowed: reconnectShowed > 0 ? totalAdSpend / reconnectShowed : 0,
  };
}

/**
 * Converts RPC results + daily_metrics into per-client SourceAggregatedMetrics.
 * Ensures every client with ad spend in daily_metrics gets an entry, even if the
 * RPC returned no lead/call data for them (e.g. GHL not configured).
 * Also ensures every client in clientFullSettings gets an entry so the dashboard
 * never has a gap for a visible client.
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

  // Index RPC rows by client_id for fast lookup
  const rpcByClient: Record<string, ClientSourceMetricsRow> = {};
  for (const row of rpcData) {
    rpcByClient[row.client_id] = row;
  }

  // Process all clients from RPC data (should include every client)
  for (const row of rpcData) {
    const clientDailyMetrics = dailyByClient[row.client_id] || [];
    const dailyTotals = aggregateDailyTotals(clientDailyMetrics);
    const defaultPipelineValue = clientFullSettings[row.client_id]?.default_lead_pipeline_value || 0;
    result[row.client_id] = buildSingleClientMetrics(dailyTotals, row, defaultPipelineValue);
  }

  // Defensive: include any clients that have daily_metrics (ad spend) but were
  // missing from the RPC results — ensures ad spend always shows on the dashboard
  for (const clientId of Object.keys(dailyByClient)) {
    if (!result[clientId]) {
      const dailyTotals = aggregateDailyTotals(dailyByClient[clientId]);
      const defaultPipelineValue = clientFullSettings[clientId]?.default_lead_pipeline_value || 0;
      result[clientId] = buildSingleClientMetrics(dailyTotals, null, defaultPipelineValue);
    }
  }

  // Final defensive: ensure every client that has settings (and thus is visible
  // on the dashboard) gets a metrics entry even if they have no RPC or daily data.
  // This prevents the table from showing a blank row for newly added clients.
  for (const clientId of Object.keys(clientFullSettings)) {
    if (!result[clientId]) {
      const emptyTotals = { totalAdSpend: 0, totalClicks: 0, totalImpressions: 0, totalCommitments: 0, commitmentDollars: 0 };
      const rpcRow = rpcByClient[clientId] || null;
      const defaultPipelineValue = clientFullSettings[clientId]?.default_lead_pipeline_value || 0;
      result[clientId] = buildSingleClientMetrics(emptyTotals, rpcRow, defaultPipelineValue);
    }
  }

  return result;
}
