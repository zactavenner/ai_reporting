ALTER TABLE public.fundad_creatives
  ADD COLUMN IF NOT EXISTS video_model text,
  ADD COLUMN IF NOT EXISTS video_url_alt text,
  ADD COLUMN IF NOT EXISTS video_status_alt text DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS video_model_alt text;