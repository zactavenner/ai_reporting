import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { seedOnboardingTasksIntoPM, type OnboardingTemplateItem } from '@/lib/onboardingTaskSeeder';

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

/**
 * Reads onboarding subtasks from the regular `tasks` table, scoped to the
 * client's "Onboarding" project. Parent (category) rows are skipped — the
 * checklist shows the leaf items grouped by category.
 */
export function useOnboardingTasks(clientId: string | undefined) {
  return useQuery({
    queryKey: ['onboarding-tasks', clientId],
    queryFn: async () => {
      if (!clientId) return [];
      // 1. Find the client's onboarding project.
      const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('client_id', clientId)
        .eq('type', 'onboarding')
        .maybeSingle();
      if (!project?.id) return [];
      // 2. Pull child tasks (subtasks) — these are the checklist items.
      const { data, error } = await supabase
        .from('tasks')
        .select('id, client_id, title, category, status, stage, completed_at, sort_order, created_at, parent_task_id')
        .eq('client_id', clientId)
        .eq('project_id', project.id)
        .not('parent_task_id', 'is', null)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        id: t.id,
        client_id: t.client_id,
        category: t.category ?? 'Onboarding',
        title: t.title,
        completed: t.stage === 'done' || t.status === 'completed',
        completed_at: t.completed_at,
        sort_order: t.sort_order ?? 0,
        created_at: t.created_at,
      })) as OnboardingTask[];
    },
    enabled: !!clientId,
  });
}

export function useToggleOnboardingTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, completed, clientId }: { id: string; completed: boolean; clientId: string }) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('tasks')
        .update({
          status: completed ? 'completed' : 'todo',
          stage: completed ? 'done' : 'todo',
          completed_at: completed ? now : null,
          updated_at: now,
        })
        .eq('id', id);
      if (error) throw error;
      return { id, completed, clientId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-tasks', data.clientId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', data.clientId] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
    },
  });
}

export function useSeedOnboardingTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      tasks,
    }: {
      clientId: string;
      tasks: OnboardingTemplateItem[];
      /** @deprecated tasks always live in the PM board now */
      createPmTasks?: boolean;
    }) => {
      await seedOnboardingTasksIntoPM(clientId, tasks);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-tasks', vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ['all-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['projects', vars.clientId] });
    },
  });
}
