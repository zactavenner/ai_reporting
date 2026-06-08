import { supabase } from '@/integrations/supabase/client';
import { podForCategory } from '@/lib/onboardingTaskTemplates';

export interface OnboardingTemplateItem {
  category: string;
  title: string;
  sort_order: number;
  parent_title?: string | null;
}

/**
 * Seed an onboarding checklist into the regular PM `tasks` system.
 *
 * - Creates (or reuses) an "Onboarding" project for the client.
 * - For each unique category, inserts a parent task (e.g. "Compliance & Legal")
 *   and routes it to the owning agency pod.
 * - For every template item, inserts a subtask under the matching category
 *   parent (parent_task_id), preserving sort_order.
 *
 * Idempotent on the project (one "Onboarding" project per client) but will
 * always insert new tasks — callers should guard against double-seeding.
 */
export async function seedOnboardingTasksIntoPM(
  clientId: string,
  templateTasks: OnboardingTemplateItem[],
): Promise<{ projectId: string; parentCount: number; subtaskCount: number }> {
  // 1. Find or create the "Onboarding" project for the client.
  let projectId: string | null = null;
  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('client_id', clientId)
    .eq('type', 'onboarding')
    .maybeSingle();
  if (existing?.id) {
    projectId = existing.id;
  } else {
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .insert({
        client_id: clientId,
        name: 'Onboarding',
        type: 'onboarding',
        description: 'Auto-generated onboarding checklist',
      } as any)
      .select('id')
      .single();
    if (pErr) throw pErr;
    projectId = project!.id;
  }

  // 2. Build category list preserving original order.
  const categoryOrder: string[] = [];
  const itemsByCategory = new Map<string, OnboardingTemplateItem[]>();
  for (const t of templateTasks) {
    if (!itemsByCategory.has(t.category)) {
      categoryOrder.push(t.category);
      itemsByCategory.set(t.category, []);
    }
    itemsByCategory.get(t.category)!.push(t);
  }

  // 3. Lookup pods so parent tasks can be auto-routed.
  const { data: pods } = await supabase.from('agency_pods').select('id, name');
  const podByName = new Map<string, string>((pods ?? []).map((p: any) => [p.name, p.id]));

  // 4. Insert parent tasks (one per category).
  const parentRows = categoryOrder.map((category, idx) => ({
    client_id: clientId,
    project_id: projectId,
    title: category,
    description: 'Onboarding section',
    category,
    sort_order: (idx + 1) * 100,
    status: 'todo',
    stage: 'todo',
    priority: 'medium',
    visible_to_client: true,
    show_subtasks_to_client: true,
  }));
  const { data: insertedParents, error: parentErr } = await supabase
    .from('tasks')
    .insert(parentRows as any)
    .select('id, title, category');
  if (parentErr) throw parentErr;

  const parentByCategory = new Map<string, string>();
  (insertedParents ?? []).forEach((row: any) => {
    parentByCategory.set(row.category || row.title, row.id);
  });

  // Assign each parent to the owning pod.
  const parentAssignees = (insertedParents ?? [])
    .map((row: any) => {
      const podName = podForCategory(row.category || row.title);
      const podId = podName ? podByName.get(podName) : null;
      return podId ? { task_id: row.id, pod_id: podId, member_id: null } : null;
    })
    .filter(Boolean) as { task_id: string; pod_id: string; member_id: null }[];
  if (parentAssignees.length) {
    await supabase.from('task_assignees').insert(parentAssignees);
  }

  // 5. Insert subtasks under each parent.
  // First insert top-level subtasks (no parent_title) under their category parent,
  // capture their IDs, then insert nested sub-subtasks parented to those.
  const topItems = templateTasks.filter(t => !t.parent_title);
  const nestedItems = templateTasks.filter(t => !!t.parent_title);

  const topRows = topItems.map(t => ({
    client_id: clientId,
    project_id: projectId,
    parent_task_id: parentByCategory.get(t.category) ?? null,
    title: t.title,
    description: `Onboarding · ${t.category}`,
    category: t.category,
    sort_order: t.sort_order,
    status: 'todo',
    stage: 'todo',
    priority: 'medium',
    visible_to_client: true,
    show_subtasks_to_client: true,
  }));
  const { data: insertedTop, error: topErr } = await supabase
    .from('tasks')
    .insert(topRows as any)
    .select('id, title, category');
  if (topErr) throw topErr;

  // Build lookup: (category|title) -> top subtask id
  const topByKey = new Map<string, string>();
  (insertedTop ?? []).forEach((row: any) => {
    topByKey.set(`${row.category}::${row.title}`, row.id);
  });

  let nestedCount = 0;
  if (nestedItems.length) {
    const nestedRows = nestedItems
      .map(t => {
        const parentId = topByKey.get(`${t.category}::${t.parent_title}`);
        if (!parentId) return null;
        return {
          client_id: clientId,
          project_id: projectId,
          parent_task_id: parentId,
          title: t.title,
          description: `Onboarding · ${t.category} · ${t.parent_title}`,
          category: t.category,
          sort_order: t.sort_order,
          status: 'todo',
          stage: 'todo',
          priority: 'medium',
          visible_to_client: true,
        };
      })
      .filter(Boolean) as any[];
    if (nestedRows.length) {
      const { error: nestedErr } = await supabase.from('tasks').insert(nestedRows);
      if (nestedErr) throw nestedErr;
      nestedCount = nestedRows.length;
    }
  }

  return {
    projectId: projectId!,
    parentCount: parentRows.length,
    subtaskCount: topRows.length + nestedCount,
  };
}