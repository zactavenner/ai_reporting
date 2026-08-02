CREATE TABLE public.creative_video_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES public.creatives(id) ON DELETE CASCADE,
  client_id uuid,
  status text NOT NULL DEFAULT 'queued',
  model text NOT NULL,
  fallback_models text[] NOT NULL DEFAULT '{}',
  prompt text NOT NULL,
  source_image_url text NOT NULL,
  aspect_ratio text NOT NULL DEFAULT '9:16',
  resolution text NOT NULL DEFAULT '720p',
  duration integer NOT NULL DEFAULT 5,
  provider text NOT NULL DEFAULT 'openrouter',
  provider_job_id text,
  polling_url text,
  attempts integer NOT NULL DEFAULT 0,
  poll_count integer NOT NULL DEFAULT 0,
  progress_label text,
  error text,
  output_path text,
  output_url text,
  cost_usd numeric,
  variation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_video_jobs TO authenticated;
GRANT SELECT ON public.creative_video_jobs TO anon;
GRANT ALL ON public.creative_video_jobs TO service_role;

ALTER TABLE public.creative_video_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read creative video jobs"
  ON public.creative_video_jobs FOR SELECT USING (true);
CREATE POLICY "Anyone can create creative video jobs"
  ON public.creative_video_jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update creative video jobs"
  ON public.creative_video_jobs FOR UPDATE USING (true);

CREATE INDEX idx_creative_video_jobs_creative ON public.creative_video_jobs (creative_id, created_at DESC);
CREATE INDEX idx_creative_video_jobs_open ON public.creative_video_jobs (status, updated_at) WHERE status IN ('queued','rendering','saving');

CREATE TRIGGER trg_creative_video_jobs_updated_at
  BEFORE UPDATE ON public.creative_video_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();