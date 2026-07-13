
-- task_assignees: allow public (anon+authenticated) — the app uses a custom
-- localStorage TeamMember session, not a Supabase auth session, so
-- authenticated-only policies blocked all writes and assignment silently failed.
DROP POLICY IF EXISTS "Authenticated can view task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Authenticated can insert task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Authenticated can update task_assignees" ON public.task_assignees;
DROP POLICY IF EXISTS "Authenticated can delete task_assignees" ON public.task_assignees;

CREATE POLICY "Public can view task_assignees" ON public.task_assignees FOR SELECT USING (true);
CREATE POLICY "Public can insert task_assignees" ON public.task_assignees FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update task_assignees" ON public.task_assignees FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public can delete task_assignees" ON public.task_assignees FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_assignees TO anon, authenticated;
GRANT ALL ON public.task_assignees TO service_role;
