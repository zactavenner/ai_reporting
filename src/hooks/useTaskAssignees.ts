import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AgencyMember } from './useTasks';

export interface TaskAssignee {
  id: string;
  task_id: string;
  member_id: string | null;
  pod_id: string | null;
  created_at: string;
  member?: AgencyMember | null;
  pod?: {
    id: string;
    name: string;
    color: string | null;
    description: string | null;
  } | null;
}

// Fetch assignees for a task
export function useTaskAssignees(taskId?: string) {
  return useQuery({
    queryKey: ['task-assignees', taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_assignees')
        .select('*, member:agency_members(*, pod:agency_pods(*)), pod:agency_pods(*)')
        .eq('task_id', taskId!);
      
      if (error) throw error;
      return data as TaskAssignee[];
    },
    enabled: !!taskId,
  });
}

// Add assignee to task
export function useAddTaskAssignee() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ taskId, memberId, podId }: { 
      taskId: string; 
      memberId?: string; 
      podId?: string; 
    }) => {
      const { data, error } = await supabase
        .from('task_assignees')
        .insert({
          task_id: taskId,
          member_id: memberId || null,
          pod_id: podId || null,
        })
        .select('*, member:agency_members(*, pod:agency_pods(*)), pod:agency_pods(*)')
        .single();
      
      if (error) throw error;
      if (memberId) {
        supabase.functions
          .invoke('notify-task-assignee', {
            body: { task_id: taskId, member_id: memberId, kind: 'assigned' },
          })
          .catch((e) => console.warn('notify-task-assignee failed', e));
      }
      return data;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-assignees', taskId] });
    },
  });
}

// Remove assignee from task
export function useRemoveTaskAssignee() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ assigneeId, taskId }: { assigneeId: string; taskId: string }) => {
      const { error } = await supabase
        .from('task_assignees')
        .delete()
        .eq('id', assigneeId);
      
      if (error) throw error;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-assignees', taskId] });
    },
  });
}

// Set all assignees for a task (replace existing)
export function useSetTaskAssignees() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      taskId, 
      memberIds = [], 
      podIds = [] 
    }: { 
      taskId: string; 
      memberIds?: string[]; 
      podIds?: string[]; 
    }) => {
      // Delete existing assignees
      await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId);
      
      // Insert new assignees
      const assignees: { task_id: string; member_id: string | null; pod_id: string | null }[] = [
        ...memberIds.map(memberId => ({ task_id: taskId, member_id: memberId, pod_id: null })),
        ...podIds.map(podId => ({ task_id: taskId, member_id: null, pod_id: podId })),
      ];
      
      if (assignees.length > 0) {
        const { error } = await supabase
          .from('task_assignees')
          .insert(assignees);
        
        if (error) throw error;
      }

      // Notify newly added members (those not already there from previous insert)
      for (const memberId of memberIds) {
        supabase.functions
          .invoke('notify-task-assignee', {
            body: { task_id: taskId, member_id: memberId, kind: 'assigned' },
          })
          .catch((e) => console.warn('notify-task-assignee failed', e));
      }

      return assignees;
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['task-assignees', taskId] });
    },
  });
}
