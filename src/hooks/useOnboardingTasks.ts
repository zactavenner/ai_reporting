import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { podForCategory } from '@/lib/onboardingTaskTemplates';

export interface OnboardingTask {
  id: string;
  client_id: string;
  category: string;
  title: string;
  completed: boolean;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
}

export function useOnboardingTasks(clientId: string | undefined) {
  return useQuery({
    queryKey: ['onboarding-tasks', clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from('client_onboarding_tasks' as any)
        .select('*')
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true });
      if (error) {
        if (error.code === 'PGRST205' || error.message?.includes('Could not find')) {
          return [];
        }
        throw error;
      }
      return data as unknown as OnboardingTask[];
    },
    enabled: !!clientId,
  });
}

export function useToggleOnboardingTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, completed, clientId }: { id: string; completed: boolean; clientId: string }) => {
      const { error } = await supabase
        .from('client_onboarding_tasks' as any)
        .update({
          completed,
          completed_at: completed ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
      return { id, completed, clientId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-tasks', data.clientId] });
    },
  });
}

export function useSeedOnboardingTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      tasks,
      createPmTasks = false,
    }: {
      clientId: string;
      tasks: { category: string; title: string; sort_order: number }[];
      createPmTasks?: boolean;
    }) => {
      const rows = tasks.map(t => ({
        client_id: clientId,
        category: t.category,
        title: t.title,
        sort_order: t.sort_order,
        completed: false,
      }));
      const { error } = await supabase
        .from('client_onboarding_tasks' as any)
        .insert(rows);
      if (error) throw error;

      // Optionally mirror the same checklist into the PM task board
      // (To Do column, visible to client) and auto-assign each task to the
      // owning department pod.
      if (createPmTasks) {
        try {
          const { data: pods } = await supabase
            .from('agency_pods')
            .select('id, name');
          const podByName = new Map<string, string>(
            (pods ?? []).map((p: any) => [p.name, p.id])
          );

          const taskRows = tasks.map(t => ({
            client_id: clientId,
            title: t.title,
            description: `Onboarding · ${t.category}`,
            status: 'todo',
            stage: 'todo',
            priority: 'medium',
            visible_to_client: true,
          }));

          const { data: insertedTasks, error: tErr } = await supabase
            .from('tasks')
            .insert(taskRows)
            .select('id, title');
          if (tErr) throw tErr;

          // Build assignee rows by matching title back to the originating
          // template entry (titles are unique within a template).
          const titleToPod = new Map<string, string | null>();
          tasks.forEach(t => {
            const podName = podForCategory(t.category);
            titleToPod.set(t.title, podName ? podByName.get(podName) ?? null : null);
          });

          const assigneeRows = (insertedTasks ?? [])
            .map((row: any) => {
              const podId = titleToPod.get(row.title);
              if (!podId) return null;
              return { task_id: row.id, pod_id: podId, member_id: null };
            })
            .filter(Boolean) as { task_id: string; pod_id: string; member_id: null }[];

          if (assigneeRows.length) {
            await supabase.from('task_assignees').insert(assigneeRows);
          }
        } catch (err) {
          console.error('Failed to mirror onboarding tasks into PM board:', err);
        }
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-tasks', vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
    },
  });
}
