import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';

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

export interface DailyMetric {
  id: string;
  client_id: string;
  date: string;
  ad_spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  spam_leads: number;
  calls: number;
  showed_calls: number;
  commitments: number;
  commitment_dollars: number;
  funded_investors: number;
  funded_dollars: number;
  reconnect_calls?: number;
  reconnect_showed?: number;
}

export interface FundedInvestor {
  id: string;
  client_id: string;
  lead_id: string | null;
  external_id: string;
  name: string | null;
  funded_amount: number;
  funded_at: string;
  first_contact_at: string | null;
  time_to_fund_days: number | null;
  calls_to_fund: number;
  commitment_amount: number | null;
  source: string | null;
}

export interface AggregatedMetrics {
  totalAdSpend: number;
  totalLeads: number;
  spamLeads: number;
  totalCalls: number;
  showedCalls: number;
  totalCommitments: number;
  commitmentDollars: number;
  fundedInvestors: number;
  fundedDollars: number;
  ctr: number;
  costPerLead: number;
  costPerCall: number;
  showedPercent: number;
  costPerShow: number;
  costPerInvestor: number;
  costOfCapital: number;
  avgTimeToFund: number;
  avgCallsToFund: number;
  leadToBookedPercent: number;
  reconnectCalls: number;
  reconnectShowed: number;
  closeRate: number;
  pipelineValue: number;
  costPerReconnectCall: number;
  costPerReconnectShowed: number;
}

export function useDailyMetrics(clientId: string | undefined, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['daily-metrics', clientId, startDate, endDate],
    queryFn: async () => {
      if (!clientId) return [];
      
      return await fetchAllRows<DailyMetric>((sb) => {
        let query = sb
          .from('daily_metrics')
          .select('*')
          .eq('client_id', clientId)
          .order('date', { ascending: false });
        
        if (startDate) {
          query = query.gte('date', startDate);
        }
        if (endDate) {
          query = query.lte('date', endDate);
        }
        
        return query;
      });
    },
    enabled: !!clientId,
  });
}

export function useAllDailyMetrics(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['all-daily-metrics', startDate, endDate],
    queryFn: async () => {
      try {
        return await withTimeout(fetchAllRows<DailyMetric>((sb) => {
          let query = sb
            .from('daily_metrics')
            .select('*')
            .order('date', { ascending: false });
          
          if (startDate) {
            query = query.gte('date', startDate);
          }
          if (endDate) {
            query = query.lte('date', endDate);
          }
          
          return query;
        }), 'Daily metrics');
      } catch (error) {
        console.error('[dashboard] Daily metrics unavailable', error);
        return [];
      }
    },
    retry: 0,
    staleTime: 60 * 1000,
  });
}

export function useFundedInvestors(clientId?: string, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['funded-investors', clientId, startDate, endDate],
    queryFn: async () => {
      return await fetchAllRows<FundedInvestor>((sb) => {
        let query = sb
          .from('funded_investors')
          .select('*')
          .order('funded_at', { ascending: false });
        
        if (clientId) {
          query = query.eq('client_id', clientId);
        }

        if (startDate) {
          query = query.gte('funded_at', startDate + 'T00:00:00.000Z');
        }
        if (endDate) {
          const endNext = new Date(endDate + 'T00:00:00.000Z');
          endNext.setUTCDate(endNext.getUTCDate() + 1);
          query = query.lt('funded_at', endNext.toISOString());
        }
        
        return query;
      });
    },
  });
}

