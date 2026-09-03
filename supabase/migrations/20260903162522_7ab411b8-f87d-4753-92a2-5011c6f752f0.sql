-- Allow the server-only MeetGeek provider API key to live in the
-- service-role-only integration_secrets store (RLS on, no policies, no grants).
alter table public.integration_secrets
  drop constraint if exists integration_secrets_provider_check;

alter table public.integration_secrets
  add constraint integration_secrets_provider_check
  check (provider = any (array[
    'ghl_appointment_webhook',
    'daily_report_run',
    'meetgeek_webhook',
    'jeremy_review_cron',
    'meetgeek_api_key'
  ]));