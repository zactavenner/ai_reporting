
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'anomaly-detector-nightly') THEN
    PERFORM cron.unschedule('anomaly-detector-nightly');
  END IF;
END $$;

SELECT cron.schedule(
  'anomaly-detector-nightly',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url := 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/anomaly-detector',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnd3dtdHV2amxtemFwd3FpYWJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NDkzODIsImV4cCI6MjA4MzMyNTM4Mn0.STFrUoif30xXQCjabc3skP6_tTnVIATwHhwWxeZoUr4"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
