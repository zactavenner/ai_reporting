ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS jarvis_model TEXT NOT NULL DEFAULT 'nvidia/nemotron-3-ultra-550b-a55b:free',
  ADD COLUMN IF NOT EXISTS jarvis_training_md TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS jarvis_display_name TEXT NOT NULL DEFAULT 'Jarvis Ironman';