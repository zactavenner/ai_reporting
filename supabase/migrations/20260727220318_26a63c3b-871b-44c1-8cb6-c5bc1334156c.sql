
CREATE TABLE public.client_agent_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agency_agents(id) ON DELETE CASCADE,
  entry_type text NOT NULL DEFAULT 'run' CHECK (entry_type IN ('run','reflection','lesson','note')),
  scope text NOT NULL DEFAULT 'adhoc' CHECK (scope IN ('daily','weekly','monthly','adhoc')),
  title text NOT NULL,
  body_md text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_used integer DEFAULT 0,
  cost_usd numeric(10,6) DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cajournal_client_agent_created ON public.client_agent_journal(client_id, agent_id, created_at DESC);
CREATE INDEX idx_cajournal_type ON public.client_agent_journal(entry_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_agent_journal TO authenticated;
GRANT ALL ON public.client_agent_journal TO service_role;

ALTER TABLE public.client_agent_journal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read journal" ON public.client_agent_journal
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write journal" ON public.client_agent_journal
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update journal" ON public.client_agent_journal
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete journal" ON public.client_agent_journal
  FOR DELETE TO authenticated USING (true);
