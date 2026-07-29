import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CalendarCheck, CalendarRange } from 'lucide-react';
import { useAllTasks, Task } from '@/hooks/useTasks';
import { startOfWeek, endOfWeek, isWithinInterval, parseISO, isSameDay } from 'date-fns';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { supabase } from '@/integrations/supabase/client';

export function isTaskDone(t: Task) {
  return t.status === 'completed' || t.status === 'done' || !!t.completed_at;
}

function toDate(v?: string | null) {
  if (!v) return null;
  try {
    return parseISO(v.length <= 10 ? `${v}T00:00:00` : v);
  } catch {
    return null;
  }
}

export function useIsAccountManager() {
  const { currentMember } = useTeamMember();
  const role = (currentMember?.role || '').toLowerCase();
  return {
    currentMember,
    isAccountManager:
      role.includes('account') || role.includes('manager') || role === 'am' || role === 'admin',
  };
}

/**
 * Tasks due today / this week.
 * Account managers (and admins) see ALL tasks; everyone else only sees their own.
 */
export function useTasksDue() {
  const { data: allTasks = [] } = useAllTasks();
  const { currentMember, isAccountManager } = useIsAccountManager();

  const { data: myTaskIds } = useQuery({
    queryKey: ['my-task-assignee-ids', currentMember?.id],
    enabled: !!currentMember?.id && !isAccountManager,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_assignees')
        .select('task_id')
        .eq('member_id', currentMember!.id);
      if (error) throw error;
      return new Set((data || []).map((r: any) => r.task_id as string));
    },
  });

  const tasks = useMemo(() => {
    if (isAccountManager || !currentMember) return allTasks;
    return allTasks.filter(
      (t) => t.assigned_to === currentMember.id || myTaskIds?.has(t.id),
    );
  }, [allTasks, isAccountManager, currentMember, myTaskIds]);

  return useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

    const today: Task[] = [];
    const week: Task[] = [];

    for (const t of tasks) {
      const d = toDate(t.due_date);
      if (!d) continue;
      if (isSameDay(d, now)) today.push(t);
      if (isWithinInterval(d, { start: weekStart, end: weekEnd })) week.push(t);
    }

    const done = (arr: Task[]) => arr.filter(isTaskDone).length;
    return {
      today,
      week,
      todayDone: done(today),
      weekDone: done(week),
      scope: (isAccountManager ? 'all' : 'mine') as 'all' | 'mine',
    };
  }, [tasks, isAccountManager]);
}

function Stat({
  icon,
  label,
  done,
  total,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  done: number;
  total: number;
  onClick?: () => void;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 text-left rounded-xl border border-border/60 bg-card/50 p-3 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {done}/{total}
        </span>
        <span className="text-xs text-muted-foreground">{pct}% complete</span>
      </div>
      <Progress value={pct} className="h-1.5 mt-2" />
    </button>
  );
}

export function TasksDueCard({ onOpenTasks }: { onOpenTasks?: () => void }) {
  const { today, week, todayDone, weekDone, scope } = useTasksDue();

  return (
    <Card className="p-3 border-border/60 shadow-sm">
      <div className="flex gap-3">
        <Stat
          icon={<CalendarCheck className="h-3.5 w-3.5 text-primary" />}
          label={scope === 'all' ? 'Tasks due today (all)' : 'My tasks due today'}
          done={todayDone}
          total={today.length}
          onClick={onOpenTasks}
        />
        <Stat
          icon={<CalendarRange className="h-3.5 w-3.5 text-primary" />}
          label={scope === 'all' ? 'Tasks due this week (all)' : 'My tasks due this week'}
          done={weekDone}
          total={week.length}
          onClick={onOpenTasks}
        />
      </div>
    </Card>
  );
}
