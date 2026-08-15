-- 1. Allow the daily reporting run secret in the service-role-only secret store.
ALTER TABLE public.integration_secrets DROP CONSTRAINT integration_secrets_provider_check;
ALTER TABLE public.integration_secrets ADD CONSTRAINT integration_secrets_provider_check
  CHECK (provider = ANY (ARRAY['meetgeek_webhook'::text, 'ghl_appointment_webhook'::text, 'daily_report_run'::text]));

INSERT INTO public.integration_secrets (provider, secret)
VALUES ('daily_report_run', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (provider) DO NOTHING;

-- 2. Preserve every daily run attempt instead of silently overwriting the audit trail.
ALTER TABLE public.daily_report_runs
  ADD COLUMN IF NOT EXISTS attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;