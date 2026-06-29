
CREATE TABLE public.client_agent_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agency_agents(id) ON DELETE CASCADE,
  memory_md text,
  instructions_md text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, agent_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_agent_overrides TO authenticated;
GRANT ALL ON public.client_agent_overrides TO service_role;
ALTER TABLE public.client_agent_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth can read client agent overrides" ON public.client_agent_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can write client agent overrides" ON public.client_agent_overrides FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_client_agent_overrides_updated BEFORE UPDATE ON public.client_agent_overrides FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
