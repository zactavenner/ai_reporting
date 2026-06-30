
CREATE TABLE IF NOT EXISTS public.jarvis_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jarvis_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.jarvis_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'main',         -- 'main' (user↔jarvis) | 'inter_agent' (jarvis↔hermes/others)
  speaker text NOT NULL,                        -- 'user' | 'jarvis' | 'hermes' | 'system'
  role text NOT NULL,                           -- 'user' | 'assistant' | 'system'
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jarvis_msgs_conv ON public.jarvis_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jarvis_convs_user ON public.jarvis_conversations(user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_conversations TO authenticated;
GRANT ALL ON public.jarvis_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_messages TO authenticated;
GRANT ALL ON public.jarvis_messages TO service_role;

ALTER TABLE public.jarvis_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own jarvis conversations"
  ON public.jarvis_conversations FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own jarvis messages"
  ON public.jarvis_messages FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_jarvis_conv() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.jarvis_conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_jarvis_conv ON public.jarvis_messages;
CREATE TRIGGER trg_touch_jarvis_conv AFTER INSERT ON public.jarvis_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_jarvis_conv();
