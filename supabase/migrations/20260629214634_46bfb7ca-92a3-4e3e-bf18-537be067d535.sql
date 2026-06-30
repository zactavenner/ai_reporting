-- Agent Workforce v3: profile fields + uploadable files

ALTER TABLE public.agency_agents
  ADD COLUMN IF NOT EXISTS memory_md text,
  ADD COLUMN IF NOT EXISTS instructions_md text,
  ADD COLUMN IF NOT EXISTS connectors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.agency_agent_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agency_agents(id) ON DELETE CASCADE,
  client_id uuid NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text,
  size_bytes bigint NOT NULL DEFAULT 0,
  lines integer,
  storage_path text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_agent_files TO authenticated;
GRANT ALL ON public.agency_agent_files TO service_role;

ALTER TABLE public.agency_agent_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_agent_files read all authenticated"
  ON public.agency_agent_files FOR SELECT TO authenticated USING (true);
CREATE POLICY "agency_agent_files write authenticated"
  ON public.agency_agent_files FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_agency_agent_files_agent ON public.agency_agent_files(agent_id);
CREATE INDEX IF NOT EXISTS idx_agency_agent_files_client ON public.agency_agent_files(client_id);

-- Seed default capabilities for the 5 master agents (overwrites only when null/empty)
UPDATE public.agency_agents SET capabilities = jsonb_build_object(
  'chat', jsonb_build_array('nvidia/nemotron-3-ultra:free','openrouter/deepseek/deepseek-v4-flash','openai/gpt-5'),
  'image', jsonb_build_array('openai/gpt-image-2','google/gemini-3.1-flash-image'),
  'video', jsonb_build_array('bytedance/seedance-2.0-fast','x-ai/grok-imagine-video','alibaba/happyhorse-1.1')
) WHERE slug = 'creative' AND (capabilities IS NULL OR capabilities = '{}'::jsonb);

UPDATE public.agency_agents SET capabilities = jsonb_build_object(
  'chat', jsonb_build_array('nvidia/nemotron-3-ultra:free','openai/gpt-5')
) WHERE slug IN ('jarvis','media_buyer','reporting','qa') AND (capabilities IS NULL OR capabilities = '{}'::jsonb);

UPDATE public.agency_agents SET connectors = jsonb_build_array('meta','ghl','stripe','google-sheets')
  WHERE connectors = '[]'::jsonb;