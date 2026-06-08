-- Link tasks to projects + add category/sort_order so the onboarding
-- checklist can live inside the regular PM tasks system as parent
-- tasks (one per category) with subtasks (one per template item).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS sort_order integer;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON public.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_client_category ON public.tasks(client_id, category);