export function aggregateMetrics(dailyMetrics: DailyMetric[], fundedInvestors: FundedInvestor[], leads?: { pipeline_value?: number | null }[], defaultLeadPipelineValue?: number): AggregatedMetrics {
  const totals = dailyMetrics.reduce(
    (acc, day) => ({
      totalAdSpend: acc.totalAdSpend + Number(day.ad_spend || 0),
      totalLeads: acc.totalLeads + (day.leads || 0),
      spamLeads: acc.spamLeads + (day.spam_leads || 0),
      totalCalls: acc.totalCalls + (day.calls || 0),
      showedCalls: acc.showedCalls + (day.showed_calls || 0),
      totalCommitments: acc.totalCommitments + (day.commitments || 0),
      commitmentDollars: acc.commitmentDollars + Number(day.commitment_dollars || 0),
      fundedInvestors: acc.fundedInvestors + (day.funded_investors || 0),
      fundedDollars: acc.fundedDollars + Number(day.funded_dollars || 0),
      totalClicks: acc.totalClicks + (day.clicks || 0),
      totalImpressions: acc.totalImpressions + (day.impressions || 0),
      reconnectCalls: acc.reconnectCalls + (day.reconnect_calls || 0),
      reconnectShowed: acc.reconnectShowed + (day.reconnect_showed || 0),
    }),
    {
      totalAdSpend: 0,
      totalLeads: 0,
      spamLeads: 0,
      totalCalls: 0,
      showedCalls: 0,
      totalCommitments: 0,
      commitmentDollars: 0,
      fundedInvestors: 0,
      fundedDollars: 0,
      totalClicks: 0,
      totalImpressions: 0,
      reconnectCalls: 0,
      reconnectShowed: 0,
    }
  );

  const fundedWithTimeData = fundedInvestors.filter(f => f.time_to_fund_days !== null);
  const avgTimeToFund = fundedWithTimeData.length > 0
    ? fundedWithTimeData.reduce((sum, f) => sum + (f.time_to_fund_days || 0), 0) / fundedWithTimeData.length
    : 0;

  const avgCallsToFund = fundedInvestors.length > 0
    ? fundedInvestors.reduce((sum, f) => sum + (f.calls_to_fund || 0), 0) / fundedInvestors.length
    : 0;

  const leadToBookedPercent = totals.totalLeads > 0 ? (totals.totalCalls / totals.totalLeads) * 100 : 0;
  const closeRate = totals.showedCalls > 0 ? (totals.fundedInvestors / totals.showedCalls) * 100 : 0;

  const pipelineValue = (defaultLeadPipelineValue && defaultLeadPipelineValue > 0)
    ? (totals.totalLeads - totals.spamLeads) * defaultLeadPipelineValue
    : (() => {
        const leadsWithPipeline = leads?.filter(l => l.pipeline_value && l.pipeline_value > 0) || [];
        return leadsWithPipeline.length > 0
          ? Math.min(...leadsWithPipeline.map(l => l.pipeline_value || 0))
          : 0;
      })();

  return {
    totalAdSpend: totals.totalAdSpend,
    totalLeads: totals.totalLeads,
    spamLeads: totals.spamLeads,
    totalCalls: totals.totalCalls,
    showedCalls: totals.showedCalls,
    totalCommitments: totals.totalCommitments,
    commitmentDollars: totals.commitmentDollars,
    fundedInvestors: totals.fundedInvestors,
    fundedDollars: totals.fundedDollars,
    ctr: totals.totalImpressions > 0 ? (totals.totalClicks / totals.totalImpressions) * 100 : 0,
    costPerLead: totals.totalLeads > 0 ? totals.totalAdSpend / totals.totalLeads : 0,
    costPerCall: totals.totalCalls > 0 ? totals.totalAdSpend / totals.totalCalls : 0,
    showedPercent: totals.totalCalls > 0 ? (totals.showedCalls / totals.totalCalls) * 100 : 0,
    costPerShow: totals.showedCalls > 0 ? totals.totalAdSpend / totals.showedCalls : 0,
    costPerInvestor: totals.fundedInvestors > 0 ? totals.totalAdSpend / totals.fundedInvestors : 0,
    costOfCapital: totals.fundedDollars > 0 ? (totals.totalAdSpend / totals.fundedDollars) * 100 : 0,
    avgTimeToFund,
    avgCallsToFund,
    leadToBookedPercent,
    reconnectCalls: totals.reconnectCalls,
    reconnectShowed: totals.reconnectShowed,
    closeRate,
    pipelineValue,
    costPerReconnectCall: totals.reconnectCalls > 0 ? totals.totalAdSpend / totals.reconnectCalls : 0,
    costPerReconnectShowed: totals.reconnectShowed > 0 ? totals.totalAdSpend / totals.reconnectShowed : 0,
  };
}
