import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Sparkles, RefreshCw, AlertTriangle, CheckCircle2, ListTodo, PlusCircle } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useUpdateTask, Task, useAgencyMembers } from '@/hooks/useTasks';
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

import { useTasksDue, isTaskDone } from '@/components/dashboard/TasksDueCard';
import { useClients } from '@/hooks/useClients';

function todayKey() {
  return format(new Date(), 'yyyy-MM-dd');
}

interface Props {
  onTaskClick?: (taskId: string) => void;
}

export function DailyAISummaryCard({ onTaskClick }: Props) {
  const qc = useQueryClient();
  const autoRan = useRef(false);
  const today = todayKey();

  // Persist for the entire day: always read TODAY's brief (falls back to latest).
  const { data, isLoading } = useQuery({
    queryKey: ['daily-ai-summary', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_ai_summaries')
        .select('*')
        .eq('summary_date', today)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 12 * 60 * 60 * 1000,
  });

  const regen = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('daily-ai-summary', { body: { source: 'manual' } });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Daily brief refreshed');
      qc.invalidateQueries({ queryKey: ['daily-ai-summary', today] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to refresh brief'),
  });

  // Auto-generate once per day if today's brief is missing.
  useEffect(() => {
    if (isLoading || data || autoRan.current) return;
    const flag = `daily-brief-auto-${today}`;
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, '1');
    autoRan.current = true;
    regen.mutate();
  }, [isLoading, data, today]);

  const alerts = (data?.sheet_alerts as any[]) || [];
  const stats = (data?.client_stats as any[]) || [];

  // Live tasks due today so checking off is systematic and always accurate.
  const {
    today: tasksToday,
    todayDone,
    createdToday,
    createdTodayDone,
    scope,
  } = useTasksDue();
  const updateTask = useUpdateTask();
  const { data: clients = [] } = useClients();
  const { data: members = [] } = useAgencyMembers();
  const memberById = new Map<string, any>((members as any[]).map((m: any) => [m.id, m]));

  const taskIds = Array.from(new Set([...tasksToday, ...createdToday].map((t) => t.id)));
  const { data: assigneeMap } = useQuery({
    queryKey: ['daily-brief-assignees', taskIds.join(',')],
    enabled: taskIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_assignees')
        .select('task_id, member:agency_members(id,name)')
        .in('task_id', taskIds);
      if (error) throw error;
      const map = new Map<string, string[]>();
      for (const r of (data || []) as any[]) {
        const n = r.member?.name;
        if (!n) continue;
        map.set(r.task_id, [...(map.get(r.task_id) || []), n]);
      }
      return map;
    },
  });

  const assigneesFor = (t: Task): string[] => {
    const extra = assigneeMap?.get(t.id) || [];
    const direct = t.assigned_to ? memberById.get(t.assigned_to)?.name : null;
    return Array.from(new Set([...(direct ? [direct] : []), ...extra]));
  };

  const clientNameById = new Map<string, string>(
    (clients as any[]).map((c: any) => [c.id, c.name]),
  );
  const clientNameFor = (t: Task) =>
    t.assigned_client_name || (t.client_id ? clientNameById.get(t.client_id) : null) || null;

  const toggleTask = (t: Task) => {
    const done = isTaskDone(t);
    updateTask.mutate({
      id: t.id,
      status: done ? 'todo' : 'completed',
      completed_at: done ? null : new Date().toISOString(),
    } as any);
  };

  const TaskRow = ({ t, showAssignees }: { t: Task; showAssignees?: boolean }) => {
    const done = isTaskDone(t);
    const clientName = clientNameFor(t);
    const people = showAssignees ? assigneesFor(t) : [];
    return (
      <li className="text-xs flex items-center gap-2 group py-0.5">
        <Checkbox
          checked={done}
          onCheckedChange={() => toggleTask(t)}
          className="h-4 w-4 shrink-0"
        />
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${t.priority === 'high' ? 'bg-rose-500' : t.priority === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`}
        />
        <button
          type="button"
          onClick={() => onTaskClick?.(t.id)}
          className={`truncate text-left flex-1 min-w-0 hover:underline py-1 ${done ? 'line-through text-muted-foreground' : ''}`}
          title={clientName ? `${clientName} — ${t.title}` : t.title}
        >
          {clientName && <span className="font-semibold text-foreground/90">{clientName} · </span>}
          {t.title}
        </button>
        {people.length > 0 && (
          <span className="flex -space-x-1.5 shrink-0" title={people.join(', ')}>
            {people.slice(0, 3).map((n) => (
              <Avatar key={n} className="h-5 w-5 border border-background">
                <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                  {initials(n)}
                </AvatarFallback>
              </Avatar>
            ))}
            {people.length > 3 && (
              <span className="text-[9px] text-muted-foreground pl-2">+{people.length - 3}</span>
            )}
          </span>
        )}
      </li>
    );
  };

  return (
    <Card className="p-5 border-border/60 shadow-sm bg-gradient-to-br from-primary/5 via-background to-background">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-9 w-9 rounded-xl bg-primary/10 grid place-items-center shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold leading-tight">Daily Brief</h2>
            <Badge variant="secondary" className="text-[10px]">
              {format(new Date(`${data?.summary_date || today}T00:00:00`), 'MMM d')}
            </Badge>
            {data?.delivered_slack && (
              <Badge variant="outline" className="text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Slack</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Auto-generated each morning at 4 AM PST — {scope === 'all' ? 'all team tasks' : 'your tasks'} due today + yesterday's KPI snapshot per client.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => regen.mutate()}
          disabled={regen.isPending}
          className="h-8 gap-1 text-xs shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${regen.isPending ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
        {/* Column 1 — tasks due today */}
        <div className="rounded-xl border border-border/60 p-3 bg-card/50">
          <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
            <ListTodo className="h-3.5 w-3.5 text-primary" />
            <span className="truncate">
              {scope === 'all' ? 'Tasks due today (all team)' : 'My tasks due today'}
            </span>
            <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">
              {todayDone}/{tasksToday.length}
            </Badge>
          </div>
          {tasksToday.length === 0 ? (
            <p className="text-xs text-muted-foreground">Clear for today.</p>
          ) : (
            <ul className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
              {tasksToday.map((t) => (
                <TaskRow key={t.id} t={t} showAssignees />
              ))}
            </ul>
          )}
        </div>

        {/* Column 2 — tasks added today */}
        <div className="rounded-xl border border-border/60 p-3 bg-card/50">
          <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
            <PlusCircle className="h-3.5 w-3.5 text-primary" />
            <span className="truncate">
              {scope === 'all' ? 'Tasks added today (all team)' : 'My tasks added today'}
            </span>
            <Badge variant="secondary" className="text-[10px] ml-auto shrink-0">
              {createdTodayDone}/{createdToday.length}
            </Badge>
          </div>
          {createdToday.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing added yet today.</p>
          ) : (
            <ul className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
              {createdToday.map((t) => (
                <TaskRow key={t.id} t={t} showAssignees />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr,1fr] gap-3 lg:gap-4 mt-3">
        {/* AI Summary */}
        <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-1.5 prose-h2:text-sm prose-h2:font-semibold prose-p:my-1 prose-ul:my-1.5">
          {isLoading || regen.isPending ? (
            <div className="text-sm text-muted-foreground">Generating today's brief…</div>
          ) : (
            <ReactMarkdown>{data?.ai_summary || '_No summary content yet — click Refresh._'}</ReactMarkdown>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 p-3 bg-card/50">
            <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              Alerts
              <Badge variant="secondary" className="text-[10px] ml-auto">{alerts.length}</Badge>
            </div>
            {alerts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No alerts. All sheets healthy.</p>
            ) : (
              <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                {alerts.slice(0, 8).map((a: any, i: number) => (
                  <li key={i} className="text-xs">
                    <span className="font-medium">{a.client_name}</span>{' '}
                    <span className="text-muted-foreground">— {a.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-[10px] text-muted-foreground">
            {stats.length} client{stats.length === 1 ? '' : 's'} reported sheet stats for yesterday.
          </div>
        </div>
      </div>
    </Card>
  );
}
