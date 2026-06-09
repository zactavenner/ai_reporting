
-- Per-client agent folder profile (human + machine readable)
CREATE TABLE public.client_agent_profiles (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  profile_md text DEFAULT '',
  brand_kit jsonb DEFAULT '{}'::jsonb,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_agent_profiles TO authenticated;
GRANT ALL ON public.client_agent_profiles TO service_role;
GRANT SELECT ON public.client_agent_profiles TO anon;
ALTER TABLE public.client_agent_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent profiles readable" ON public.client_agent_profiles FOR SELECT USING (true);
CREATE POLICY "agent profiles writable auth" ON public.client_agent_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_client_agent_profiles_updated
  BEFORE UPDATE ON public.client_agent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-client agents (creatives / copy / strategy / custom)
CREATE TABLE public.client_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  handle text NOT NULL,
  name text NOT NULL,
  agent_type text NOT NULL DEFAULT 'custom',
  model text DEFAULT 'google/gemini-3-flash-preview',
  system_prompt text DEFAULT '',
  knowledge_md text DEFAULT '',
  reference_files jsonb DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, handle)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_agents TO authenticated;
GRANT ALL ON public.client_agents TO service_role;
GRANT SELECT ON public.client_agents TO anon;
ALTER TABLE public.client_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client agents readable" ON public.client_agents FOR SELECT USING (true);
CREATE POLICY "client agents writable auth" ON public.client_agents FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_client_agents_client ON public.client_agents(client_id);

CREATE TRIGGER trg_client_agents_updated
  BEFORE UPDATE ON public.client_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
