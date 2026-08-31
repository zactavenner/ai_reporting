CREATE TABLE IF NOT EXISTS public.agency_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  mcp_url TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.agency_personas TO service_role;
ALTER TABLE public.agency_personas ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS agency_personas_single_default_uidx
  ON public.agency_personas (is_default) WHERE is_default;

CREATE OR REPLACE VIEW public.v_agency_personas
WITH (security_invoker = true) AS
SELECT
  id,
  slug,
  name,
  description,
  is_default,
  is_active,
  split_part(split_part(mcp_url, '://', 2), '/', 1) AS mcp_host,
  (mcp_url LIKE '%k=%') AS has_token,
  created_at,
  updated_at
FROM public.agency_personas;

INSERT INTO public.agency_personas (slug, name, description, mcp_url, is_default, is_active)
VALUES (
  'jeremy',
  'Jeremy (Utari)',
  'Jeremy''s personal AI persona served by the Utari Persona MCP.',
  'https://persona-mcp.utari.ai/mcp/?k=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ1dGFyaS1wZXJzb25hLW1jcCIsImlhdCI6MTc4ODE5NTkzNSwiZXhwIjoxNzk1OTcxOTM1LCJqdGkiOiI2Yjk0YTU2YS01ZTYyLTQxOGQtYjQ2ZC0xODcyYmI2ZGUzYWYiLCJpbnN0YW5jZV9pZCI6IjI4NThhYWM1LTJiYTYtNDEzOS1iM2M3LWI2MzZlMjk1MDcwMSIsInN1YmRvbWFpbiI6ImplcmVteSIsImNvbW11bml0eV9tZW1iZXJfaWQiOiJmZmIwY2JlNC00ZWY2LTQ3ZjMtYjg1Zi1lY2ViZTM3Zjg3NDMiLCJhdXRoX3VzZXJfaWQiOiI4NTgyYmNiYi0yNDRjLTRkMjctYjJhYy0xMGI3OWNiZTg0OGMifQ.dw2zNCBJkyfYbqP5rbrVuifAd98ZlemAx_AJ-nLlplc',
  true,
  true
)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.agent_mcp_conversations
  ADD COLUMN IF NOT EXISTS persona_slug TEXT NOT NULL DEFAULT 'jeremy';

DROP INDEX IF EXISTS public.agent_mcp_conversations_scope_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS agent_mcp_conversations_scope_uniq
  ON public.agent_mcp_conversations (
    agent_id,
    COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    persona_slug
  );