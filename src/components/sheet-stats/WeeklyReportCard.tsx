import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { qualityTone } from '@/lib/leadQuality';
import { useWeeklyReport, type WeeklyWindowMetrics, type WeeklyLeadRow } from '@/hooks/useWeeklyReport';

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const money2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0);
const int = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n || 0));
const pct = (n: number, d = 1) => `${(n || 0).toFixed(d)}%`;

type Row = {
  label: string;
  value: (m: WeeklyWindowMetrics) => number;
  fmt: (n: number) => string;
  /** lower is better */
  invert?: boolean;
  emphasis?: boolean;
};

const ROWS: Row[] = [
  { label: 'Ad spend', value: (m) => m.adSpend, fmt: money, invert: true, emphasis: true },
  { label: 'Leads', value: (m) => m.leads, fmt: int },
  { label: 'Cost per lead', value: (m) => (m.leads ? m.adSpend / m.leads : 0), fmt: money2, invert: true },
  { label: 'Discovery calls booked', value: (m) => m.discoveryCalls, fmt: int },
  { label: 'Cost per discovery call', value: (m) => (m.discoveryCalls ? m.adSpend / m.discoveryCalls : 0), fmt: money2, invert: true },
  { label: 'Showed calls', value: (m) => m.showedCalls, fmt: int },
  { label: 'Show rate', value: (m) => (m.discoveryCalls ? (m.showedCalls / m.discoveryCalls) * 100 : 0), fmt: (n) => pct(n) },
  { label: 'Cost per show', value: (m) => (m.showedCalls ? m.adSpend / m.showedCalls : 0), fmt: money2, invert: true },
  { label: 'Commitments', value: (m) => m.commitments, fmt: int },
  { label: 'Commitment $', value: (m) => m.commitmentDollars, fmt: money, emphasis: true },
  { label: 'Cost per commitment', value: (m) => (m.commitments ? m.adSpend / m.commitments : 0), fmt: money2, invert: true },
  { label: 'Funded investors', value: (m) => m.fundedInvestors, fmt: int },
  { label: 'Funded $', value: (m) => m.fundedDollars, fmt: money, emphasis: true },
  { label: 'Cost per investor', value: (m) => (m.fundedInvestors ? m.adSpend / m.fundedInvestors : 0), fmt: money2, invert: true },
  { label: 'Cost of capital', value: (m) => (m.fundedDollars ? (m.adSpend / m.fundedDollars) * 100 : 0), fmt: (n) => pct(n, 2), invert: true, emphasis: true },
  { label: 'Reconnect calls', value: (m) => m.reconnectCalls, fmt: int },
];

function Delta({ current, prior, invert }: { current: number; prior: number; invert?: boolean }) {
  if (!prior && !current) return <span className="text-muted-foreground">—</span>;
  const change = prior > 0 ? ((current - prior) / prior) * 100 : current > 0 ? 100 : 0;
  const good = invert ? change <= 0 : change >= 0;
  if (Math.abs(change) < 0.05) return <span className="text-muted-foreground">flat</span>;
  return (
    <span className={cn('tabular-nums font-medium', good ? 'text-emerald-600' : 'text-destructive')}>
      {change > 0 ? '+' : ''}{change.toFixed(1)}%
    </span>
  );
}

