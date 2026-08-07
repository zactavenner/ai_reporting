SELECT cron.unschedule('drive-sync-approved-creatives-15m') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drive-sync-approved-creatives-15m');

SELECT cron.schedule(
  'drive-sync-approved-creatives-15m',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/drive-sync-approved-creatives',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnd3dtdHV2amxtemFwd3FpYWJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NDkzODIsImV4cCI6MjA4MzMyNTM4Mn0.STFrUoif30xXQCjabc3skP6_tTnVIATwHhwWxeZoUr4"}'::jsonb,
    body := '{"password":"HPA1234$"}'::jsonb
  ) AS request_id;
  $$
);