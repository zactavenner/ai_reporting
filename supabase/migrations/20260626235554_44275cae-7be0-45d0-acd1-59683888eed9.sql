
-- Agents: hierarchy + role + config + is_core
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS is_core boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Task comments: attribute to an agent
ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS author_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

-- Channels (audit trail of inter-agent + human comms)
CREATE TABLE IF NOT EXISTS public.agent_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('agency','client')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('agent','jarvis-hermes','jarvis-team')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, client_id, agent_id, kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_channels TO authenticated;
GRANT ALL ON public.agent_channels TO service_role;
ALTER TABLE public.agent_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels read all auth" ON public.agent_channels FOR SELECT TO authenticated USING (true);
CREATE POLICY "channels write all auth" ON public.agent_channels FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.agent_channels(id) ON DELETE CASCADE,
  from_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  to_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('agent','human','system')),
  user_id uuid,
  kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message','command','handoff','escalation','task-comment','tool-call','model-call')),
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_channel_created ON public.agent_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON public.agent_messages(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_task ON public.agent_messages(task_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_messages TO authenticated;
GRANT ALL ON public.agent_messages TO service_role;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages read all auth" ON public.agent_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "messages write all auth" ON public.agent_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_channels;
