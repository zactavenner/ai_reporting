import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CheckCircle2, AlertOctagon, Clock, CalendarDays, Sparkles, Send, Loader2 } from 'lucide-react';
import { useMemberTasks, useTodayReport, useSubmitDailyReport } from '@/hooks/useDailyReports';
import { useUpdateTask, useAgencyMembers } from '@/hooks/useTasks';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Bucket = 'overdue' | 'today' | 'upcoming';

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

  const [wins, setWins] = useState(existing?.wins_shared || '');
  const [touchpoints, setTouchpoints] = useState<number | ''>(existing?.touchpoint_count ?? '');
  const [touchNotes, setTouchNotes] = useState(existing?.touchpoint_notes || '');
  const [selfRating, setSelfRating] = useState<number>(existing?.self_assessment ?? 7);
  const [shareWithJoe, setShareWithJoe] = useState('');
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
    await submit.mutateAsync({
      report: {
        member_id: memberId,
        report_date: new Date().toISOString().slice(0, 10),
        report_type: 'eod',
        top_priorities: [],
        tasks_snapshot: tasksSnapshot,
        touchpoint_count: typeof touchpoints === 'number' ? touchpoints : null,
        touchpoint_notes: touchNotes || null,
        client_experience_done: null,
        wins_shared: wins || null,
        self_assessment: selfRating,
      },
      member_name: member?.name || 'Team Member',
    });

    // Fire off to Hermes → WhatsApp Joe
    try {
      const { data, error } = await supabase.functions.invoke('eod-to-hermes', {
        body: {
          member_id: memberId,
          member_name: member?.name || 'Team Member',
          wins,
          self_rating: selfRating,
          touchpoints,
          touchpoint_notes: touchNotes,
          message_for_joe: shareWithJoe,
          completed_today: completedToday.map((t: any) => ({ title: t.title, client_id: t.client_id })),
          blocked: (tasks as any[]).filter((t) => t.status === 'blocked').map((t: any) => ({ title: t.title, client_id: t.client_id, description: t.description })),
          overdue: buckets.overdue.map((t: any) => ({ title: t.title, client_id: t.client_id })),
        },
      });
      if (error) throw error;
      if (data?.delivered) toast.success('Sent to Joe on WhatsApp via Hermes');
      else toast.message('Report saved. Hermes delivery skipped (not configured).');
    } catch (e: any) {
      toast.message('Report saved. Hermes delivery failed: ' + e.message);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const TaskRow = ({ t, tone }: { t: any; tone: Bucket }) => (
    <div className="flex items-center justify-between gap-2 py-2 border-b last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {t.status === 'blocked' && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">BLOCKED</Badge>}
          <span className="text-sm font-medium truncate">{t.title}</span>
        </div>
        {t.due_date && (
          <p className="text-xs text-muted-foreground mt-0.5">Due {new Date(t.due_date).toLocaleDateString()}</p>
        )}
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
  );

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
            <Label htmlFor="notes">Touchpoint notes (optional)</Label>
            <Textarea id="notes" value={touchNotes} onChange={(e) => setTouchNotes(e.target.value)} placeholder="Quick context for any client conversation" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="joe" className="flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 text-primary" /> Message for Joe (WhatsApp)
            </Label>
            <Textarea id="joe" value={shareWithJoe} onChange={(e) => setShareWithJoe(e.target.value)} placeholder="Anything Joe should know? Sent directly via Hermes." rows={3} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSubmit} disabled={submit.isPending} className="w-full h-12 text-base font-semibold">
        {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
        Submit EOD & Ping Joe
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