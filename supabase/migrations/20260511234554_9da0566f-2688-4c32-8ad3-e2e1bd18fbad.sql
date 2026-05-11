
-- AI Studio per-user, per-client conversation persistence
CREATE TABLE public.ai_studio_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  client_id UUID NOT NULL,
  doc_url TEXT,
  sheet_url TEXT,
  image_quality TEXT NOT NULL DEFAULT 'pro',
  cleared_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE TABLE public.ai_studio_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_studio_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL DEFAULT '',
  tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_studio_messages_conv ON public.ai_studio_messages(conversation_id, created_at);

CREATE TABLE public.ai_studio_canvas_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_studio_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_studio_canvas_conv ON public.ai_studio_canvas_items(conversation_id, created_at DESC);

ALTER TABLE public.ai_studio_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_studio_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_studio_canvas_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own conversations - all" ON public.ai_studio_conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own messages - all" ON public.ai_studio_messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own canvas items - all" ON public.ai_studio_canvas_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_ai_studio_conversations_updated
  BEFORE UPDATE ON public.ai_studio_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
