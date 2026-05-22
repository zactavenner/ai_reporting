import { useMemo, useState } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths, differenceInDays, parseISO } from 'date-fns';
import { Calendar as CalendarIcon, ExternalLink, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import { useClientSettings } from '@/hooks/useClientSettings';
import { useSheetMetrics } from '@/hooks/useSheetMetrics';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function parseSheetUrl(url?: string | null): { sheet_id: string; gid?: string } | null {
  if (!url) return null;
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#?&]gid=(\d+)/);
  return { sheet_id: idMatch[1], gid: gidMatch?.[1] };
}

type Preset = '7d' | '30d' | '90d' | 'tm' | 'lm' | 'custom';

function presetRange(p: Preset): { from: Date; to: Date } {
  const today = new Date();
  switch (p) {
    case '7d': return { from: subDays(today, 6), to: today };
    case '30d': return { from: subDays(today, 29), to: today };
    case '90d': return { from: subDays(today, 89), to: today };
    case 'tm': return { from: startOfMonth(today), to: today };
    case 'lm': {
      const prev = subMonths(today, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    default: return { from: subDays(today, 29), to: today };
  }
}

function fmtMoney(n: number) {
  if (!isFinite(n)) return '—';
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
}
function fmtInt(n: number) {
  if (!isFinite(n)) return '—';
  return new Intl.NumberFormat().format(Math.round(n));
}
function pctDelta(curr: number, prev: number): number | null {
  if (!prev) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

interface KpiTileProps {
  label: string;
  value: string;
  delta: number | null;
  /** if true, decreased value (negative delta) is good (green) */
  invert?: boolean;
}
function KpiTile({ label, value, delta, invert }: KpiTileProps) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  const isGood = (invert ? isNegative : isPositive);
  const isBad = (invert ? isPositive : isNegative);
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  return (
    <Card className="p-4 bg-card/60 backdrop-blur border-border rounded-2xl">
      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1 text-foreground">{value}</p>
      {delta !== null && (
        <div className={cn(
          'mt-2 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
          isGood && 'bg-emerald-500/10 text-emerald-600',
          isBad && 'bg-destructive/10 text-destructive',
          !isGood && !isBad && 'bg-muted text-muted-foreground'
        )}>
          <Icon className="h-3 w-3" />
          {Math.abs(delta).toFixed(1)}% vs prior
        </div>
      )}
    </Card>
  );
}

interface Props {
  clientId: string;
  isPublicView?: boolean;
}

export function SheetStatsTab({ clientId, isPublicView }: Props) {
  const { data: settings } = useClientSettings(clientId);
  const sheetUrl = (settings as any)?.kpi_google_sheet_url as string | undefined;
  const parsed = parseSheetUrl(sheetUrl);

  const [preset, setPreset] = useState<Preset>('30d');
  const [customRange, setCustomRange] = useState<{ from?: Date; to?: Date }>({});

  const range = preset === 'custom'
    ? { from: customRange.from ?? subDays(new Date(), 29), to: customRange.to ?? new Date() }
    : presetRange(preset);

  const from = format(range.from, 'yyyy-MM-dd');
  const to = format(range.to, 'yyyy-MM-dd');

  // Prior period of equal length
  const days = Math.max(1, differenceInDays(range.to, range.from) + 1);
  const priorTo = format(subDays(range.from, 1), 'yyyy-MM-dd');
  const priorFrom = format(subDays(range.from, days), 'yyyy-MM-dd');

  const current = useSheetMetrics(clientId, parsed?.sheet_id, parsed?.gid, from, to);
  const prior = useSheetMetrics(clientId, parsed?.sheet_id, parsed?.gid, priorFrom, priorTo);

  const agg = current.data?.aggregated;
  const aggPrior = prior.data?.aggregated;
  const daily = current.data?.daily ?? [];

  const chartData = useMemo(() => {
    return [...daily]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: format(parseISO(d.date), 'MMM d'),
        leads: d.leads || 0,
        spend: Number(d.ad_spend || 0),
        funded: d.funded_investors || 0,
      }));
  }, [daily]);

  const funnelData = useMemo(() => {
    if (!agg) return [];
    return [
      { stage: 'Leads', value: agg.totalLeads || 0 },
      { stage: 'Booked', value: agg.totalCalls || 0 },
      { stage: 'Showed', value: agg.showedCalls || 0 },
      { stage: 'Funded', value: agg.fundedInvestors || 0 },
    ];
  }, [agg]);

  if (!parsed) {
    return (
      <div className="border-2 border-dashed border-border bg-card rounded-2xl p-12 text-center">
        <p className="text-sm text-muted-foreground">
          No reporting Google Sheet configured for this client yet.
        </p>
        {!isPublicView && (
          <p className="text-xs text-muted-foreground mt-2">
            Add a sheet URL in Settings → Reporting Sheet to enable the dashboard.
          </p>
        )}
      </div>
    );
  }

  const presets: { id: Preset; label: string }[] = [
    { id: '7d', label: 'Last 7d' },
    { id: '30d', label: 'Last 30d' },
    { id: '90d', label: 'Last 90d' },
    { id: 'tm', label: 'This month' },
    { id: 'lm', label: 'Last month' },
  ];

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-full bg-muted">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-full transition-colors',
                preset === p.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {p.label}
            </button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-full inline-flex items-center gap-1 transition-colors',
                  preset === 'custom' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <CalendarIcon className="h-3 w-3" />
                Custom
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={{ from: customRange.from, to: customRange.to }}
                onSelect={(r: any) => {
                  setCustomRange({ from: r?.from, to: r?.to });
                  if (r?.from && r?.to) setPreset('custom');
                }}
                numberOfMonths={2}
                className={cn('p-3 pointer-events-auto')}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>{format(range.from, 'MMM d')} – {format(range.to, 'MMM d, yyyy')}</span>
          <Button size="sm" variant="ghost" onClick={() => { current.refetch(); prior.refetch(); }} disabled={current.isFetching}>
            <RefreshCw className={cn('h-3 w-3', current.isFetching && 'animate-spin')} />
          </Button>
          {!isPublicView && sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              <ExternalLink className="h-3 w-3" /> Open sheet
            </a>
          )}
        </div>
      </div>

      {/* KPI grid */}
      {current.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : current.error ? (
        <Card className="p-6 border-destructive/40 bg-destructive/5 rounded-2xl">
          <p className="text-sm text-destructive font-medium">Could not load sheet data</p>
          <p className="text-xs text-muted-foreground mt-1">{(current.error as any)?.message}</p>
        </Card>
      ) : agg ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Leads" value={fmtInt(agg.totalLeads)} delta={pctDelta(agg.totalLeads, aggPrior?.totalLeads ?? 0)} />
          <KpiTile label="Calls Booked" value={fmtInt(agg.totalCalls)} delta={pctDelta(agg.totalCalls, aggPrior?.totalCalls ?? 0)} />
          <KpiTile label="Shows" value={fmtInt(agg.showedCalls)} delta={pctDelta(agg.showedCalls, aggPrior?.showedCalls ?? 0)} />
          <KpiTile label="Funded" value={fmtInt(agg.fundedInvestors)} delta={pctDelta(agg.fundedInvestors, aggPrior?.fundedInvestors ?? 0)} />
          <KpiTile label="Ad Spend" value={fmtMoney(agg.totalAdSpend)} delta={pctDelta(agg.totalAdSpend, aggPrior?.totalAdSpend ?? 0)} invert />
          <KpiTile label="Cost / Lead" value={fmtMoney(agg.costPerLead)} delta={pctDelta(agg.costPerLead, aggPrior?.costPerLead ?? 0)} invert />
          <KpiTile label="Cost / Booked" value={fmtMoney(agg.costPerCall)} delta={pctDelta(agg.costPerCall, aggPrior?.costPerCall ?? 0)} invert />
          <KpiTile label="Cost / Funded" value={fmtMoney(agg.costPerInvestor)} delta={pctDelta(agg.costPerInvestor, aggPrior?.costPerInvestor ?? 0)} invert />
        </div>
      ) : (
        <Card className="p-6 rounded-2xl">
          <p className="text-sm text-muted-foreground">No data in the selected range.</p>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2 rounded-2xl">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold">Trend</h3>
            <span className="text-xs text-muted-foreground">Leads · Spend · Funded</span>
          </div>
          <div className="h-72">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No daily rows</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="leads" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#gradLeads)" />
                  <Area type="monotone" dataKey="spend" stroke="hsl(var(--muted-foreground))" strokeWidth={2} fill="url(#gradSpend)" />
                  <Area type="monotone" dataKey="funded" stroke="hsl(var(--accent-foreground))" strokeWidth={2} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-4 rounded-2xl">
          <h3 className="text-sm font-bold mb-3">Funnel</h3>
          <div className="h-72">
            {funnelData.length === 0 || funnelData.every((f) => !f.value) ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} layout="vertical" margin={{ top: 5, right: 24, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="stage" type="category" width={70} tick={{ fontSize: 12, fill: 'hsl(var(--foreground))' }} stroke="hsl(var(--border))" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                    {funnelData.map((_, i) => (
                      <Cell key={i} fill={`hsl(var(--primary) / ${1 - i * 0.18})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Daily table */}
      <Card className="rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold">Daily breakdown</h3>
          <span className="text-xs text-muted-foreground">
            {current.data?.sheetTitle ? `${current.data.sheetTitle} · ` : ''}
            {current.data?.rowCount ?? daily.length} rows
          </span>
        </div>
        <div className="overflow-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium text-right">Spend</th>
                <th className="px-4 py-2 font-medium text-right">Leads</th>
                <th className="px-4 py-2 font-medium text-right">Calls</th>
                <th className="px-4 py-2 font-medium text-right">Showed</th>
                <th className="px-4 py-2 font-medium text-right">Funded</th>
                <th className="px-4 py-2 font-medium text-right">$ Funded</th>
              </tr>
            </thead>
            <tbody>
              {daily.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">No rows</td></tr>
              ) : (
                [...daily].sort((a, b) => b.date.localeCompare(a.date)).map((d) => (
                  <tr key={d.date} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{format(parseISO(d.date), 'MMM d, yyyy')}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(Number(d.ad_spend || 0))}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(d.leads || 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(d.calls || 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(d.showed_calls || 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtInt(d.funded_investors || 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(Number(d.funded_dollars || 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {current.data?.fetchedAt && (
          <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
            Last fetched {format(new Date(current.data.fetchedAt), 'MMM d, yyyy HH:mm')}
          </div>
        )}
      </Card>
    </div>
  );
}

export default SheetStatsTab;