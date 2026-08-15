ALTER TABLE public.integration_secrets DROP CONSTRAINT IF EXISTS integration_secrets_provider_check;
ALTER TABLE public.integration_secrets
  ADD CONSTRAINT integration_secrets_provider_check
  CHECK (provider IN ('ghl_appointment_webhook','daily_report_run','meetgeek_webhook','jeremy_review_cron'));