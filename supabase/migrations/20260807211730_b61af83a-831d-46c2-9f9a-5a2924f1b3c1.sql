CREATE TABLE public.agent_task_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agency_agents(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed',
  model text,
  prompt text,
  output_md text,
  connectors_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_task_runs TO authenticated;
GRANT ALL ON public.agent_task_runs TO service_role;

ALTER TABLE public.agent_task_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read agent task runs" ON public.agent_task_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can manage agent task runs" ON public.agent_task_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_agent_task_runs_agent_created ON public.agent_task_runs (agent_id, created_at DESC);