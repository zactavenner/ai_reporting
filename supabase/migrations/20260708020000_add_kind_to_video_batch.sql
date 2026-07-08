-- Add kind column to video_batch_jobs to distinguish single-scene / broll /
-- image-to-video jobs from the original multi-scene batch flow.
ALTER TABLE public.video_batch_jobs
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'multi-scene';

-- Add image_url column to video_batch_scenes for image-to-video jobs.
ALTER TABLE public.video_batch_scenes
  ADD COLUMN IF NOT EXISTS image_url TEXT;
