
-- Seed Jeremy AI agent (MCP-backed persona) and persistence for MCP conversations
INSERT INTO public.agency_agents (slug, name, role, icon, default_model, system_prompt, instructions_md, capabilities, is_active)
VALUES (
  'jeremy_ai',
  'Jeremy AI',
  'Personal AI persona (Utari) — strategist and thinking partner with Jeremy''s voice and context.',
  '🧠',
  'utari/persona',
  'You are Jeremy AI, backed by the Utari Persona MCP. Responses come directly from the persona server; do not fabricate — pass questions through.',
  'When a client is in scope, always include the client name, brand voice, ICP and the current offer(s) in the message you send to the persona so it can respond in context.',
  jsonb_build_object(
    'provider', 'utari_persona',
    'mcp_url', 'https://persona-mcp.utari.ai/mcp/?k=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ1dGFyaS1wZXJzb25hLW1jcCIsImlhdCI6MTc4NTE4OTYyMiwiZXhwIjoxNzkyOTY1NjIyLCJqdGkiOiIzOTBhNDU5Zi1hNmJhLTQzYjctYjE5NC1hZGM0OTI5ZTMwOWQiLCJpbnN0YW5jZV9pZCI6IjI4NThhYWM1LTJiYTYtNDEzOS1iM2M3LWI2MzZlMjk1MDcwMSIsInN1YmRvbWFpbiI6ImplcmVteSIsImNvbW11bml0eV9tZW1iZXJfaWQiOiJmZmIwY2JlNC00ZWY2LTQ3ZjMtYjg1Zi1lY2ViZTM3Zjg3NDMiLCJhdXRoX3VzZXJfaWQiOiI4NTgyYmNiYi0yNDRjLTRkMjctYjJhYy0xMGI3OWNiZTg0OGMifQ.0vbVES-pQXESIZqd4e1pTZOxZhwViUJvfBTYL8olVKg',
    'chat', ARRAY['utari/persona']::text[]
  ),
  true
)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      role = EXCLUDED.role,
      icon = EXCLUDED.icon,
      default_model = EXCLUDED.default_model,
      capabilities = EXCLUDED.capabilities,
      instructions_md = EXCLUDED.instructions_md,
      is_active = true;

-- Persist Utari persona conversation ids per (agent, client) scope so threads stay continuous
CREATE TABLE IF NOT EXISTS public.agent_mcp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agency_agents(id) ON DELETE CASCADE,
  client_id UUID NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_mcp_conversations_scope_uniq
  ON public.agent_mcp_conversations (agent_id, COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_mcp_conversations TO authenticated;
GRANT ALL ON public.agent_mcp_conversations TO service_role;

ALTER TABLE public.agent_mcp_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read agent_mcp_conversations"
  ON public.agent_mcp_conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write agent_mcp_conversations"
  ON public.agent_mcp_conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);
