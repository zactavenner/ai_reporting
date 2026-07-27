ALTER TABLE public.ad_spend_daily
  ADD COLUMN IF NOT EXISTS reach numeric,
  ADD COLUMN IF NOT EXISTS frequency numeric,
  ADD COLUMN IF NOT EXISTS ctr numeric,
  ADD COLUMN IF NOT EXISTS cpm numeric,
  ADD COLUMN IF NOT EXISTS cpc numeric,
  ADD COLUMN IF NOT EXISTS cost_per_lead numeric;