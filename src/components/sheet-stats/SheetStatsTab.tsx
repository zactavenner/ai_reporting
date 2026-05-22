import { useMemo, useState } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subYears, differenceInDays, parseISO } from 'date-fns';
import {
  Calendar as CalendarIcon,
  ExternalLink,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  PhoneCall,
  CalendarCheck,
  DollarSign,
  Target,
  Activity,
  Handshake,
  Briefcase,
  Banknote,
} from 'lucide-react';
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

type Preset = 'y' | '7d' | '30d' | '90d' | 'tm' | 'lm' | 'ty' | 'ly' | 'custom';

function presetRange(p: Preset): { from: Date; to: Date } {
  const today = new Date();
  switch (p) {
    case 'y': { const y = subDays(today, 1); return { from: y, to: y }; }
    case '7d': return { from: subDays(today, 6), to: today };
    case '30d': return { from: subDays(today, 29), to: today };
    case '90d': return { from: subDays(today, 89), to: today };
    case 'tm': return { from: startOfMonth(today), to: today };
    case 'lm': {
      const prev = subMonths(today, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case 'ty': return { from: startOfYear(today), to: today };
    case 'ly': {
      const prev = subYears(today, 1);
      return { from: startOfYear(prev), to: endOfYear(prev) };
    }
    default: return { from: subDays(today, 29), to: today };
  }
}

function fmtMoney(n: number) {
  if (!isFinite(n) || isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
function fmtMoneyFull(n: number) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtInt(n: number) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return new Intl.NumberFormat().format(Math.round(n));
}
function fmtPct(n: number, digits = 1) {
  if (!isFinite(n) || isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}
function pctDelta(curr: number, prev: number): number | null {
  if (!prev) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  delta: number | null;
  /** if true, decreased value (negative delta) is good (green) */
  invert?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  hero?: boolean;
  accent?: 'default' | 'gold' | 'emerald';
}
function KpiTile({ label, value, sub, delta, invert, icon: Icon, hero, accent = 'default' }: KpiTileProps) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  const isGood = (invert ? isNegative : isPositive);
  const isBad = (invert ? isPositive : isNegative);
  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const accentRing =
    accent === 'gold' ? 'ring-1 ring-[hsl(40_45%_55%/0.35)]'
    : accent === 'emerald' ? 'ring-1 ring-emerald-500/25'
    : 'ring-1 ring-border/60';
  const accentText =
    accent === 'gold' ? 'text-[hsl(40_45%_55%)]'
    : accent === 'emerald' ? 'text-emerald-600'
    : 'text-primary';
  return (
    <Card
      className={cn(
        'relative overflow-hidden rounded-2xl border-border/60 bg-gradient-to-b from-card to-card/40 backdrop-blur p-5 transition-shadow hover:shadow-lg',
        accentRing,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{label}</p>
          <p
            className={cn(
              'mt-2 font-semibold tracking-tight text-foreground tabular-nums break-words leading-tight',
              hero ? 'text-2xl xl:text-3xl' : 'text-2xl',
            )}
            style={hero ? { fontFamily: 'Playfair Display, Georgia, serif' } : undefined}
          >
            {value}
          </p>
          {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn('shrink-0 rounded-xl p-2 bg-muted/60', accentText)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      {delta !== null && (
        <div className="mt-3 flex items-center gap-2">
          <div className={cn(
            'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full',
            isGood && 'bg-emerald-500/10 text-emerald-600',
            isBad && 'bg-destructive/10 text-destructive',
            !isGood && !isBad && 'bg-muted text-muted-foreground'
          )}>
            <TrendIcon className="h-3 w-3" />
            {Math.abs(delta).toFixed(1)}%
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">vs prior period</span>
        </div>
      )}
      {/* subtle corner shine */}
      <div className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-primary/5 blur-2xl" />
    </Card>
  );
}

function RatioPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-[140px] px-4 py-3 rounded-xl bg-muted/40 border border-border/50">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
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

  const [preset, setPreset] = useState<Preset>('y');
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
      { stage: 'Committed', value: agg.totalCommitments || 0 },
      { stage: 'Funded', value: agg.fundedInvestors || 0 },
    ];
  }, [agg]);

  // Conversion ratios
  const ratios = useMemo(() => {
    if (!agg) return null;
    const leadToBook = agg.totalLeads ? (agg.totalCalls / agg.totalLeads) * 100 : 0;
    const bookToShow = agg.totalCalls ? (agg.showedCalls / agg.totalCalls) * 100 : 0;
    const showToFund = agg.showedCalls ? (agg.fundedInvestors / agg.showedCalls) * 100 : 0;
    const leadToFund = agg.totalLeads ? (agg.fundedInvestors / agg.totalLeads) * 100 : 0;
    return { leadToBook, bookToShow, showToFund, leadToFund };
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
    { id: 'y', label: 'Yesterday' },
    { id: '7d', label: 'Last 7d' },
    { id: '30d', label: 'Last 30d' },
    { id: '90d', label: 'Last 90d' },
    { id: 'tm', label: 'This month' },
    { id: 'lm', label: 'Last month' },
    { id: 'ty', label: 'This year' },
    { id: 'ly', label: 'Last year' },
  ];

  return (
    <div className="space-y-6">
      {/* Executive header */}
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-primary/[0.06] via-card to-card p-6">
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
          backgroundImage: 'radial-gradient(circle at 20% 20%, hsl(var(--primary)) 0%, transparent 40%), radial-gradient(circle at 80% 0%, hsl(40 45% 55%) 0%, transparent 40%)'
        }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Performance Overview</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
              Executive Scorecard
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {format(range.from, 'MMM d, yyyy')} – {format(range.to, 'MMM d, yyyy')} · {days} day{days === 1 ? '' : 's'}
            </p>
          </div>
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button size="sm" variant="ghost" onClick={() => { current.refetch(); prior.refetch(); }} disabled={current.isFetching}>
            <RefreshCw className={cn('h-3 w-3', current.isFetching && 'animate-spin')} />
          </Button>
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              <ExternalLink className="h-3 w-3" /> Open sheet
            </a>
          )}
        </div>
      </div>
        </div>
      </div>

      {/* Hero KPIs */}
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
        <>
          {/* Hero row — what a CEO cares about */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KpiTile
              label="Pipeline Value"
              value={fmtMoneyFull((agg.totalLeads || 0) * 100_000)}
              sub={`${fmtInt(agg.totalLeads)} leads × $100k`}
              delta={pctDelta(agg.totalLeads, aggPrior?.totalLeads ?? 0)}
              icon={Briefcase}
              hero
              accent="gold"
            />
            <KpiTile
              label="Committed Investors"
              value={fmtInt(agg.totalCommitments)}
              sub={agg.totalLeads ? `${fmtPct((agg.totalCommitments / agg.totalLeads) * 100, 2)} of leads` : undefined}
              delta={pctDelta(agg.totalCommitments, aggPrior?.totalCommitments ?? 0)}
              icon={Handshake}
              hero
              accent="gold"
            />
            <KpiTile
              label="Committed Capital"
              value={fmtMoneyFull(agg.commitmentDollars)}
              sub="Soft-circled commitments"
              delta={pctDelta(agg.commitmentDollars, aggPrior?.commitmentDollars ?? 0)}
              icon={Banknote}
              hero
              accent="emerald"
            />
            <KpiTile
              label="Funded Investors"
              value={fmtInt(agg.fundedInvestors)}
              sub={ratios ? `${fmtPct(ratios.leadToFund)} of leads` : undefined}
              delta={pctDelta(agg.fundedInvestors, aggPrior?.fundedInvestors ?? 0)}
              icon={Target}
              hero
              accent="emerald"
            />
            <KpiTile
              label="Cost per Funded"
              value={fmtMoneyFull(agg.costPerInvestor)}
              sub="Blended acquisition cost"
              delta={pctDelta(agg.costPerInvestor, aggPrior?.costPerInvestor ?? 0)}
              icon={DollarSign}
              hero
              invert
            />
            <KpiTile
              label="Total Ad Spend"
              value={fmtMoneyFull(agg.totalAdSpend)}
              sub={`${days}-day investment`}
              delta={pctDelta(agg.totalAdSpend, aggPrior?.totalAdSpend ?? 0)}
              icon={Activity}
              hero
              invert
            />
          </div>

          {/* Conversion ribbon */}
          {ratios && (
            <Card className="p-4 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Conversion Funnel Rates</p>
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Stage → Stage</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <RatioPill label="Lead → Booked" value={fmtPct(ratios.leadToBook)} sub={`${fmtInt(agg.totalCalls)} of ${fmtInt(agg.totalLeads)}`} />
                <RatioPill label="Booked → Showed" value={fmtPct(ratios.bookToShow)} sub={`${fmtInt(agg.showedCalls)} of ${fmtInt(agg.totalCalls)}`} />
                <RatioPill label="Showed → Funded" value={fmtPct(ratios.showToFund)} sub={`${fmtInt(agg.fundedInvestors)} of ${fmtInt(agg.showedCalls)}`} />
                <RatioPill label="Lead → Funded" value={fmtPct(ratios.leadToFund, 2)} sub="End-to-end conversion" />
              </div>
            </Card>
          )}

          {/* Secondary KPI grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile label="Leads" value={fmtInt(agg.totalLeads)} delta={pctDelta(agg.totalLeads, aggPrior?.totalLeads ?? 0)} icon={Users} />
            <KpiTile label="Calls Booked" value={fmtInt(agg.totalCalls)} delta={pctDelta(agg.totalCalls, aggPrior?.totalCalls ?? 0)} icon={PhoneCall} />
            <KpiTile label="Shows" value={fmtInt(agg.showedCalls)} delta={pctDelta(agg.showedCalls, aggPrior?.showedCalls ?? 0)} icon={CalendarCheck} />
            <KpiTile label="Cost / Lead" value={fmtMoney(agg.costPerLead)} delta={pctDelta(agg.costPerLead, aggPrior?.costPerLead ?? 0)} invert />
            <KpiTile label="Cost / Booked" value={fmtMoney(agg.costPerCall)} delta={pctDelta(agg.costPerCall, aggPrior?.costPerCall ?? 0)} invert />
          </div>
        </>
      ) : (
        <Card className="p-6 rounded-2xl">
          <p className="text-sm text-muted-foreground">No data in the selected range.</p>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5 lg:col-span-2 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Daily Performance</p>
              <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Trend Analysis</h3>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" />Leads</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: 'hsl(40 45% 55%)' }} />Spend</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Funded</span>
            </div>
          </div>
          <div className="h-80">
            {chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No daily rows</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(40 45% 55%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(40 45% 55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--border))" tickLine={false} axisLine={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12, boxShadow: '0 8px 24px hsl(0 0% 0% / 0.08)' }}
                    cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                  />
                  <Area type="monotone" dataKey="leads" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#gradLeads)" />
                  <Area type="monotone" dataKey="spend" stroke="hsl(40 45% 55%)" strokeWidth={2} fill="url(#gradSpend)" />
                  <Area type="monotone" dataKey="funded" stroke="hsl(142 71% 45%)" strokeWidth={2.5} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
          <div className="mb-4">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Pipeline</p>
            <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>Conversion Funnel</h3>
          </div>
          <div className="h-80">
            {funnelData.length === 0 || funnelData.every((f) => !f.value) ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData} layout="vertical" margin={{ top: 5, right: 40, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="stage" type="category" width={70} tick={{ fontSize: 12, fill: 'hsl(var(--foreground))', fontWeight: 500 }} stroke="hsl(var(--border))" tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]} label={{ position: 'right', fill: 'hsl(var(--foreground))', fontSize: 11, fontWeight: 600 }}>
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

      {/* Footer meta */}
      {(current.data?.sheetTitle || current.data?.fetchedAt) && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1 pt-2 border-t border-border/40">
          <span>
            {current.data?.sheetTitle ? `Source: ${current.data.sheetTitle}` : ''}
            {current.data?.rowCount ? ` · ${current.data.rowCount} days` : ''}
          </span>
          {current.data?.fetchedAt && (
            <span>Last fetched {format(new Date(current.data.fetchedAt), 'MMM d, yyyy HH:mm')}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default SheetStatsTab;