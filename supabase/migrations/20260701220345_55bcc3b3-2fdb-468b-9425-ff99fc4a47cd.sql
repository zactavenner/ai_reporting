
ALTER TABLE public.client_settings
  ADD COLUMN IF NOT EXISTS stats_report_frequency text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS stats_report_day_of_week smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stats_report_day_of_month smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stats_report_hour_local smallint NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS stats_report_timezone text NOT NULL DEFAULT 'America/Los_Angeles';

DO $$ BEGIN
  ALTER TABLE public.client_settings
    ADD CONSTRAINT stats_report_frequency_check
    CHECK (stats_report_frequency IN ('off','weekly','monthly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
