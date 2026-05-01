import { useMemo } from 'react';
import { KPICard, KPIThreshold } from './KPICard';
import { getMetricConfidence } from '@/lib/metricConfidence';

interface KPIMetrics {
  totalAdSpend?: number;
  ctr?: number;
  leads?: number;
  totalLeads?: number;
  crmLeads?: number;
  spamBadLeads?: number;
  spamLeads?: number;
  costPerLead?: number;
  calls?: number;
  totalCalls?: number;
  costPerCall?: number;
  showedCalls?: number;
  showedPercent?: number;
  costPerShow?: number;
  commitments?: number;
  totalCommitments?: number;
  commitmentDollars?: number;
  fundedInvestors?: number;
  fundedDollars?: number;
  costPerInvestor?: number;
  costOfCapital?: number;
  avgTimeToFund?: number;
  avgCallsToFund?: number;
  leadToBookedPercent?: number;
  reconnectCalls?: number;
  reconnectShowed?: number;
  closeRate?: number;
  pipelineValue?: number;
  costPerReconnectCall?: number;
  costPerReconnectShowed?: number;
}

interface PriorMetrics {
  totalAdSpend?: number;
  ctr?: number;
  leads?: number;
  totalLeads?: number;
  crmLeads?: number;
  spamBadLeads?: number;
  spamLeads?: number;
  costPerLead?: number;
  calls?: number;
  totalCalls?: number;
  costPerCall?: number;
  showedCalls?: number;
  showedPercent?: number;
  costPerShow?: number;
  commitments?: number;
  totalCommitments?: number;
  commitmentDollars?: number;
  fundedInvestors?: number;
  fundedDollars?: number;
  costPerInvestor?: number;
  costOfCapital?: number;
  reconnectCalls?: number;
  reconnectShowed?: number;
  closeRate?: number;
  pipelineValue?: number;
  costPerReconnectCall?: number;
  costPerReconnectShowed?: number;
  leadToBookedPercent?: number;
}

export interface KPIThresholds {
  costPerLead?: KPIThreshold;
  costPerCall?: KPIThreshold;
  costPerShow?: KPIThreshold;
  costPerInvestor?: KPIThreshold;
  costOfCapital?: KPIThreshold;
}

// Metrics where lower is better (costs) - green when decreasing
const COST_METRICS = new Set([
  'costPerLead', 'costPerCall', 'costPerShow', 'costPerInvestor', 
  'costOfCapital', 'costPerReconnectCall', 'costPerReconnectShowed',
  'spamBadLeads', 'spamLeads'
]);

// Key aliases to map KPI keys to priorMetrics keys
const KEY_ALIASES: Record<string, string> = {
  'leads': 'totalLeads',
  'calls': 'totalCalls',
  'commitments': 'totalCommitments',
  'spamBadLeads': 'spamLeads',
};

function calculateChange(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0;
  return ((current - prior) / prior) * 100;
}

interface DailySnapshot {
  date: string;
  [key: string]: any;
}

interface KPIGridProps {
  metrics: KPIMetrics;
  priorMetrics?: PriorMetrics;
  onMetricClick?: (metric: string) => void;
  showFundedMetrics?: boolean;
  thresholds?: KPIThresholds;
  fundedInvestorLabel?: string;
  showConfidence?: boolean;
  dailySnapshots?: DailySnapshot[];
}