function FreshnessStrip({
  freshness,
  to,
}: {
  freshness: ReturnType<typeof useWeeklyReport>['data'] extends infer T ? any : any;
  to: string;
}) {
  const stale = freshness.spendDaysStale == null || freshness.spendDaysStale > 2;
  const sheetOk = !freshness.lastSheetStatus || /ok|success|complete/i.test(freshness.lastSheetStatus);
  const problem = stale || !sheetOk || freshness.openDiscrepancies > 0;

  const items = [
    {
      label: 'Last Meta spend day',
      value: freshness.lastSpendDay ? format(parseISO(freshness.lastSpendDay), 'MMM d') : 'none',
      bad: stale,
    },
    {
      label: 'Last CRM record',
      value: freshness.lastCrmSync ? format(new Date(freshness.lastCrmSync), 'MMM d, h:mm a') : 'none',
      bad: !freshness.lastCrmSync,
    },
    {
      label: 'Last sheet write',
      value: freshness.lastSheetWrite ? format(new Date(freshness.lastSheetWrite), 'MMM d, h:mm a') : 'none',
      bad: !sheetOk || !freshness.lastSheetWrite,
    },
    {
      label: 'Open discrepancies',
      value: int(freshness.openDiscrepancies),
      bad: freshness.openDiscrepancies > 0,
    },
  ];

  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5',
        problem ? 'border-amber-500/40 bg-amber-500/[0.07]' : 'border-emerald-500/30 bg-emerald-500/[0.06]',
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {problem ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        )}
        <p className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
          Data freshness · report window ends {format(parseISO(to), 'MMM d')}
        </p>
        {problem && (
          <span className="text-[11px] font-medium text-amber-700">
            {stale
              ? `Ad spend is ${freshness.spendDaysStale == null ? 'missing' : `${freshness.spendDaysStale} day(s) behind`} — numbers below are incomplete`
              : 'Check sync health before sending'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg bg-background/60 border border-border/50 px-2.5 py-1.5">
            <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">{it.label}</p>
            <p className={cn('text-xs font-semibold tabular-nums mt-0.5', it.bad && 'text-amber-700')}>{it.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadTable({ leads }: { leads: WeeklyLeadRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'created'>('score');
  const sorted = useMemo(() => {
    const rows = [...leads];
    if (sortBy === 'score') rows.sort((a, b) => b.score - a.score);
    if (sortBy === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'created') rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows;
  }, [leads, sortBy]);
  const visible = expanded ? sorted : sorted.slice(0, 15);

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Phone', 'Created', 'Source', 'Campaign', 'Disposition', 'Booked', 'Showed', 'Funded', 'Quality (1-10)'];
    const lines = sorted.map((l) => [
      l.name, l.email ?? '', l.phone ?? '', l.createdAt.slice(0, 10), l.source ?? '', l.campaign ?? '',
      l.disposition ?? '', l.booked ? 'yes' : 'no', l.showed ? 'yes' : 'no', l.funded ? 'yes' : 'no', String(l.score),
    ]);
    const csv = [header, ...lines]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const avg = leads.length ? leads.reduce((s, l) => s + l.score, 0) / leads.length : 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Lead Quality</p>
          <h4 className="text-sm font-semibold mt-0.5">
            {int(leads.length)} leads this week · avg score {avg.toFixed(1)}/10
          </h4>
        </div>
        <div className="flex items-center gap-1.5">
          {(['score', 'created', 'name'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={cn(
                'px-2.5 py-1 text-[11px] rounded-full font-medium transition-colors',
                sortBy === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {s === 'score' ? 'Quality' : s === 'created' ? 'Newest' : 'Name'}
            </button>
          ))}
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={exportCsv} disabled={!leads.length}>
            <Download className="h-3 w-3" /> CSV
          </Button>
        </div>
      </div>

      {leads.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">No leads in this week's window.</p>
      ) : (
        <>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border/60">
                  <th className="py-2 px-2 font-medium">Lead</th>
                  <th className="py-2 px-2 font-medium hidden md:table-cell">Contact</th>
                  <th className="py-2 px-2 font-medium hidden lg:table-cell">Source</th>
                  <th className="py-2 px-2 font-medium">Stage</th>
                  <th className="py-2 px-2 font-medium text-right">Quality</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr key={l.id} className="border-b border-border/40 last:border-0">
                    <td className="py-2 px-2">
                      <p className="font-medium truncate max-w-[180px]">{l.name}</p>
                      <p className="text-[10px] text-muted-foreground">{format(new Date(l.createdAt), 'MMM d')}</p>
                    </td>
                    <td className="py-2 px-2 hidden md:table-cell">
                      <p className="truncate max-w-[180px] text-muted-foreground">{l.email || '—'}</p>
                      <p className="text-[10px] text-muted-foreground">{l.phone || 'no phone'}</p>
                    </td>
                    <td className="py-2 px-2 hidden lg:table-cell text-muted-foreground truncate max-w-[160px]">
                      {l.campaign || l.source || '—'}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex flex-wrap gap-1">
                        {l.funded && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">Funded</Badge>}
                        {l.showed && !l.funded && <Badge variant="outline" className="text-[10px]">Showed</Badge>}
                        {l.booked && !l.showed && !l.funded && <Badge variant="outline" className="text-[10px]">Booked</Badge>}
                        {l.isSpam && <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">Spam</Badge>}
                        {!l.booked && !l.isSpam && !l.funded && (
                          <span className="text-[10px] text-muted-foreground">
                            {l.disposition ? l.disposition.replace(/_/g, ' ') : 'New'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                'inline-flex items-center justify-center min-w-[34px] px-2 py-0.5 rounded-full border text-[11px] font-semibold tabular-nums cursor-help',
                                qualityTone(l.score),
                              )}
                            >
                              {l.score}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[260px]">
                            <p className="text-[11px] font-semibold mb-1">Why {l.score}/10</p>
                            <ul className="space-y-0.5">
                              {l.reasons.map((r, i) => (
                                <li key={i} className="text-[11px] flex justify-between gap-3">
                                  <span>{r.label}</span>
                                  <span className="tabular-nums text-muted-foreground">
                                    {r.points ? `+${r.points}` : '0'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {l.statedLow > 0 && (
                              <p className="text-[10px] text-muted-foreground mt-1">
                                Stated capital: {money(l.statedLow)}
                              </p>
                            )}
                            {l.storedScore == null && (
                              <p className="text-[10px] text-muted-foreground mt-1">Computed live (not yet scored nightly)</p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length > 15 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
              {expanded ? 'Show fewer' : `Show all ${sorted.length} leads`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function NotesEditor({ clientId, weekStart }: { clientId: string; weekStart: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<{ wins: string; risks: string; next_plan: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ['weekly-report-notes', clientId, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_weekly_report_notes')
        .select('wins, risks, next_plan')
        .eq('client_id', clientId)
        .eq('week_start', weekStart)
        .maybeSingle();
      if (error) throw error;
      return data ?? { wins: '', risks: '', next_plan: '' };
    },
    enabled: !!clientId,
  });

  const value = draft ?? {
    wins: data?.wins ?? '',
    risks: data?.risks ?? '',
    next_plan: data?.next_plan ?? '',
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('client_weekly_report_notes')
      .upsert(
        { client_id: clientId, week_start: weekStart, ...value },
        { onConflict: 'client_id,week_start' },
      );
    setSaving(false);
    if (error) {
      toast({ variant: 'destructive', title: 'Could not save commentary', description: error.message });
      return;
    }
    setDraft(null);
    qc.invalidateQueries({ queryKey: ['weekly-report-notes', clientId, weekStart] });
    toast({ title: 'Commentary saved', description: 'It will be included in the emailed report.' });
  };

  const fields: { key: 'wins' | 'risks' | 'next_plan'; label: string; placeholder: string }[] = [
    { key: 'wins', label: 'Wins', placeholder: 'What went well this week…' },
    { key: 'risks', label: 'Risks', placeholder: 'What is at risk or off-track…' },
    { key: 'next_plan', label: "Next week's plan", placeholder: 'What we are changing next week…' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
          Commentary · week of {format(parseISO(weekStart), 'MMM d')}
        </p>
        <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={save} disabled={saving || !draft}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {fields.map((f) => (
          <div key={f.key}>
            <p className="text-[11px] font-medium mb-1">{f.label}</p>
            <Textarea
              rows={3}
              value={value[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setDraft({ ...value, [f.key]: e.target.value })}
              className="text-xs resize-y"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeeklyReportCard({ clientId, isPublicView }: { clientId: string; isPublicView?: boolean }) {
  const { data, isLoading, isFetching, refetch } = useWeeklyReport(clientId);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [scoring, setScoring] = useState(false);

  const rescore = async () => {
    setScoring(true);
    const { data: res, error } = await supabase.functions.invoke('score-lead-quality', {
      body: { client_id: clientId, days: 45 },
    });
    setScoring(false);
    if (error) {
      toast({ variant: 'destructive', title: 'Scoring failed', description: error.message });
      return;
    }
    toast({ title: 'Lead scores refreshed', description: `${(res as any)?.scored ?? 0} leads scored.` });
    qc.invalidateQueries({ queryKey: ['weekly-report', clientId] });
  };

  if (isLoading) {
    return <Skeleton className="h-72 rounded-2xl" />;
  }
  if (!data) return null;

  const { current, prior, range, priorRange } = data;

  return (
    <Card className="p-5 rounded-2xl border-border/60 bg-card/60 backdrop-blur space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Weekly Report</p>
          <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
            Last 7 Days vs Prior 7 Days
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {format(parseISO(range.from), 'MMM d')} – {format(parseISO(range.to), 'MMM d')} vs{' '}
            {format(parseISO(priorRange.from), 'MMM d')} – {format(parseISO(priorRange.to), 'MMM d')} · Meta spend + CRM
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {!isPublicView && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={rescore} disabled={scoring}>
              {scoring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Rescore leads
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <FreshnessStrip freshness={data.freshness} to={range.to} />

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border/60">
              <th className="py-2 px-2 text-left font-medium">Metric</th>
              <th className="py-2 px-2 text-right font-medium">This week</th>
              <th className="py-2 px-2 text-right font-medium">Prior week</th>
              <th className="py-2 px-2 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const cur = r.value(current);
              const pre = r.value(prior);
              return (
                <tr key={r.label} className={cn('border-b border-border/40 last:border-0', r.emphasis && 'bg-muted/30')}>
                  <td className={cn('py-2 px-2', r.emphasis && 'font-semibold')}>{r.label}</td>
                  <td className={cn('py-2 px-2 text-right tabular-nums', r.emphasis && 'font-semibold')}>{r.fmt(cur)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.fmt(pre)}</td>
                  <td className="py-2 px-2 text-right"><Delta current={cur} prior={pre} invert={r.invert} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.dispositionMix.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold mb-2">
            Disposition mix · this week
          </p>
          <div className="flex flex-wrap gap-2">
            {data.dispositionMix.map(([label, count]) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px]"
              >
                <span className="font-medium">{label}</span>
                <span className="tabular-nums text-muted-foreground">{int(count)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <LeadTable leads={data.leads} />

      {!isPublicView && <NotesEditor clientId={clientId} weekStart={range.from} />}
    </Card>
  );
}

export default WeeklyReportCard;
