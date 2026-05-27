import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TabBreakdown } from '@/hooks/useSheetMetrics';

interface Props {
  tabs: TabBreakdown[];
  skipped?: { title: string; reason: string }[];
}

const fmtMoney = (n: number) => {
  if (!n) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
};
const fmtInt = (n: number) => (n ? n.toLocaleString() : '—');

type SortKey = 'title' | 'adSpend' | 'leads' | 'calls' | 'showedCalls' | 'fundedInvestors' | 'fundedDollars' | 'dayCount';

export function TabBreakdownDrilldown({ tabs, skipped = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'adSpend', dir: 'desc' });

  if (!tabs || tabs.length === 0) return null;

  const sorted = [...tabs].sort((a, b) => {
    const va = (a as any)[sort.key];
    const vb = (b as any)[sort.key];
    if (typeof va === 'string' && typeof vb === 'string') {
      return sort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return sort.dir === 'asc' ? (va || 0) - (vb || 0) : (vb || 0) - (va || 0);
  });

  const overlapCount = tabs.filter((t) => t.overlapDayCount > 0).length;
  const totalSpend = tabs.reduce((s, t) => s + (t.adSpend || 0), 0);

  const onSort = (key: SortKey) => {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  const SortHeader = ({ k, label, align = 'right' }: { k: SortKey; label: string; align?: 'left' | 'right' }) => (
    <th
      onClick={() => onSort(k)}
      className={cn(
        'px-3 py-2 cursor-pointer select-none text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.key === k && (sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  return (
    <Card className="p-5 rounded-2xl border-border/60 bg-card/60 backdrop-blur">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left group"
      >
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Metric Drilldown</p>
            <h3 className="text-base font-semibold mt-0.5" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
              Per-tab contribution
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">{tabs.length} tab{tabs.length === 1 ? '' : 's'}</Badge>
          {overlapCount > 0 && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" /> {overlapCount} overlap
            </Badge>
          )}
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Each row shows what a single sheet tab contributed to the KPIs in the current date range. Rows highlighted in
            amber share dates with another tab — check for duplicate rollups. De-dupe across tabs uses MAX per (date, metric),
            so overlapping values don't inflate totals, but the highest-value tab wins.
          </p>

          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <SortHeader k="title" label="Tab" align="left" />
                  <SortHeader k="dayCount" label="Days" />
                  <SortHeader k="adSpend" label="Spend" />
                  <SortHeader k="leads" label="Leads" />
                  <SortHeader k="calls" label="Booked" />
                  <SortHeader k="showedCalls" label="Showed" />
                  <SortHeader k="fundedInvestors" label="Funded #" />
                  <SortHeader k="fundedDollars" label="Funded $" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const hasOverlap = t.overlapDayCount > 0;
                  const sharePct = totalSpend > 0 ? (t.adSpend / totalSpend) * 100 : 0;
                  return (
                    <tr
                      key={t.title}
                      className={cn(
                        'border-t border-border/40 hover:bg-muted/30 transition-colors',
                        hasOverlap && 'bg-amber-500/5'
                      )}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate max-w-[220px]" title={t.title}>{t.title}</span>
                          {t.isPrimary && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">primary</Badge>}
                          {hasOverlap && (
                            <span
                              title={`${t.overlapDayCount} day(s) also appear in another tab`}
                              className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {t.overlapDayCount}
                            </span>
                          )}
                        </div>
                        {t.dateRange && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {t.dateRange.start} → {t.dateRange.end}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(t.dayCount)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <div>{fmtMoney(t.adSpend)}</div>
                        {sharePct > 0 && (
                          <div className="text-[9px] text-muted-foreground">{sharePct.toFixed(0)}%</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(t.leads)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(t.calls)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(t.showedCalls)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtInt(t.fundedInvestors)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(t.fundedDollars)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {skipped.length > 0 && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">
                {skipped.length} tab{skipped.length === 1 ? '' : 's'} skipped
              </summary>
              <ul className="mt-2 space-y-1 pl-4">
                {skipped.map((s) => (
                  <li key={s.title} className="flex items-center justify-between gap-3">
                    <span className="truncate">{s.title}</span>
                    <span className="text-muted-foreground/70 italic">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

export default TabBreakdownDrilldown;