CREATE TABLE public.hermes_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.ai_studio_conversations(id) ON DELETE SET NULL,
  hermes_external_id text,
  task_type text NOT NULL,
  instructions text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  hermes_callback_url text,
  agent_id uuid REFERENCES public.client_agents(id) ON DELETE SET NULL,
  result_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  delivered_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hermes_tasks_client_status_idx ON public.hermes_tasks(client_id, status, created_at DESC);
CREATE INDEX hermes_tasks_status_type_idx ON public.hermes_tasks(status, task_type);

GRANT SELECT ON public.hermes_tasks TO authenticated;
GRANT ALL ON public.hermes_tasks TO service_role;

ALTER TABLE public.hermes_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read hermes_tasks" ON public.hermes_tasks
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER hermes_tasks_updated_at
  BEFORE UPDATE ON public.hermes_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();