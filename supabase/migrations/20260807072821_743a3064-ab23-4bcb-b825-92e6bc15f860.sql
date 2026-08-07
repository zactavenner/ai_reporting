ALTER TABLE public.integration_secrets
  DROP CONSTRAINT IF EXISTS integration_secrets_provider_check;

ALTER TABLE public.integration_secrets
  ADD CONSTRAINT integration_secrets_provider_check
  CHECK (provider IN ('meetgeek_webhook', 'ghl_appointment_webhook'));

-- Re-assert the private, service-role-only boundary (idempotent, no config changes).
REVOKE ALL ON public.integration_secrets FROM PUBLIC;
REVOKE ALL ON public.integration_secrets FROM anon;
REVOKE ALL ON public.integration_secrets FROM authenticated;
GRANT ALL ON public.integration_secrets TO service_role;
ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;