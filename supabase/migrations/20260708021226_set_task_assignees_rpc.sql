-- Atomically replace all assignees for a task in a single transaction.
CREATE OR REPLACE FUNCTION public.set_task_assignees(
  _task_id  uuid,
  _member_ids uuid[],
  _pod_ids    uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Remove all current assignees
  DELETE FROM public.task_assignees WHERE task_id = _task_id;

  -- Insert member assignees
  IF array_length(_member_ids, 1) > 0 THEN
    INSERT INTO public.task_assignees (task_id, member_id, pod_id)
    SELECT _task_id, m, NULL
    FROM unnest(_member_ids) AS m;
  END IF;

  -- Insert pod assignees
  IF array_length(_pod_ids, 1) > 0 THEN
    INSERT INTO public.task_assignees (task_id, member_id, pod_id)
    SELECT _task_id, NULL, p
    FROM unnest(_pod_ids) AS p;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_task_assignees(uuid, uuid[], uuid[]) TO authenticated;
