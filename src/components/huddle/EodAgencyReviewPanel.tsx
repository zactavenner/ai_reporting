import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X, ChevronDown, ChevronRight, ClipboardList } from 'lucide-react';
import { yesterdayISO } from '@/hooks/useHuddle';
import { cn } from '@/lib/utils';

interface SnapshotTask {
  task_id?: string;
  title: string;
  client_id?: string | null;
  status?: 'in_progress' | 'completed' | 'blocked' | string;
  bucket?: 'today' | 'overdue' | string;
}

interface Row {
  member_id: string;
  member_name: string;
  wins_shared: string | null;
  self_assessment: number | null;
  tasks_snapshot: SnapshotTask[];
}

/**
 * Agency review panel for the Daily Huddle: shows what each teammate committed
 * to in their EOD last night, whether it got done, and last night's wins. This
 * is the direct EOD → Huddle bridge — the source of truth is
 * daily_reports.tasks_snapshot (bucket=today).
 */
export function EodAgencyReviewPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [clientMap, setClientMap] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const y = yesterdayISO();
      const [{ data: reports }, { data: members }, { data: clients }] = await Promise.all([
        supabase
          .from('daily_reports')
          .select('member_id, wins_shared, self_assessment, tasks_snapshot')
          .eq('report_type', 'eod')
          .eq('report_date', y),
        supabase.from('agency_members').select('id, name'),
        supabase.from('clients').select('id, name'),
      ]);
      const mMap: Record<string, string> = {};
      (members || []).forEach((m: any) => { mMap[m.id] = m.name; });
      const cMap: Record<string, string> = {};
      (clients || []).forEach((c: any) => { cMap[c.id] = c.name; });
      setClientMap(cMap);
      setRows(
        ((reports as any[]) || []).map((r) => ({
          member_id: r.member_id,
          member_name: mMap[r.member_id] || 'Team',
          wins_shared: r.wins_shared,
          self_assessment: r.self_assessment,
          tasks_snapshot: Array.isArray(r.tasks_snapshot) ? r.tasks_snapshot : [],
        }))
          .sort((a, b) => a.member_name.localeCompare(b.member_name))
      );
      setLoading(false);
    })();
  }, []);

  if (loading) return null;
  if (rows.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <ClipboardList className="w-4 h-4" />
        No EOD reports submitted last night.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-primary" /> Last night's EOD — agency review
        </div>
        <span className="text-xs text-muted-foreground">{rows.length} report{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const today = r.tasks_snapshot.filter((t) => t.bucket === 'today' || (!t.bucket && t.status !== 'in_progress'));
          const fallback = today.length === 0 ? r.tasks_snapshot : today;
          const done = fallback.filter((t) => t.status === 'completed').length;
          const total = fallback.length;
          const pct = total ? Math.round((done / total) * 100) : 0;
          const tone = pct >= 80 ? 'emerald' : pct >= 50 ? 'amber' : 'destructive';
          const isCollapsed = collapsed[r.member_id];
          return (
            <div key={r.member_id} className="border rounded-lg">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
                onClick={() => setCollapsed((p) => ({ ...p, [r.member_id]: !isCollapsed }))}
              >
                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span className="text-sm font-semibold flex-1">{r.member_name}</span>
                {total > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[11px]',
                      tone === 'emerald' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
                      tone === 'amber' && 'border-amber-500/40 bg-amber-500/10 text-amber-700',
                      tone === 'destructive' && 'border-destructive/40 bg-destructive/10 text-destructive'
                    )}
                  >
                    {done}/{total} done · {pct}%
                  </Badge>
                )}
                {r.self_assessment != null && (
                  <span className="text-[11px] text-muted-foreground">{r.self_assessment}/10</span>
                )}
              </button>
              {!isCollapsed && (
                <div className="px-3 pb-3 space-y-2">
                  {r.wins_shared && (
                    <div className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2">
                      <span className="font-medium text-foreground">Win: </span>{r.wins_shared}
                    </div>
                  )}
                  {fallback.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No tasks logged on EOD.</div>
                  ) : (
                    <div className="divide-y">
                      {fallback.map((t, i) => {
                        const isDone = t.status === 'completed';
                        return (
                          <div key={(t.task_id || '') + i} className="flex items-center gap-2 py-1.5">
                            <span className={cn(
                              'inline-flex items-center justify-center h-5 w-5 rounded-full shrink-0',
                              isDone ? 'bg-emerald-500/20 text-emerald-600' : 'bg-destructive/20 text-destructive'
                            )}>
                              {isDone ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                            </span>
                            {t.client_id && clientMap[t.client_id] && (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-bold">
                                {clientMap[t.client_id]}
                              </Badge>
                            )}
                            <span className={cn('text-sm flex-1 min-w-0 truncate', isDone && 'line-through text-muted-foreground')}>
                              {t.title}
                            </span>
                            {t.status === 'blocked' && (
                              <Badge variant="destructive" className="h-5 text-[10px]">BLOCKED</Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}