
-- 1. Parent batch
CREATE TABLE public.video_batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID,
  model TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16',
  default_duration INTEGER NOT NULL DEFAULT 5,
  resolution TEXT NOT NULL DEFAULT '1080p',
  status TEXT NOT NULL DEFAULT 'processing',
  total_scenes INTEGER NOT NULL DEFAULT 0,
  completed_scenes INTEGER NOT NULL DEFAULT 0,
  failed_scenes INTEGER NOT NULL DEFAULT 0,
  character_description TEXT,
  offer_description TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_batch_jobs TO authenticated;
GRANT ALL ON public.video_batch_jobs TO service_role;
ALTER TABLE public.video_batch_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all video_batch_jobs" ON public.video_batch_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Scripts inside a batch
CREATE TABLE public.video_batch_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.video_batch_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  script_order INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_video_batch_scripts_batch ON public.video_batch_scripts(batch_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_batch_scripts TO authenticated;
GRANT ALL ON public.video_batch_scripts TO service_role;
ALTER TABLE public.video_batch_scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all video_batch_scripts" ON public.video_batch_scripts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. Scenes (one upstream video each)
CREATE TABLE public.video_batch_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.video_batch_jobs(id) ON DELETE CASCADE,
  script_id UUID NOT NULL REFERENCES public.video_batch_scripts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scene_order INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  duration INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_job_id TEXT,
  polling_url TEXT,
  raw_video_url TEXT,
  stored_video_url TEXT,
  asset_id UUID,
  poll_attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_video_batch_scenes_batch ON public.video_batch_scenes(batch_id);
CREATE INDEX idx_video_batch_scenes_status ON public.video_batch_scenes(status) WHERE status IN ('processing', 'queued');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_batch_scenes TO authenticated;
GRANT ALL ON public.video_batch_scenes TO service_role;
ALTER TABLE public.video_batch_scenes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner all video_batch_scenes" ON public.video_batch_scenes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.video_batch_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.video_batch_scenes;

-- updated_at triggers
CREATE TRIGGER trg_video_batch_jobs_updated
  BEFORE UPDATE ON public.video_batch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_video_batch_scenes_updated
  BEFORE UPDATE ON public.video_batch_scenes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
