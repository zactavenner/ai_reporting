import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Target, Check, Pencil } from 'lucide-react';
import { useBillingTargets, useUpsertBillingTarget } from '@/hooks/useBillingTargets';
import { toast } from 'sonner';

interface Props {
  /** Actual collected revenue keyed by period_key (e.g. "2026", "2026-Q1"). */
  actualByKey: Record<string, number>;
  /** Active MRR — used to project pace to end of period. */
  activeMRR: number;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

function quarterOf(d: Date) {
  return Math.floor(d.getMonth() / 3) + 1;
}

/** Months elapsed (with fractional current month) inside a quarter or year. */
function monthsElapsed(period_type: 'quarter' | 'year', period_key: string, now: Date): { elapsed: number; total: number; isPast: boolean; isFuture: boolean } {
  if (period_type === 'year') {
    const y = Number(period_key);
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);
    if (now < start) return { elapsed: 0, total: 12, isPast: false, isFuture: true };
    if (now >= end) return { elapsed: 12, total: 12, isPast: true, isFuture: false };
    const days = (now.getTime() - start.getTime()) / 86400000;
    return { elapsed: days / 30.4375, total: 12, isPast: false, isFuture: false };
  }
  const [ys, qs] = period_key.split('-Q');
  const y = Number(ys); const q = Number(qs);
  const start = new Date(y, (q - 1) * 3, 1);
  const end = new Date(y, q * 3, 1);
  if (now < start) return { elapsed: 0, total: 3, isPast: false, isFuture: true };
  if (now >= end) return { elapsed: 3, total: 3, isPast: true, isFuture: false };
  const days = (now.getTime() - start.getTime()) / 86400000;
  return { elapsed: days / 30.4375, total: 3, isPast: false, isFuture: false };
}

export function BillingTargetsPanel({ actualByKey, activeMRR }: Props) {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const { data: targets = [] } = useBillingTargets();
  const upsert = useUpsertBillingTarget();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 1, y, y + 1, y + 2];
  }, [now]);

  const map = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of targets) m.set(`${t.period_type}:${t.period_key}`, Number(t.target_amount) || 0);
    return m;
  }, [targets]);

  const rows = useMemo(() => {
    const items: { key: string; label: string; period_type: 'quarter' | 'year'; period_key: string }[] = [
      { key: `year:${year}`, label: `${year} Annual`, period_type: 'year', period_key: String(year) },
      { key: `quarter:${year}-Q1`, label: `Q1 · Jan–Mar`, period_type: 'quarter', period_key: `${year}-Q1` },
      { key: `quarter:${year}-Q2`, label: `Q2 · Apr–Jun`, period_type: 'quarter', period_key: `${year}-Q2` },
      { key: `quarter:${year}-Q3`, label: `Q3 · Jul–Sep`, period_type: 'quarter', period_key: `${year}-Q3` },
      { key: `quarter:${year}-Q4`, label: `Q4 · Oct–Dec`, period_type: 'quarter', period_key: `${year}-Q4` },
    ];
    return items.map((it) => {
      const target = map.get(`${it.period_type}:${it.period_key}`) ?? 0;
      const actual = actualByKey[it.period_key] ?? 0;
      const { elapsed, total, isFuture, isPast } = monthsElapsed(it.period_type, it.period_key, now);
      const remaining = Math.max(0, total - elapsed);
      const projected = actual + activeMRR * remaining;
      const pct = target > 0 ? (actual / target) * 100 : 0;
      const projPct = target > 0 ? (projected / target) * 100 : 0;
      const paceTarget = target > 0 ? (target * (elapsed / total)) : 0;
      const paceDelta = actual - paceTarget; // + ahead / – behind
      return { ...it, target, actual, projected, pct, projPct, paceDelta, isFuture, isPast, elapsed, total };
    });
  }, [year, map, actualByKey, activeMRR, now]);

  const save = async (period_type: 'quarter' | 'year', period_key: string) => {
    const v = parseFloat(draft.replace(/[$,]/g, ''));
    if (Number.isNaN(v) || v < 0) { toast.error('Enter a valid amount'); return; }
    try {
      await upsert.mutateAsync({ period_type, period_key, target_amount: v });
      toast.success('Target saved');
      setEditing(null);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save');
    }
  };

  return (
    <Card className="border-2">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Revenue Targets
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Set annual and quarterly targets, track pace vs actuals, and see forward projection at current MRR.
            </p>
          </div>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => {
          const isEditing = editing === r.key;
          const status = r.target === 0
            ? { label: 'No target', tone: 'secondary' as const }
            : r.isFuture
              ? { label: 'Upcoming', tone: 'outline' as const }
              : r.pct >= 100
                ? { label: 'Hit', tone: 'default' as const }
                : r.projPct >= 100
                  ? { label: 'On pace', tone: 'default' as const }
                  : r.paceDelta >= 0
                    ? { label: 'Slightly behind', tone: 'secondary' as const }
                    : { label: 'Behind pace', tone: 'destructive' as const };

          return (
            <div key={r.key} className="rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${r.period_type === 'year' ? 'text-primary' : ''}`}>{r.label}</span>
                  <Badge variant={status.tone}>{status.label}</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</div>
                    <div className="font-bold tabular-nums">{fmt(r.actual)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Target</div>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <Input
                          autoFocus
                          type="number"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') save(r.period_type, r.period_key);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          className="h-7 w-28 text-xs"
                        />
                        <Button size="sm" className="h-7 px-2" onClick={() => save(r.period_type, r.period_key)}>
                          <Check className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditing(r.key); setDraft(String(r.target || '')); }}
                        className="font-bold tabular-nums inline-flex items-center gap-1 hover:underline"
                      >
                        {r.target > 0 ? fmt(r.target) : 'Set'}
                        <Pencil className="h-3 w-3 opacity-60" />
                      </button>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Projected</div>
                    <div className="font-bold tabular-nums text-primary">{fmt(r.projected)}</div>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">% to target</div>
                    <div className={`font-bold tabular-nums ${r.pct >= 100 ? 'text-chart-2' : r.pct >= 75 ? 'text-amber-500' : r.target > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {r.target > 0 ? `${r.pct.toFixed(0)}%` : '—'}
                    </div>
                  </div>
                </div>
              </div>
              {r.target > 0 && (
                <div className="mt-2">
                  <Progress value={Math.min(100, r.pct)} className="h-2" />
                  <div className="flex justify-between mt-1 text-[11px] text-muted-foreground">
                    <span>
                      Pace: {r.paceDelta >= 0 ? '+' : ''}{fmt(r.paceDelta)} vs plan
                    </span>
                    <span>
                      Projected {r.projPct.toFixed(0)}% of target at current MRR
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}