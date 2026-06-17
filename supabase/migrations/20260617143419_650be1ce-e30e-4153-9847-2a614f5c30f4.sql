ALTER TABLE public.creatives
  ADD COLUMN IF NOT EXISTS canva_url text,
  ADD COLUMN IF NOT EXISTS canva_design_id text,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'upload';