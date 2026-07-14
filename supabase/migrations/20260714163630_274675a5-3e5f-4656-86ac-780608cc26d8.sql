CREATE OR REPLACE FUNCTION public.set_task_assignees(_task_id uuid, _member_ids uuid[], _pod_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Keep legacy single-assignee column pointing at the first member id (uuid) or NULL
  UPDATE public.tasks
     SET assigned_to = (COALESCE(_member_ids, ARRAY[]::uuid[]))[1]
   WHERE id = _task_id;
END;
$function$;