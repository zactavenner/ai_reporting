import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CheckCircle2, AlertOctagon, Sunrise, Loader2, Quote, Send } from 'lucide-react';
import { useMemberTasks, useSubmitDailyReport } from '@/hooks/useDailyReports';
import { useUpdateTask, useAgencyMembers } from '@/hooks/useTasks';
import { TaskDetailPanel } from '@/components/tasks/TaskDetailPanel';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const QUOTES = [
  { q: "Discipline equals freedom.", a: "Jocko Willink" },
  { q: "The way to get started is to quit talking and begin doing.", a: "Walt Disney" },
  { q: "Done is better than perfect.", a: "Sheryl Sandberg" },
  { q: "What gets measured gets managed.", a: "Peter Drucker" },
  { q: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", a: "Aristotle" },
  { q: "Hard choices, easy life. Easy choices, hard life.", a: "Jerzy Gregorek" },
  { q: "Focus is saying no to a thousand good ideas.", a: "Steve Jobs" },
  { q: "Amateurs sit and wait for inspiration. The rest of us just get up and go to work.", a: "Stephen King" },
  { q: "Small daily improvements are the key to staggering long-term results.", a: "James Clear" },
  { q: "You don't rise to the level of your goals, you fall to the level of your systems.", a: "James Clear" },
  { q: "If it's important, do it every day.", a: "Dan John" },
  { q: "The best way to predict the future is to create it.", a: "Peter Drucker" },
  { q: "Work hard in silence, let your success make the noise.", a: "Frank Ocean" },
  { q: "Don't count the days, make the days count.", a: "Muhammad Ali" },
  { q: "Pressure is a privilege.", a: "Billie Jean King" },
];

export function SODView({ memberId }: { memberId: string }) {
  const { data: tasks = [], isLoading, refetch } = useMemberTasks(memberId);
  const { data: members = [] } = useAgencyMembers();
  const updateTask = useUpdateTask();
  const submit = useSubmitDailyReport();
  const queryClient = useQueryClient();
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const hideTask = (id: string) => {
    setHiddenIds((prev) => { const n = new Set(prev); n.add(id); return n; });
    queryClient.invalidateQueries({ queryKey: ['member-daily-tasks', memberId] });
  };
  const [topPriorities, setTopPriorities] = useState('');
  const [blockerOpen, setBlockerOpen] = useState<{ task: any } | null>(null);
  const [blockerReason, setBlockerReason] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [openTask, setOpenTask] = useState<any | null>(null);

  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);
  const member = members.find((m: any) => m.id === memberId);

  const handleSendPriorities = async () => {
    const lines = topPriorities.split('\n').map((l) => l.replace(/^\s*\d+[\.\)]\s*/, '').trim()).filter(Boolean);
    if (lines.length === 0) { toast.error('Add at least one priority'); return; }
    try {
      await submit.mutateAsync({
        report: {
          member_id: memberId,
          report_date: new Date().toISOString().slice(0, 10),
          report_type: 'sod',
          top_priorities: lines.slice(0, 3),
          tasks_snapshot: dueToday.map((t: any) => ({ task_id: t.id, title: t.title, client_id: t.client_id, status: 'in_progress' as const })),
          touchpoint_count: null,
          touchpoint_notes: null,
          client_experience_done: null,
          wins_shared: null,
          self_assessment: null,
        },
        member_name: member?.name || 'Team Member',
      });
      toast.success('Top 3 sent');
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    }
  };

  const dueToday = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    return (tasks as any[]).filter((t) => {
      if (hiddenIds.has(t.id)) return false;
      if (t.status === 'completed' || t.stage === 'done') return false;
      if (!t.due_date) return false;
      const d = new Date(t.due_date); d.setHours(0,0,0,0);
      return d.getTime() <= today.getTime();
    });
  }, [tasks, hiddenIds]);

  // Map client_id -> client name (for visibility)
  const clientIds = useMemo(() => Array.from(new Set((tasks as any[]).map((t) => t.client_id).filter(Boolean))), [tasks]);
  const { data: clientMap = {} as Record<string, string> } = useQuery({
    queryKey: ['sod-client-names', clientIds.join(',')],
    queryFn: async () => {
      if (clientIds.length === 0) return {};
      const { data } = await supabase.from('clients').select('id, name').in('id', clientIds);
      return Object.fromEntries((data || []).map((c: any) => [c.id, c.name]));
    },
    enabled: clientIds.length > 0,
  });

  const handleMarkDone = async (t: any) => {
    await updateTask.mutateAsync({ id: t.id, status: 'completed' as any, completed_at: new Date().toISOString() } as any);
    hideTask(t.id);
    toast.success('Marked done');
  };

  const handleStuck = async () => {
    if (!blockerOpen) return;
    if (!blockerReason.trim()) { toast.error('Add a quick reason'); return; }
    setReassigning(true);
    const t = blockerOpen.task;
    try {
      // 1. Find AM for the client
      let amMemberId: string | null = null;
      let amName: string | null = null;
      if (t.client_id) {
        const { data: assign } = await (supabase as any)
          .from('client_assignments')
          .select('account_manager')
          .eq('client_id', t.client_id)
          .maybeSingle();
        if (assign?.account_manager) {
          amName = assign.account_manager;
          const am = members.find((m: any) => m.name?.toLowerCase() === assign.account_manager.toLowerCase());
          if (am) amMemberId = am.id;
        }
      }

      // 2. Update task: blocked + reassign to AM (if found) + prepend blocker note
      const newDesc = `🚫 BLOCKED by ${member?.name || 'team'} (${new Date().toLocaleDateString()}): ${blockerReason.trim()}\n\n${t.description || ''}`.trim();
      await updateTask.mutateAsync({
        id: t.id,
        status: 'blocked' as any,
        description: newDesc,
        ...(amMemberId ? { assigned_to: amMemberId } : {}),
      } as any);

      // 3. Also upsert task_assignees if AM found
      if (amMemberId) {
        await (supabase as any).from('task_assignees').insert({ task_id: t.id, member_id: amMemberId }).then(() => {}, () => {});
      }

      // 4. Post a comment for trail
      await (supabase as any).from('task_comments').insert({
        task_id: t.id,
        author_name: member?.name || 'Team',
        content: `🚫 Stuck: ${blockerReason.trim()}${amName ? `\nRe-assigned to AM: ${amName}` : ''}`,
        comment_type: 'text',
      }).then(() => {}, () => {});

      // 5. Notify the AM via existing notification function
      if (amMemberId) {
        supabase.functions.invoke('send-task-notification', {
          body: { taskId: t.id, action: 'assigned', clientId: t.client_id, reason: 'stuck_escalation', blocker_reason: blockerReason.trim(), from_member: member?.name },
        }).then(() => {}, () => {});
        toast.success(`Stuck — escalated to ${amName}`);
      } else {
        toast.message('Marked stuck — no AM assigned to this client');
      }
      hideTask(t.id);
      setBlockerOpen(null);
      setBlockerReason('');
      refetch();
    } catch (e: any) {
      toast.error('Failed: ' + e.message);
    } finally {
      setReassigning(false);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Motivational quote */}
      <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20">
        <CardContent className="py-5 flex items-start gap-3">
          <Quote className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium italic leading-relaxed">"{quote.q}"</p>
            <p className="text-xs text-muted-foreground mt-1">— {quote.a}</p>
          </div>
        </CardContent>
      </Card>

      {/* Greeting */}
      <div className="flex items-center gap-2 px-1">
        <Sunrise className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold">Good morning, {member?.name?.split(' ')[0] || 'team'}.</h2>
      </div>

      {/* Top priorities */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Top 3 priorities today</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          <Textarea
            value={topPriorities}
            onChange={(e) => setTopPriorities(e.target.value)}
            placeholder={"1. \n2. \n3. "}
            rows={4}
          />
          <Button
            size="sm"
            className="w-full"
            onClick={handleSendPriorities}
            disabled={submit.isPending || !topPriorities.trim()}
          >
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Send Top 3
          </Button>
        </CardContent>
      </Card>

      {/* Due today */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Tasks Due Today
            <Badge variant="secondary" className="ml-auto">{dueToday.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {dueToday.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Nothing due today. Build the day.</p>
          ) : (
            <div>
              {dueToday.map((t: any) => (
                <div
                  key={t.id}
                  onClick={() => setOpenTask(t)}
                  className="flex items-start justify-between gap-2 py-2.5 border-b last:border-b-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {t.client_id && (clientMap as any)[t.client_id] && (
                        <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-bold text-foreground border-foreground/30 bg-foreground/5">
                          {(clientMap as any)[t.client_id]}
                        </Badge>
                      )}
                      {t.status === 'blocked' && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">BLOCKED</Badge>}
                      <span className="text-sm font-medium">{t.title}</span>
                    </div>
                    {t.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">{t.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); handleMarkDone(t); }}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Done
                    </Button>
                    {t.status !== 'blocked' && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={(e) => { e.stopPropagation(); setBlockerOpen({ task: t }); }}>
                        <AlertOctagon className="h-3.5 w-3.5 mr-1" /> Stuck
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stuck dialog */}
      <Dialog open={!!blockerOpen} onOpenChange={(o) => !o && setBlockerOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What's blocking "{blockerOpen?.task.title}"?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            We'll escalate this to the Account Manager on this client and notify them so they can unblock you.
          </p>
          <Textarea
            value={blockerReason}
            onChange={(e) => setBlockerReason(e.target.value)}
            placeholder="What do you need to move forward?"
            rows={4}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockerOpen(null)}>Cancel</Button>
            <Button onClick={handleStuck} disabled={reassigning}>
              {reassigning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Escalate to AM
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskDetailPanel
        task={openTask}
        open={!!openTask}
        onOpenChange={(o) => !o && setOpenTask(null)}
        clientName={openTask?.client_id ? (clientMap as any)[openTask.client_id] : undefined}
        clientId={openTask?.client_id || undefined}
      />
    </div>
  );
}
