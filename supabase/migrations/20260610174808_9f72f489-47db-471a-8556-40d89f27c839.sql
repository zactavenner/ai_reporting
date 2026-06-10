
-- ============== client_videos ==============
CREATE TABLE public.client_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title TEXT,
  prompt TEXT,
  storage_url TEXT NOT NULL,
  storage_path TEXT,
  poster_url TEXT,
  source_url TEXT,
  source TEXT NOT NULL DEFAULT 'ai_studio',
  conversation_id UUID,
  canvas_item_id UUID,
  parent_video_id UUID REFERENCES public.client_videos(id) ON DELETE SET NULL,
  model TEXT,
  aspect_ratio TEXT,
  duration_seconds NUMERIC,
  resolution TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  edit_instructions TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_videos TO authenticated;
GRANT ALL ON public.client_videos TO service_role;
ALTER TABLE public.client_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users manage client_videos"
  ON public.client_videos FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE INDEX idx_client_videos_client ON public.client_videos(client_id, created_at DESC);
CREATE INDEX idx_client_videos_parent ON public.client_videos(parent_video_id);
CREATE TRIGGER trg_client_videos_updated BEFORE UPDATE ON public.client_videos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============== agency_references (agency-wide) ==============
CREATE TABLE public.agency_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,                 -- 'avatar' | 'product' | 'brand' | 'pdf' | 'image' | 'video' | 'doc'
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  mime TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_references TO authenticated;
GRANT ALL ON public.agency_references TO service_role;
ALTER TABLE public.agency_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users manage agency_references"
  ON public.agency_references FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE TRIGGER trg_agency_references_updated BEFORE UPDATE ON public.agency_references
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============== client_references (per-client master) ==============
CREATE TABLE public.client_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  mime TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_references TO authenticated;
GRANT ALL ON public.client_references TO service_role;
ALTER TABLE public.client_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users manage client_references"
  ON public.client_references FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE INDEX idx_client_references_client ON public.client_references(client_id, created_at DESC);
CREATE TRIGGER trg_client_references_updated BEFORE UPDATE ON public.client_references
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============== video_edit_messages ==============
CREATE TABLE public.video_edit_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_video_id UUID NOT NULL REFERENCES public.client_videos(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                 -- 'user' | 'assistant'
  content TEXT NOT NULL,
  result_video_id UUID REFERENCES public.client_videos(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_edit_messages TO authenticated;
GRANT ALL ON public.video_edit_messages TO service_role;
ALTER TABLE public.video_edit_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users manage video_edit_messages"
  ON public.video_edit_messages FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE INDEX idx_video_edit_messages_video ON public.video_edit_messages(source_video_id, created_at);
