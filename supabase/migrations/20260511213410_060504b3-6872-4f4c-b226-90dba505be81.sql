ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS master_google_sheet_url text,
  ADD COLUMN IF NOT EXISTS master_default_gid text,
  ADD COLUMN IF NOT EXISTS master_pinned_gids jsonb NOT NULL DEFAULT '[]'::jsonb;