import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Flame, Plus, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { yesterdayISO } from '@/hooks/useHuddle';

interface TaskRow {
  id: string;
  title: string;
  status: string;
  assigned_to: string | null;
  client_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  source: string | null;
  huddle_id: string | null;
  assignee_ids?: string[];
}

export function AccountabilitySegment({ huddleId }: { huddleId: string }) {
  const { currentMember } = useTeamMember();
  const [yesterdayTasks, setYesterdayTasks] = useState<TaskRow[]>([]);
  const [notDoneReason, setNotDoneReason] = useState<Record<string, string>>({});
  const [todayTitle, setTodayTitle] = useState('');
  const [todayTasks, setTodayTasks] = useState<TaskRow[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [clientsMap, setClientsMap] = useState<Record<string, string>>({});
  const [scoreboard, setScoreboard] = useState<{ name: string; pct: number; total: number; done: number }[]>([]);
  const [eodPriorities, setEodPriorities] = useState<{ member: string; items: string[] }[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const today = new Date().toISOString().slice(0, 10);

  const loadAll = async () => {
      const y = yesterdayISO();
      const { data: yh } = await supabase.from('huddles').select('id').eq('date', y).maybeSingle();
      const yHid = yh?.id;
      const [{ data: ym }, { data: cl }] = await Promise.all([
        supabase.from('agency_members').select('id,name'),
        supabase.from('clients').select('id,name').in('status', ['active', 'onboarding']),
      ]);
      const mMap: Record<string, string> = {};
      (ym || []).forEach((m: any) => { mMap[m.id] = m.name; });
      setMembers(mMap);
      const cMap: Record<string, string> = {};
      (cl || []).forEach((c: any) => { cMap[c.id] = c.name; });
      setClientsMap(cMap);

      let yTasks: TaskRow[] = [];
      if (yHid) {
        const { data } = await supabase.from('tasks').select('*').eq('huddle_id', yHid);
        yTasks = (data as any) || [];
      }
      // Yesterday's rolled-over huddle commitments (still open)
      const { data: overdueHuddle } = await supabase
        .from('tasks')
        .select('*')
        .eq('source', 'huddle')
        .lte('due_date', y)
        .not('status', 'in', '(completed,done,cancelled)');
      const merged = [...(overdueHuddle as any || []), ...yTasks.filter(t => !(overdueHuddle as any || []).some((o: any) => o.id === t.id))];
      setYesterdayTasks(merged);

      // Yesterday's EOD priorities (surface commitments made outside huddle)
      const { data: eod } = await supabase
        .from('daily_reports')
        .select('member_id, top_priorities')
        .eq('report_date', y)
        .eq('report_type', 'eod');
      setEodPriorities(
        ((eod as any) || [])
          .filter((r: any) => Array.isArray(r.top_priorities) && r.top_priorities.length)
          .map((r: any) => ({ member: mMap[r.member_id] || 'Team', items: r.top_priorities }))
      );

      // Score by owner
      const byOwner: Record<string, { done: number; total: number }> = {};
      yTasks.forEach((t) => {
        const owner = t.assigned_to || 'unassigned';
        (byOwner[owner] ||= { done: 0, total: 0 }).total += 1;
        if (t.status === 'completed' || t.status === 'done') byOwner[owner].done += 1;
      });
      setScoreboard(
        Object.entries(byOwner).map(([id, v]) => ({
          name: mMap[id] || 'Unassigned',
          done: v.done,
          total: v.total,
          pct: v.total ? Math.round((v.done / v.total) * 100) : 0,
        })).sort((a, b) => b.pct - a.pct)
      );

      // Real Today's Tasks: everything open due today or overdue, PLUS today's huddle tasks
      const { data: openTasks } = await supabase
        .from('tasks')
        .select('*')
        .lte('due_date', today)
        .not('status', 'in', '(completed,done,cancelled)');
      const { data: huddleToday } = await supabase.from('tasks').select('*').eq('huddle_id', huddleId);
      const dedupe: Record<string, TaskRow> = {};
      [...(openTasks as any || []), ...(huddleToday as any || [])].forEach((t: any) => { dedupe[t.id] = t; });
      const combined = Object.values(dedupe);

      // Fetch multi-assignees for these tasks
      const ids = combined.map(t => t.id);
      if (ids.length) {
        const { data: assigns } = await supabase
          .from('task_assignees')
          .select('task_id, member_id')
          .in('task_id', ids);
        const aMap: Record<string, string[]> = {};
        (assigns || []).forEach((a: any) => {
          if (a.member_id) (aMap[a.task_id] ||= []).push(a.member_id);
        });
        combined.forEach(t => {
          t.assignee_ids = aMap[t.id] || (t.assigned_to ? [t.assigned_to] : []);
        });
      }
      setTodayTasks(combined);
  };

  useEffect(() => {
    loadAll();
    // Realtime: keep tasks + assignees in sync across viewers
    const ch = supabase
      .channel(`huddle-accountability-${huddleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignees' }, () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huddleId]);

  const toggleDone = async (t: TaskRow, done: boolean) => {
    if (!done && !notDoneReason[t.id]) {
      toast.warning('Enter a reason before marking not done');
      return;
    }
    if (done) {
      await supabase.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', t.id);
      setYesterdayTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: 'completed', completed_at: new Date().toISOString() } : x));
    } else {
      // reschedule to today with a note appended
      await supabase.from('tasks').update({ due_date: today }).eq('id', t.id);
      await supabase.from('task_history').insert({ task_id: t.id, action: 'rescheduled', changes: { reason: notDoneReason[t.id], from: t.due_date, to: today } } as any);
      toast.success('Rescheduled to today');
    }
  };

  const toggleTodayDone = async (t: TaskRow, done: boolean) => {
    await supabase.from('tasks').update({
      status: done ? 'completed' : 'pending',
      completed_at: done ? new Date().toISOString() : null,
    }).eq('id', t.id);
  };

  const addToday = async () => {
    if (!todayTitle.trim()) return;
    const { data } = await supabase.from('tasks').insert({
      title: todayTitle.trim(),
      status: 'pending',
      priority: 'medium',
      stage: 'today',
      assigned_to: currentMember?.id ?? null,
      due_date: today,
      source: 'huddle',
      huddle_id: huddleId,
    } as any).select('*').single();
    if (data) setTodayTasks(prev => [...prev, data as any]);
    setTodayTitle('');
  };

  // Group Today's Tasks by client → assignee
  const grouped = useMemo(() => {
    const byClient: Record<string, { clientName: string; byMember: Record<string, TaskRow[]> }> = {};
    todayTasks.forEach((t) => {
      const clientKey = t.client_id || '__agency__';
      const clientName = t.client_id ? (clientsMap[t.client_id] || 'Unknown Client') : 'Agency / Internal';
      byClient[clientKey] ||= { clientName, byMember: {} };
      const owners = t.assignee_ids && t.assignee_ids.length ? t.assignee_ids : ['__unassigned__'];
      owners.forEach((mid) => {
        (byClient[clientKey].byMember[mid] ||= []).push(t);
      });
    });
    return Object.entries(byClient).sort((a, b) => a[1].clientName.localeCompare(b[1].clientName));
  }, [todayTasks, clientsMap]);

  const isOverdue = (t: TaskRow) => t.due_date && t.due_date < today;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-4">
      {scoreboard.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {scoreboard.map((s) => (
            <div key={s.name} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${s.pct >= 80 ? 'border-emerald-500/40 bg-emerald-500/10' : s.pct >= 50 ? 'border-amber-500/40 bg-amber-500/10' : 'border-destructive/40 bg-destructive/10'}`}>
              {s.pct >= 80 && <Flame className="inline w-3 h-3 mr-1" />}
              {s.name}: {s.pct}% ({s.done}/{s.total})
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-semibold mb-2">Yesterday's Commitments</div>
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {yesterdayTasks.length === 0 && <div className="text-sm text-muted-foreground">Nothing to review.</div>}
            {yesterdayTasks.map((t) => {
              const done = t.status === 'completed' || t.status === 'done';
              return (
                <Card key={t.id} className="p-3">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={done} onCheckedChange={(v) => toggleDone(t, !!v)} />
                    <div className="flex-1">
                      <div className={`text-sm ${done ? 'line-through text-muted-foreground' : ''}`}>{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {members[t.assigned_to || ''] || 'Unassigned'} · due {t.due_date || '—'}
                      </div>
                    </div>
                  </div>
                  {!done && (
                    <Input
                      className="mt-2 h-8 text-xs"
                      placeholder="Reason (required to reschedule)"
                      value={notDoneReason[t.id] || ''}
                      onChange={(e) => setNotDoneReason(p => ({ ...p, [t.id]: e.target.value }))}
                    />
                  )}
                </Card>
              );
            })}
            {eodPriorities.length > 0 && (
              <div className="pt-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1">From yesterday's EOD reports</div>
                {eodPriorities.map((e, i) => (
                  <div key={i} className="text-xs text-muted-foreground mb-1">
                    <span className="font-medium">{e.member}:</span> {e.items.join(' · ')}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold">Today's Tasks ({todayTasks.length})</div>
            <div className="text-xs text-muted-foreground">Live · grouped by client</div>
          </div>
          <div className="flex gap-2 mb-2">
            <Input
              value={todayTitle}
              onChange={(e) => setTodayTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addToday()}
              placeholder="What are you committing to?"
            />
            <Button onClick={addToday}><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
          <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
            {grouped.length === 0 && <div className="text-sm text-muted-foreground">No open tasks for today.</div>}
            {grouped.map(([clientKey, group]) => {
              const isCollapsed = collapsed[clientKey];
              const total = Object.values(group.byMember).reduce((a, arr) => a + arr.length, 0);
              return (
                <div key={clientKey} className="border rounded-lg">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
                    onClick={() => setCollapsed(p => ({ ...p, [clientKey]: !isCollapsed }))}
                  >
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    <span className="text-sm font-semibold flex-1">{group.clientName}</span>
                    <span className="text-xs text-muted-foreground">{total} task{total === 1 ? '' : 's'}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="px-3 pb-3 space-y-3">
                      {Object.entries(group.byMember).map(([mid, tasks]) => (
                        <div key={mid}>
                          <div className="text-xs font-medium text-muted-foreground mb-1">
                            {mid === '__unassigned__' ? 'Unassigned' : (members[mid] || 'Unknown')}
                            <span className="ml-1">· {tasks.length}</span>
                          </div>
                          <div className="space-y-1">
                            {tasks.map((t) => {
                              const done = t.status === 'completed' || t.status === 'done';
                              return (
                                <div key={t.id + mid} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/40">
                                  <Checkbox checked={done} onCheckedChange={(v) => toggleTodayDone(t, !!v)} />
                                  <span className={`flex-1 ${done ? 'line-through text-muted-foreground' : ''}`}>{t.title}</span>
                                  {isOverdue(t) && !done && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">
                                      <AlertTriangle className="w-3 h-3" />overdue
                                    </span>
                                  )}
                                  {t.due_date && !isOverdue(t) && (
                                    <span className="text-[10px] text-muted-foreground">{t.due_date}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}