export function KPIGrid({ 
  metrics, 
  priorMetrics,
  onMetricClick, 
  showFundedMetrics = false,
  thresholds,
  fundedInvestorLabel = 'Funded Investors',
  showConfidence = false,
  dailySnapshots = [],
}: KPIGridProps) {
  
  // Calculate change vs prior for a metric, inverting for cost metrics
  const getChangeForMetric = (key: string, currentValue: number): number => {
    if (!priorMetrics) return 0;
    
    const priorKey = KEY_ALIASES[key] || key;
    const priorValue = (priorMetrics as any)[priorKey] ?? (priorMetrics as any)[key] ?? 0;
    const rawChange = calculateChange(currentValue, priorValue);
    
    if (COST_METRICS.has(key)) {
      return -rawChange;
    }
    
    return rawChange;
  };

  // Build sparkline data from daily snapshots
  const sparklineMap = useMemo(() => {
    if (!dailySnapshots || dailySnapshots.length < 2) return {};
    
    const map: Record<string, number[]> = {};
    // Map KPI keys to daily_metrics columns
    const keyToColumn: Record<string, string> = {
      totalAdSpend: 'ad_spend',
      leads: 'leads',
      crmLeads: 'crm_leads',
      spamBadLeads: 'spam_leads',
      calls: 'calls',
      showedCalls: 'showed_calls',
      commitments: 'commitments',
      commitmentDollars: 'commitment_dollars',
      fundedInvestors: 'funded_investors',
      fundedDollars: 'funded_dollars',
      reconnectCalls: 'reconnect_calls',
      reconnectShowed: 'reconnect_showed',
    };

    for (const [kpiKey, col] of Object.entries(keyToColumn)) {
      map[kpiKey] = dailySnapshots.map(d => Number((d as any)[col]) || 0);
    }
    return map;
  }, [dailySnapshots]);

  const kpis = [
    { key: 'totalAdSpend', label: 'Total Ad Spend', value: metrics.totalAdSpend ?? 0, format: 'currency' as const },
    { key: 'ctr', label: 'CTR', value: metrics.ctr ?? 0, format: 'percent' as const },
    { key: 'leads', label: 'Leads', value: metrics.leads ?? metrics.totalLeads ?? 0, format: 'number' as const, clickable: true },
    { key: 'crmLeads', label: 'CRM Leads', value: metrics.crmLeads ?? 0, format: 'number' as const, clickable: true },
    { key: 'spamBadLeads', label: 'Spam/Bad Leads', value: metrics.spamBadLeads ?? metrics.spamLeads ?? 0, format: 'number' as const },
    { key: 'costPerLead', label: 'Cost Per Lead', value: metrics.costPerLead ?? 0, format: 'currency' as const, threshold: thresholds?.costPerLead },
    { key: 'pipelineValue', label: 'Pipeline Value', value: metrics.pipelineValue ?? 0, format: 'currency' as const },
    { key: 'leadToBookedPercent', label: 'Lead to Booked %', value: metrics.leadToBookedPercent ?? 0, format: 'percent' as const },
    { key: 'calls', label: 'Booked Calls', value: metrics.calls ?? metrics.totalCalls ?? 0, format: 'number' as const, clickable: true },
    { key: 'costPerCall', label: 'Cost Per Call', value: metrics.costPerCall ?? 0, format: 'currency' as const, threshold: thresholds?.costPerCall },
    { key: 'showedCalls', label: 'Showed Calls', value: metrics.showedCalls ?? 0, format: 'number' as const, clickable: true },
    { key: 'showedPercent', label: 'Show Rate', value: metrics.showedPercent ?? 0, format: 'percent' as const },
    { key: 'costPerShow', label: 'Cost Per Show', value: metrics.costPerShow ?? 0, format: 'currency' as const, threshold: thresholds?.costPerShow },
    { key: 'reconnectCalls', label: 'Reconnect Calls', value: metrics.reconnectCalls ?? 0, format: 'number' as const },
    { key: 'reconnectShowed', label: 'Reconnect Showed', value: metrics.reconnectShowed ?? 0, format: 'number' as const },
    { key: 'closeRate', label: 'Close Rate', value: metrics.closeRate ?? 0, format: 'percent' as const },
    { key: 'commitments', label: 'Commitments', value: metrics.commitments ?? metrics.totalCommitments ?? 0, format: 'number' as const, clickable: true },
    { key: 'commitmentDollars', label: 'Commitment $', value: metrics.commitmentDollars ?? 0, format: 'currency' as const },
    { key: 'fundedInvestors', label: fundedInvestorLabel, value: metrics.fundedInvestors ?? 0, format: 'number' as const, clickable: true },
    { key: 'fundedDollars', label: 'Funded $', value: metrics.fundedDollars ?? 0, format: 'currency' as const },
    { key: 'costPerInvestor', label: 'Cost / Investor', value: metrics.costPerInvestor ?? 0, format: 'currency' as const, threshold: thresholds?.costPerInvestor },
    { key: 'costOfCapital', label: 'Cost of Capital', value: metrics.costOfCapital ?? 0, format: 'percent' as const, threshold: thresholds?.costOfCapital },
  ];

  const fundedMetrics = showFundedMetrics ? [
    { key: 'avgTimeToFund', label: 'Avg Time to Fund', value: metrics.avgTimeToFund ?? 0, format: 'days' as const, clickable: false },
    { key: 'avgCallsToFund', label: 'Avg Calls to Fund', value: metrics.avgCallsToFund ?? 0, format: 'number' as const, clickable: false },
  ] : [];

  const allKpis = [...kpis, ...fundedMetrics];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {allKpis.map((kpi) => {
        const change = getChangeForMetric(kpi.key, kpi.value);
        const metricConfidence = showConfidence ? getMetricConfidence(kpi.key) : undefined;
        const isCostMetric = COST_METRICS.has(kpi.key);
        
        return (
          <KPICard
            key={kpi.key}
            label={kpi.label}
            value={kpi.value}
            change={change}
            changeLabel={priorMetrics ? 'vs prior' : undefined}
            format={kpi.format}
            clickable={kpi.clickable}
            onClick={kpi.clickable ? () => onMetricClick?.(kpi.key) : undefined}
            threshold={'threshold' in kpi ? kpi.threshold : undefined}
            confidence={metricConfidence?.level}
            sparklineData={sparklineMap[kpi.key]}
            invertTrend={isCostMetric}
          />
        );
      })}
    </div>
  );
}
