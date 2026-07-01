import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DollarSign, Users, PhoneCall, PhoneIncoming, HandCoins, Banknote, ArrowDown,
} from 'lucide-react';
import type { DailyMetric } from '@/hooks/useMetrics';

interface EndToEndFunnelPanelProps {
  dailyMetrics: DailyMetric[];
  fundedInvestorLabel?: string;
  className?: string;
}

interface FunnelStage {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  format: 'currency' | 'number';
  color: string;
  barColor: string;
  costPer?: number;   // spend / stage value
  subLabel?: string;  // extra context line (e.g. commitment $)
}

function fmt(value: number, format: 'currency' | 'number'): string {
  if (format === 'currency') {
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function EndToEndFunnelPanel({
  dailyMetrics,
  fundedInvestorLabel = 'Funded Investors',
  className,
}: EndToEndFunnelPanelProps) {
  const totals = useMemo(() => {
    return dailyMetrics.reduce(
      (acc, m) => ({
        spend: acc.spend + (Number(m.ad_spend) || 0),
        leads: acc.leads + (Number(m.leads) || 0),
        calls: acc.calls + (Number(m.calls) || 0),
        showed: acc.showed + (Number(m.showed_calls) || 0),
        commitments: acc.commitments + (Number(m.commitments) || 0),
        commitmentDollars: acc.commitmentDollars + (Number(m.commitment_dollars) || 0),
        funded: acc.funded + (Number(m.funded_investors) || 0),
        fundedDollars: acc.fundedDollars + (Number(m.funded_dollars) || 0),
      }),
      { spend: 0, leads: 0, calls: 0, showed: 0, commitments: 0, commitmentDollars: 0, funded: 0, fundedDollars: 0 },
    );
  }, [dailyMetrics]);

  const stages: FunnelStage[] = useMemo(() => [
    {
      key: 'spend', label: 'Ad Spend', icon: DollarSign,
      value: totals.spend, format: 'currency',
      color: 'text-blue-500', barColor: 'bg-blue-500',
    },
    {
      key: 'leads', label: 'Leads', icon: Users,
      value: totals.leads, format: 'number',
      color: 'text-indigo-500', barColor: 'bg-indigo-500',
      costPer: totals.leads > 0 ? totals.spend / totals.leads : 0,
    },
    {
      key: 'calls', label: 'Booked Calls', icon: PhoneCall,
      value: totals.calls, format: 'number',
      color: 'text-amber-500', barColor: 'bg-amber-500',
      costPer: totals.calls > 0 ? totals.spend / totals.calls : 0,
    },
    {
      key: 'showed', label: 'Showed Calls', icon: PhoneIncoming,
      value: totals.showed, format: 'number',
      color: 'text-emerald-500', barColor: 'bg-emerald-500',
      costPer: totals.showed > 0 ? totals.spend / totals.showed : 0,
    },
    {
      key: 'commitments', label: 'Committed', icon: HandCoins,
      value: totals.commitments, format: 'number',
      color: 'text-teal-500', barColor: 'bg-teal-500',
      costPer: totals.commitments > 0 ? totals.spend / totals.commitments : 0,
      subLabel: totals.commitmentDollars > 0 ? `${fmt(totals.commitmentDollars, 'currency')} committed` : undefined,
    },
    {
      key: 'funded', label: fundedInvestorLabel, icon: Banknote,
      value: totals.funded, format: 'number',
      color: 'text-green-500', barColor: 'bg-green-500',
      costPer: totals.funded > 0 ? totals.spend / totals.funded : 0,
      subLabel: totals.fundedDollars > 0 ? `${fmt(totals.fundedDollars, 'currency')} funded` : undefined,
    },
  ], [totals, fundedInvestorLabel]);

  // Bar widths relative to leads (the first countable stage); spend bar is full width
  const maxCount = Math.max(totals.leads, 1);

  const costOfCapital = totals.fundedDollars > 0 ? (totals.spend / totals.fundedDollars) * 100 : 0;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-semibold">End-to-End Funnel</CardTitle>
          {totals.fundedDollars > 0 && (
            <Badge
              className={cn(
                'text-xs',
                costOfCapital <= 3 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : costOfCapital <= 7 ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                  : 'bg-destructive/10 text-destructive',
              )}
            >
              Cost of Capital: {costOfCapital.toFixed(2)}%
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {stages.map((stage, i) => {
          const StageIcon = stage.icon;
          const prev = stages[i - 1];
          // Conversion rate from previous countable stage (skip spend → leads)
          const convRate = i >= 2 && prev && prev.value > 0
            ? (stage.value / prev.value) * 100
            : null;
          const barPct = stage.format === 'currency'
            ? 100
            : Math.max((stage.value / maxCount) * 100, stage.value > 0 ? 4 : 0);

          return (
            <div key={stage.key}>
              {convRate !== null && (
                <div className="flex items-center gap-1.5 py-0.5 pl-10 text-[11px] text-muted-foreground">
                  <ArrowDown className="w-3 h-3" />
                  {convRate.toFixed(1)}% conversion
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className={cn('shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted', stage.color)}>
                  <StageIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{stage.label}</span>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-bold tabular-nums">{fmt(stage.value, stage.format)}</span>
                      {stage.costPer !== undefined && stage.costPer > 0 && (
                        <span className="text-[11px] text-muted-foreground ml-2 tabular-nums">
                          ${stage.costPer.toLocaleString('en-US', { maximumFractionDigits: 0 })}/ea
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted mt-1 overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', stage.barColor)}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  {stage.subLabel && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{stage.subLabel}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {totals.leads === 0 && totals.spend === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No data in the selected date range.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
