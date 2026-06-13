import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CheckCircle2, AlertOctagon, Clock, CalendarDays, Sparkles, Send, Loader2, ChevronDown, ChevronRight, MessageSquare, Video, Film, Users } from 'lucide-react';
import { useMemberTasks, useTodayReport, useSubmitDailyReport } from '@/hooks/useDailyReports';
import { useUpdateTask, useAgencyMembers } from '@/hooks/useTasks';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Bucket = 'overdue' | 'today' | 'upcoming';
type TouchKey = 'message' | 'meeting' | 'loom';

function bucketize(tasks: any[]): Record<Bucket, any[]> {
  const today = new Date(); today.setHours(0,0,0,0);
  const in3 = new Date(today); in3.setDate(today.getDate() + 3);
  const out: Record<Bucket, any[]> = { overdue: [], today: [], upcoming: [] };
  for (const t of tasks) {
    if (!t.due_date) { out.upcoming.push(t); continue; }
    const d = new Date(t.due_date); d.setHours(0,0,0,0);
    if (d < today) out.overdue.push(t);
    else if (d.getTime() === today.getTime()) out.today.push(t);
    else if (d <= in3) out.upcoming.push(t);
    else out.upcoming.push(t);
  }
  return out;
}

export function EODView({ memberId }: { memberId: string }) {
  const { data: tasks = [], isLoading } = useMemberTasks(memberId);
  const { data: existing } = useTodayReport(memberId, 'eod');
  const { data: members = [] } = useAgencyMembers();
  const submit = useSubmitDailyReport();
  const updateTask = useUpdateTask();

  const member = members.find((m: any) => m.id === memberId);
  const buckets = useMemo(() => bucketize(tasks as any[]), [tasks]);

  // Pull related data for the tasks shown: client names, subtasks, assignees
  const taskIds = useMemo(() => (tasks as any[]).map((t) => t.id), [tasks]);
  const clientIds = useMemo(() => {
    const s = new Set<string>();
    (tasks as any[]).forEach((t) => t.client_id && s.add(t.client_id));
    return Array.from(s);
  }, [tasks]);

  const { data: taskClients = [] } = useQuery({
    queryKey: ['eod-task-clients', clientIds.join(',')],
    queryFn: async () => {
      if (clientIds.length === 0) return [] as any[];
      const { data } = await supabase.from('clients').select('id, name').in('id', clientIds);
      return data || [];
    },
    enabled: clientIds.length > 0,
  });
  const clientNameById = useMemo(() => Object.fromEntries(taskClients.map((c: any) => [c.id, c.name])), [taskClients]);

  const { data: subtasks = [] } = useQuery({
    queryKey: ['eod-subtasks', taskIds.join(',')],
    queryFn: async () => {
      if (taskIds.length === 0) return [] as any[];
      const { data } = await (supabase as any).from('tasks').select('id, title, status, parent_task_id').in('parent_task_id', taskIds);
      return data || [];
    },
    enabled: taskIds.length > 0,
  });
  const subtasksByParent = useMemo(() => {
    const m: Record<string, any[]> = {};
    (subtasks as any[]).forEach((s) => { (m[s.parent_task_id] ||= []).push(s); });
    return m;
  }, [subtasks]);

  const { data: assigneeRows = [] } = useQuery({
    queryKey: ['eod-task-assignees', taskIds.join(',')],
    queryFn: async () => {
      if (taskIds.length === 0) return [] as any[];
      const { data } = await (supabase as any).from('task_assignees').select('task_id, member:agency_members(id, name)').in('task_id', taskIds);
      return data || [];
    },
    enabled: taskIds.length > 0,
  });
  const assigneesByTask = useMemo(() => {
    const m: Record<string, { id: string; name: string }[]> = {};
    (assigneeRows as any[]).forEach((r) => {
      if (!r.member) return;
      (m[r.task_id] ||= []).push(r.member);
    });
    return m;
  }, [assigneeRows]);

  // AM detection + their clients
  const { data: amClients = [] } = useQuery({
    queryKey: ['eod-am-clients', member?.name],
    queryFn: async () => {
      if (!member?.name) return [] as any[];
      const { data: assigns } = await (supabase as any)
        .from('client_assignments')
        .select('client_id')
        .eq('account_manager', member.name);
      const ids = (assigns || []).map((a: any) => a.client_id);
      if (ids.length === 0) return [];
      const { data: cls } = await supabase.from('clients').select('id, name').in('id', ids).order('name');
      return cls || [];
    },
    enabled: !!member?.name,
  });
  const isAM = amClients.length > 0;

  const [touchpointsByClient, setTouchpointsByClient] = useState<Record<string, Record<TouchKey, boolean>>>({});
  const [openSubtasks, setOpenSubtasks] = useState<Record<string, boolean>>({});

  const toggleTouch = (clientId: string, key: TouchKey) => {
    setTouchpointsByClient((prev) => ({
      ...prev,
      [clientId]: { ...(prev[clientId] || { message: false, meeting: false, loom: false }), [key]: !prev[clientId]?.[key] },
    }));
  };

  const [wins, setWins] = useState(existing?.wins_shared || '');
  const [touchpoints, setTouchpoints] = useState<number | ''>(existing?.touchpoint_count ?? '');
  const [teamFeedback, setTeamFeedback] = useState(existing?.touchpoint_notes || '');
  const [selfRating, setSelfRating] = useState<number>(existing?.self_assessment ?? 7);
  const [blockerOpen, setBlockerOpen] = useState<{ taskId: string; title: string } | null>(null);
  const [blockerReason, setBlockerReason] = useState('');

  const completedToday = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return (tasks as any[]).filter((t) => t.status === 'completed' && t.completed_at && new Date(t.completed_at) >= today);
  }, [tasks]);

  const handleMarkBlocked = async () => {
    if (!blockerOpen) return;
    if (!blockerReason.trim()) { toast.error('Add a quick reason'); return; }
    await updateTask.mutateAsync({
      id: blockerOpen.taskId,
      status: 'blocked' as any,
      description: `🚫 BLOCKED (${new Date().toLocaleDateString()}): ${blockerReason.trim()}`,
    } as any);
    toast.success('Marked blocked');
    setBlockerOpen(null); setBlockerReason('');
  };

  const handleMarkDone = async (t: any) => {
    await updateTask.mutateAsync({ id: t.id, status: 'completed' as any, completed_at: new Date().toISOString() } as any);
  };

  const handleSubmit = async () => {
    const tasksSnapshot = [
      ...buckets.overdue.map((t) => ({ task_id: t.id, title: t.title, client_id: t.client_id, status: 'in_progress' as const })),
      ...buckets.today.map((t) => ({ task_id: t.id, title: t.title, client_id: t.client_id, status: t.status === 'blocked' ? 'blocked' as const : 'in_progress' as const })),
    ];
    const clientTouchpoints = amClients.map((c: any) => {
      const t = touchpointsByClient[c.id] || { message: false, meeting: false, loom: false };
      const channels = Object.entries(t).filter(([, v]) => v).map(([k]) => k);
      return { client_id: c.id, client_name: c.name, channels: channels.length ? channels : ['none'] };
    });
    await submit.mutateAsync({
      report: {
        member_id: memberId,
        report_date: new Date().toISOString().slice(0, 10),
        report_type: 'eod',
        top_priorities: [],
        tasks_snapshot: tasksSnapshot,
        touchpoint_count: typeof touchpoints === 'number' ? touchpoints : null,
        touchpoint_notes: teamFeedback || null,
        client_experience_done: null,
        wins_shared: wins || null,
        self_assessment: selfRating,
      },
      member_name: member?.name || 'Team Member',
    });

    // Fire off to Hermes → SMS Zac (GHL agency)
    try {
      const { data, error } = await supabase.functions.invoke('eod-to-hermes', {
        body: {
          member_id: memberId,
          member_name: member?.name || 'Team Member',
          wins,
          self_rating: selfRating,
          touchpoints,
          team_feedback: teamFeedback,
          client_touchpoints: clientTouchpoints,
          completed_today: completedToday.map((t: any) => ({ title: t.title, client_id: t.client_id })),
          blocked: (tasks as any[]).filter((t) => t.status === 'blocked').map((t: any) => ({ title: t.title, client_id: t.client_id, description: t.description })),
          overdue: buckets.overdue.map((t: any) => ({ title: t.title, client_id: t.client_id })),
        },
      });
      if (error) throw error;
      if (data?.delivered) toast.success('Sent to Zac via SMS (Hermes/GHL)');
      else toast.message('Report saved. Hermes delivery skipped (not configured).');
    } catch (e: any) {
      toast.message('Report saved. Hermes delivery failed: ' + e.message);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const TaskRow = ({ t }: { t: any; tone: Bucket }) => {
    const subs = subtasksByParent[t.id] || [];
    const assignees = assigneesByTask[t.id] || [];
    const clientName = t.client_id ? clientNameById[t.client_id] : null;
    const isOpen = !!openSubtasks[t.id];
    return (
      <div className="py-2 border-b last:border-b-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {clientName && <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">{clientName}</Badge>}
              {t.status === 'blocked' && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">BLOCKED</Badge>}
              <span className="text-sm font-medium truncate">{t.title}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              {t.due_date && <span>Due {new Date(t.due_date).toLocaleDateString()}</span>}
              {assignees.length > 0 && (
                <span className="flex items-center gap-1"><Users className="h-3 w-3" />{assignees.map((a) => a.name).join(', ')}</span>
              )}
              {subs.length > 0 && (
                <button onClick={() => setOpenSubtasks((p) => ({ ...p, [t.id]: !isOpen }))} className="flex items-center gap-0.5 hover:text-foreground">
                  {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {subs.length} subtask{subs.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleMarkDone(t)}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Done
            </Button>
            {t.status !== 'blocked' && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => setBlockerOpen({ taskId: t.id, title: t.title })}>
                <AlertOctagon className="h-3.5 w-3.5 mr-1" /> Stuck
              </Button>
            )}
          </div>
        </div>
        {isOpen && subs.length > 0 && (
          <ul className="mt-2 ml-2 pl-3 border-l space-y-1">
            {subs.map((s) => (
              <li key={s.id} className="text-xs flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", s.status === 'completed' ? 'bg-emerald-500' : s.status === 'blocked' ? 'bg-destructive' : 'bg-muted-foreground/40')} />
                <span className={cn(s.status === 'completed' && 'line-through text-muted-foreground')}>{s.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const Section = ({ title, icon: Icon, items, tone, empty }: any) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className={cn("h-4 w-4", tone === 'overdue' ? 'text-destructive' : tone === 'today' ? 'text-primary' : 'text-muted-foreground')} />
          {title}
          <Badge variant="secondary" className="ml-auto">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">{empty}</p>
        ) : (
          <div>{items.map((t: any) => <TaskRow key={t.id} t={t} tone={tone} />)}</div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Quick win banner */}
      <Card className="bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
        <CardContent className="py-4 flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold">Wrap up the day in 2 minutes.</p>
            <p className="text-xs text-muted-foreground">{completedToday.length} done today • {buckets.overdue.length} overdue • {buckets.today.length} still due today</p>
          </div>
        </CardContent>
      </Card>

      {/* AM client touchpoints */}
      {isAM && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Client touchpoints today
              <Badge variant="secondary" className="ml-auto">{amClients.length} clients</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y">
              {amClients.map((c: any) => {
                const t = touchpointsByClient[c.id] || { message: false, meeting: false, loom: false };
                const any = t.message || t.meeting || t.loom;
                const Btn = ({ k, icon: Icon, label }: { k: TouchKey; icon: any; label: string }) => (
                  <button
                    type="button"
                    onClick={() => toggleTouch(c.id, k)}
                    className={cn(
                      "inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs transition",
                      t[k] ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted text-muted-foreground'
                    )}
                  >
                    <Icon className="h-3 w-3" /> {label}
                  </button>
                );
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      {!any && <p className="text-[11px] text-muted-foreground">None</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Btn k="message" icon={MessageSquare} label="Message" />
                      <Btn k="meeting" icon={Video} label="Meeting" />
                      <Btn k="loom" icon={Film} label="Loom" />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Task triage */}
      <Section title="Overdue" icon={AlertOctagon} items={buckets.overdue} tone="overdue" empty="Nothing overdue. 🎉" />
      <Section title="Due Today" icon={Clock} items={buckets.today} tone="today" empty="Nothing due today." />
      <Section title="Upcoming (next 3 days)" icon={CalendarDays} items={buckets.upcoming.slice(0, 8)} tone="upcoming" empty="Nothing on deck." />

      {/* The 4 questions */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Today in your words</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wins">Biggest win today</Label>
            <Textarea id="wins" value={wins} onChange={(e) => setWins(e.target.value)} placeholder="One sentence is fine — what moved the needle?" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tp">Client touchpoints</Label>
              <Input id="tp" type="number" min={0} value={touchpoints} onChange={(e) => setTouchpoints(e.target.value === '' ? '' : Number(e.target.value))} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>How was the day? <span className="text-muted-foreground font-normal">({selfRating}/10)</span></Label>
              <Slider value={[selfRating]} onValueChange={(v) => setSelfRating(v[0])} min={1} max={10} step={1} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Any feedback for the team? (optional)</Label>
            <Textarea id="notes" value={teamFeedback} onChange={(e) => setTeamFeedback(e.target.value)} placeholder="Process wins, friction, things to improve…" rows={3} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSubmit} disabled={submit.isPending} className="w-full h-12 text-base font-semibold">
        {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
        Submit EOD & Text Zac
      </Button>

      {/* Blocker dialog */}
      <Dialog open={!!blockerOpen} onOpenChange={(o) => !o && setBlockerOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why is "{blockerOpen?.title}" stuck?</DialogTitle>
          </DialogHeader>
          <Textarea value={blockerReason} onChange={(e) => setBlockerReason(e.target.value)} placeholder="What's blocking it? What do you need to unstick it?" rows={4} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockerOpen(null)}>Cancel</Button>
            <Button onClick={handleMarkBlocked} disabled={updateTask.isPending}>Mark Stuck & Share</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}