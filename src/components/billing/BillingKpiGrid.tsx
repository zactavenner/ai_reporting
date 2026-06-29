import { Card, CardContent } from '@/components/ui/card';
import { Sparkline } from '@/components/dashboard/Sparkline';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

export interface KpiCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  change?: number | null;
  spark?: number[];
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'forecast';
  tooltip?: string;
  onClick?: () => void;
}

const toneClasses: Record<NonNullable<KpiCardProps['tone']>, string> = {
  neutral: 'border-border',
  positive: 'border-l-4 border-l-emerald-500',
  negative: 'border-l-4 border-l-destructive',
  warning: 'border-l-4 border-l-amber-500',
  info: 'border-l-4 border-l-blue-500',
  forecast: 'border-dashed border-2 border-blue-300/60',
};

export function KpiCard({ label, value, sublabel, change, spark, tone = 'neutral', tooltip, onClick }: KpiCardProps) {
  const formatted = typeof value === 'number' ? fmt(value) : value;
  return (
    <Card className={cn('transition-shadow', toneClasses[tone], onClick && 'cursor-pointer hover:shadow-md')} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground truncate">{label}</p>
              {tooltip && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">{tooltip}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {tone === 'forecast' && (
                <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">Estimate</span>
              )}
            </div>
            <p className="text-xl font-bold mt-1 tabular-nums truncate">{formatted}</p>
            {(sublabel || change != null) && (
              <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground tabular-nums">
                {change != null && (
                  <span className={cn('inline-flex items-center gap-0.5 font-medium',
                    change > 0 ? 'text-emerald-600' : change < 0 ? 'text-destructive' : 'text-muted-foreground')}>
                    {change > 0 ? <TrendingUp className="h-3 w-3" /> : change < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                    {change > 0 ? '+' : ''}{change.toFixed(1)}%
                  </span>
                )}
                {sublabel && <span className="truncate">{sublabel}</span>}
              </div>
            )}
          </div>
          {spark && spark.length > 1 && (
            <div className="w-16 shrink-0">
              <Sparkline data={spark} height={28} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export interface BillingKpis {
  collectedYTD: number;
  collectedMTD: number;
  activeMRR: number;
  projectedMRR: number;
  arpu: number;
  outstanding: number;
  overdue: number;
  failedCount: number;
  activeClients: number;
  activeSubscriptions: number;
  noSubscription: number;
  targetAttainmentPct: number;
  forecast30d: number;
  monthlySpark: number[];
  ytdPriorChange: number | null;
  mtdPriorChange: number | null;
  mrrPriorChange: number | null;
}

export function BillingKpiGrid({ kpis, onFilter }: { kpis: BillingKpis; onFilter?: (key: string) => void }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      <KpiCard label="Collected YTD" value={kpis.collectedYTD} change={kpis.ytdPriorChange ?? undefined}
        spark={kpis.monthlySpark} tone="positive"
        tooltip="Cash actually collected via Stripe since January 1 of the current year." />
      <KpiCard label="Collected MTD" value={kpis.collectedMTD} change={kpis.mtdPriorChange ?? undefined}
        spark={kpis.monthlySpark.slice(-6)} tone="positive"
        tooltip="Cash collected so far this calendar month." />
      <KpiCard label="Active MRR" value={kpis.activeMRR} change={kpis.mrrPriorChange ?? undefined}
        tone="info"
        tooltip="Sum of all currently-active recurring Stripe subscription amounts, normalized to monthly." />
      <KpiCard label="Projected MRR" value={kpis.projectedMRR} tone="forecast"
        tooltip="Active MRR plus signed agreements not yet billing through Stripe." />
      <KpiCard label="Avg Revenue / Client" value={kpis.arpu} tone="info"
        tooltip="Active MRR divided by clients with an active subscription." />
      <KpiCard label="Outstanding" value={kpis.outstanding} tone="warning"
        tooltip="Sum of all open invoice balances (not yet paid, not voided)." onClick={() => onFilter?.('outstanding')} />
      <KpiCard label="Overdue" value={kpis.overdue} tone="negative"
        tooltip="Outstanding invoices past their due date." onClick={() => onFilter?.('overdue')} />
      <KpiCard label="Failed Payments" value={kpis.failedCount} tone="negative"
        tooltip="Payments where Stripe reported a failure that haven't been resolved." onClick={() => onFilter?.('failed')} />
      <KpiCard label="Active Clients" value={kpis.activeClients} tone="neutral"
        tooltip="Clients with status = active." />
      <KpiCard label="Active Subscriptions" value={kpis.activeSubscriptions} tone="neutral"
        tooltip="Clients with at least one active Stripe subscription." />
      <KpiCard label="No Subscription" value={kpis.noSubscription} tone="warning"
        tooltip="Active clients with no recurring Stripe subscription found." onClick={() => onFilter?.('no_subscription')} />
      <KpiCard label="Target Attainment"
        value={`${kpis.targetAttainmentPct.toFixed(0)}%`}
        sublabel={`${fmt(kpis.activeMRR)} of target`}
        tone={kpis.targetAttainmentPct >= 100 ? 'positive' : kpis.targetAttainmentPct >= 75 ? 'warning' : 'negative'}
        tooltip="Active MRR divided by the sum of per-client monthly targets." />
      <KpiCard label="Forecast (30d)" value={kpis.forecast30d} tone="forecast"
        tooltip="Expected cash inflow over the next 30 days based on active subscriptions + scheduled invoices." />
    </div>
  );
}
