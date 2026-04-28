ALTER TABLE public.meta_ad_accounts
  ADD COLUMN IF NOT EXISTS pages jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pixels jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS instagram_actors jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assets_synced_at timestamptz;