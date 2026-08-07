CREATE TABLE public.agent_connectors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agency_agents(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('supabase_table','supabase_composite','hermes','webhook','storage')),
  label text NOT NULL,
  target text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_limit integer NOT NULL DEFAULT 50,
  refresh_interval_minutes integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  last_tested_at timestamp with time zone,
  last_status text,
  last_error text,
  last_row_count integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_connectors_agent ON public.agent_connectors(agent_id, client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_connectors TO authenticated;
GRANT ALL ON public.agent_connectors TO service_role;

ALTER TABLE public.agent_connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view agent connectors"
  ON public.agent_connectors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can create agent connectors"
  ON public.agent_connectors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update agent connectors"
  ON public.agent_connectors FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete agent connectors"
  ON public.agent_connectors FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_agent_connectors_updated_at
  BEFORE UPDATE ON public.agent_connectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();