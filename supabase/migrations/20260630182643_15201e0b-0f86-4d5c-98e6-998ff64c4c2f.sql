ALTER TABLE public.client_settings
  ADD COLUMN IF NOT EXISTS stats_report_recipients text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS stats_report_weekly_enabled boolean DEFAULT false;