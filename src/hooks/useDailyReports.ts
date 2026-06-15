import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface TaskSnapshot {
  task_id: string;
  title: string;
  client_id: string | null;
  client_name?: string;
  status: 'completed' | 'in_progress' | 'blocked';
  blocker_reason?: string;
  blocker_next_step?: string;
}

export interface DailyReport {
  id: string;
  member_id: string;
  report_date: string;
  report_type: 'sod' | 'eod';
  top_priorities: string[];
  tasks_snapshot: TaskSnapshot[];
  touchpoint_count: number | null;
  touchpoint_notes: string | null;
  client_experience_done: boolean | null;
  wins_shared: string | null;
  self_assessment: number | null;
  created_at: string;
}

export function useMemberTasks(memberId?: string) {
  return useQuery({
    queryKey: ['member-daily-tasks', memberId],
    queryFn: async () => {
      if (!memberId) return [];
      const { data: assignments, error: assignErr } = await (supabase.from('task_assignees') as any)
        .select('task_id')
        .eq('member_id', memberId);
      if (assignErr) throw assignErr;
      if (!assignments || assignments.length === 0) return [];
      const taskIds = assignments.map((a: any) => a.task_id);
      const { data: tasks, error: taskErr } = await (supabase.from('tasks') as any)
        .select('*')
        .in('id', taskIds)
        .order('due_date', { ascending: true, nullsFirst: false });
      if (taskErr) throw taskErr;
      return (tasks || []) as any[];
    },
    enabled: !!memberId,
  });
}

export function useTodayReport(memberId?: string, reportType?: 'sod' | 'eod') {
  const today = new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: ['daily-report-today', memberId, reportType, today],
    queryFn: async () => {
      const { data, error } = await (supabase.from('daily_reports') as any)
        .select('*')
        .eq('member_id', memberId!)
        .eq('report_date', today)
        .eq('report_type', reportType!)
        .maybeSingle();
      if (error) throw error;
      return data as DailyReport | null;
    },
    enabled: !!memberId && !!reportType,
  });
}

export function useReportHistory(memberId?: string) {
  return useQuery({
    queryKey: ['daily-report-history', memberId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('daily_reports') as any)
        .select('*')
        .eq('member_id', memberId!)
        .order('report_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []) as DailyReport[];
    },
    enabled: !!memberId,
  });
}

export function useSubmitDailyReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ report, member_name }: { report: Omit<DailyReport, 'id' | 'created_at'>; member_name: string }) => {
      const { data: existing } = await (supabase.from('daily_reports') as any)
        .select('id')
        .eq('member_id', report.member_id)
        .eq('report_date', report.report_date)
        .eq('report_type', report.report_type)
        .maybeSingle();

      let savedReport;
      if (existing) {
        const { data, error } = await (supabase.from('daily_reports') as any)
          .update(report)
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        savedReport = data;
      } else {
        const { data, error } = await (supabase.from('daily_reports') as any)
          .insert(report)
          .select()
          .single();
        if (error) throw error;
        savedReport = data;
      }

      supabase.functions.invoke('slack-daily-report', {
        body: { report, member_name },
      }).then(({ error: slackErr }) => {
        if (slackErr) console.warn('Slack daily report notification failed:', slackErr.message);
      });

      return savedReport;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-report-today'] });
      queryClient.invalidateQueries({ queryKey: ['daily-report-history'] });
      toast.success('Report submitted successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to submit report: ' + error.message);
    },
  });
}
