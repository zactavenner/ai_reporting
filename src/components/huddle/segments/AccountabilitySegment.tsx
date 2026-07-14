import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Flame, Plus } from 'lucide-react';
import { yesterdayISO } from '@/hooks/useHuddle';

interface TaskRow {
  id: string;
  title: string;
  status: string;
  assigned_to: string | null;
  assignee_name?: string | null;
  due_date: string | null;
  completed_at: string | null;
  source: string | null;
  huddle_id: string | null;
}

export function AccountabilitySegment({ huddleId }: { huddleId: string }) {
  const { currentMember } = useTeamMember();
  const [yesterdayTasks, setYesterdayTasks] = useState<TaskRow[]>([]);
  const [notDoneReason, setNotDoneReason] = useState<Record<string, string>>({});
  const [todayTitle, setTodayTitle] = useState('');
  const [todayTasks, setTodayTasks] = useState<TaskRow[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [scoreboard, setScoreboard] = useState<{ name: string; pct: number; total: number; done: number }[]>([]);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const load = async () => {
      const y = yesterdayISO();
      const { data: yh } = await supabase.from('huddles').select('id').eq('date', y).maybeSingle();
      const yHid = yh?.id;
      const { data: ym } = await supabase.from('agency_members').select('id,name');
      const mMap: Record<string, string> = {};
      (ym || []).forEach((m: any) => { mMap[m.id] = m.name; });
      setMembers(mMap);

      let yTasks: TaskRow[] = [];
      if (yHid) {
        const { data } = await supabase.from('tasks').select('*').eq('huddle_id', yHid);
        yTasks = (data as any) || [];
      }
      // Overdue huddle tasks (source huddle, due <= yesterday, not done) — pin at top
      const { data: overdue } = await supabase
        .from('tasks')
        .select('*')
        .eq('source', 'huddle')
        .lte('due_date', y)
        .neq('status', 'completed')
        .neq('status', 'done');
      const merged = [...(overdue as any || []), ...yTasks.filter(t => !(overdue as any || []).some((o: any) => o.id === t.id))];
      setYesterdayTasks(merged);

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

      const { data: today } = await supabase.from('tasks').select('*').eq('huddle_id', huddleId);
      setTodayTasks((today as any) || []);
    };
    load();
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
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold mb-2">Today's Top 3</div>
          <div className="flex gap-2 mb-2">
            <Input
              value={todayTitle}
              onChange={(e) => setTodayTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addToday()}
              placeholder="What are you committing to?"
            />
            <Button onClick={addToday}><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {todayTasks.map((t) => (
              <Card key={t.id} className="p-3 text-sm">
                <div>{t.title}</div>
                <div className="text-xs text-muted-foreground">{members[t.assigned_to || ''] || 'Unassigned'}</div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}