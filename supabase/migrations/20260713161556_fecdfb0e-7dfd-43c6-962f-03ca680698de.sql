
-- Tighten task_assignees RLS to authenticated users only (remove anonymous access)
DROP POLICY IF EXISTS "Public can view task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Public can insert task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Public can update task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Public can delete task_assignees" ON public.task_assignees;

CREATE POLICY "Authenticated can view task_assignees"
  ON public.task_assignees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert task_assignees"
  ON public.task_assignees FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update task_assignees"
  ON public.task_assignees FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete task_assignees"
  ON public.task_assignees FOR DELETE TO authenticated USING (true);

-- Update set_task_assignees to also keep legacy tasks.assigned_to in sync
CREATE OR REPLACE FUNCTION public.set_task_assignees(
  _task_id   uuid,
  _member_ids uuid[],
  _pod_ids    uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.task_assignees WHERE task_id = _task_id;

  IF _member_ids IS NOT NULL AND array_length(_member_ids, 1) > 0 THEN
    INSERT INTO public.task_assignees (task_id, member_id, pod_id)
    SELECT _task_id, m, NULL FROM unnest(_member_ids) AS m;
  END IF;

  IF _pod_ids IS NOT NULL AND array_length(_pod_ids, 1) > 0 THEN
    INSERT INTO public.task_assignees (task_id, member_id, pod_id)
    SELECT _task_id, NULL, p FROM unnest(_pod_ids) AS p;
  END IF;

  -- Keep legacy single-assignee column pointing at the first member (or NULL)
  UPDATE public.tasks
     SET assigned_to = (
       SELECT am.name FROM public.agency_members am
       WHERE am.id = (COALESCE(_member_ids, ARRAY[]::uuid[]))[1]
     )
   WHERE id = _task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_task_assignees(uuid, uuid[], uuid[]) TO authenticated;
