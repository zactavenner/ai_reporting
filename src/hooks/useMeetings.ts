import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { addBusinessDays } from '@/lib/utils';
import { format } from 'date-fns';
import { fetchAllRows } from '@/lib/fetchAllRows';

export interface MeetingHighlight {
  highlightText: string;
  label: string;
  timestamp?: number;
  speaker?: string;
}

export interface Meeting {
  id: string;
  client_id: string | null;
  meeting_id: string;
  title: string;
  meeting_date: string | null;
  duration_minutes: number | null;
  participants: any[];
  summary: string | null;
  transcript: string | null;
  action_items: any[];
  highlights: MeetingHighlight[];
  recording_url: string | null;
  meetgeek_url: string | null;
  created_at: string;
}

export interface PendingMeetingTask {
  id: string;
  meeting_id: string;
  client_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_at: string | null;
  approved_by: string | null;
  task_id: string | null;
  created_at: string;
  meeting?: Meeting;
}

export function useMeetings(clientId?: string) {
  return useQuery({
    queryKey: ['meetings', clientId],
    queryFn: async () => {
      const data = await fetchAllRows((sb) => {
        let query = sb
          .from('agency_meetings')
          .select('*')
          .order('meeting_date', { ascending: false });

        if (clientId) {
          query = query.eq('client_id', clientId);
        }

        return query;
      });

      return data.map(meeting => ({
        ...meeting,
        highlights: (meeting.highlights as unknown as MeetingHighlight[]) || [],
        action_items: (meeting.action_items as unknown as any[]) || [],
      })) as Meeting[];
    },
  });
}

export function usePendingMeetingTasks(clientId?: string) {
  return useQuery({
    queryKey: ['pending-meeting-tasks', clientId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('pending_meeting_tasks')
        .select(`
          *,
          meeting:agency_meetings(*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (clientId) q = q.eq('client_id', clientId);
      const { data, error } = await q;

      if (error) throw error;
      
      // Map meeting data with proper types
      return (data || []).map(task => ({
        ...task,
        meeting: task.meeting ? {
          ...task.meeting,
          highlights: (task.meeting.highlights as unknown as MeetingHighlight[]) || [],
          action_items: (task.meeting.action_items as unknown as any[]) || [],
        } : undefined,
      })) as PendingMeetingTask[];
    },
  });
}

export function useAssignMeetingToClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ meetingId, clientId }: { meetingId: string; clientId: string | null }) => {
      const { error } = await supabase
        .from('agency_meetings')
        .update({ client_id: clientId })
        .eq('id', meetingId);

      if (error) throw error;

      // Also update any pending tasks for this meeting
      if (clientId) {
        await supabase
          .from('pending_meeting_tasks')
          .update({ client_id: clientId })
          .eq('meeting_id', meetingId)
          .eq('status', 'pending');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-tasks'] });
      toast.success('Meeting assigned to client');
    },
    onError: (error) => {
      toast.error('Failed to assign meeting');
      console.error(error);
    },
  });
}

export function useApprovePendingTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pendingTaskId,
      clientId,
      title,
      description,
      priority,
      meetingId,
    }: {
      pendingTaskId: string;
      clientId: string | null;
      title: string;
      description: string;
      priority: string;
      meetingId?: string | null;
    }) => {
      // Create the real task with meeting_id reference and due date
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);
      
      const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
          client_id: clientId,
          title,
          description,
          priority,
          status: 'todo',
          stage: 'TODO',
          created_by: 'MeetGeek',
          meeting_id: meetingId || null,
          due_date: format(dueDate, 'yyyy-MM-dd'),
        })
        .select()
        .single();

      if (taskError) throw taskError;

      // Update pending task status
      const { error: updateError } = await supabase
        .from('pending_meeting_tasks')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: 'User',
          task_id: newTask.id,
        })
        .eq('id', pendingTaskId);

      if (updateError) throw updateError;

      // Fire-and-forget auto-assign so meeting-sourced tasks aren't orphaned.
      supabase.functions
        .invoke('ai-auto-assign-task', { body: { taskId: newTask.id } })
        .catch((e) => console.warn('ai-auto-assign-task (meeting approval) failed', e));

      return newTask;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
      toast.success('Task approved and created');
    },
    onError: (error) => {
      toast.error('Failed to approve task');
      console.error(error);
    },
  });
}

export function useRejectPendingTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pendingTaskId: string) => {
      const { error } = await supabase
        .from('pending_meeting_tasks')
        .update({ status: 'rejected' })
        .eq('id', pendingTaskId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-tasks'] });
      toast.success('Task rejected');
    },
    onError: (error) => {
      toast.error('Failed to reject task');
      console.error(error);
    },
  });
}

export function useUpdatePendingTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Pick<PendingMeetingTask, 'title' | 'description' | 'priority' | 'client_id'>>;
    }) => {
      const { error } = await supabase
        .from('pending_meeting_tasks')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-tasks'] });
    },
  });
}

export function useSyncMeetings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('meetgeek-webhook', {
        body: { action: 'sync' },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-tasks'] });
      if (data?.synced !== undefined) {
        toast.success(`Synced ${data.synced} new meetings`);
      } else {
        toast.success('Meetings synced');
      }
    },
    onError: (error) => {
      toast.error('Failed to sync meetings');
      console.error(error);
    },
  });
}

export function useDeleteMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (meetingId: string) => {
      // First delete associated pending tasks
      await supabase
        .from('pending_meeting_tasks')
        .delete()
        .eq('meeting_id', meetingId);

      // Then delete the meeting
      const { error } = await supabase
        .from('agency_meetings')
        .delete()
        .eq('id', meetingId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-tasks'] });
      toast.success('Meeting deleted');
    },
    onError: (error) => {
      toast.error('Failed to delete meeting');
      console.error(error);
    },
  });
}

export function useCreatePendingTaskFromActionItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      clientId,
      title,
      description,
    }: {
      meetingId: string;
      clientId: string | null;
      title: string;
      description: string;
    }) => {
      const { data, error } = await supabase
        .from('pending_meeting_tasks')
        .insert({
          meeting_id: meetingId,
          client_id: clientId,
          title,
          description,
          priority: 'medium',
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-meeting-tasks'] });
      toast.success('Task added for review');
    },
    onError: (error) => {
      toast.error('Failed to create pending task');
      console.error(error);
    },
  });
}
