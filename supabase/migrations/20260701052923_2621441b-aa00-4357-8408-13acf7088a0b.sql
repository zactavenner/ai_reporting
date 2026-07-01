CREATE TABLE IF NOT EXISTS public.agent_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  cron text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Los_Angeles',
  task_prompt text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_schedules TO authenticated;
GRANT ALL ON public.agent_schedules TO service_role;

ALTER TABLE public.agent_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read agent_schedules"
  ON public.agent_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write agent_schedules"
  ON public.agent_schedules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update agent_schedules"
  ON public.agent_schedules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete agent_schedules"
  ON public.agent_schedules FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_agent_schedules_updated_at
  BEFORE UPDATE ON public.agent_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_agent_schedules_due
  ON public.agent_schedules(next_run_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_agent_schedules_agent ON public.agent_schedules(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_schedules_client ON public.agent_schedules(client_id);

-- Wave 3: extend hermes_tasks for two-way Jarvis routing
ALTER TABLE public.hermes_tasks
  ADD COLUMN IF NOT EXISTS requested_by text,
  ADD COLUMN IF NOT EXISTS reply_to text,
  ADD COLUMN IF NOT EXISTS jarvis_conversation_id uuid;