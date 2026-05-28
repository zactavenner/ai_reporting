-- Reschedule auto-enrich-all from every 15 minutes to hourly
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-enrich-all-every-15m') THEN
    PERFORM cron.unschedule('auto-enrich-all-every-15m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-enrich-all-hourly') THEN
    PERFORM cron.unschedule('auto-enrich-all-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'auto-enrich-all-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url:='https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/auto-enrich-all',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnd3dtdHV2amxtemFwd3FpYWJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzc0OTM4MiwiZXhwIjoyMDgzMzI1MzgyfQ.qj47Xi-zBoUaB7Hh-1u9oXfBVf-7vpJoT1cV0aczHV0"}'::jsonb,
    body:='{"per_client": 100, "new_only": true, "since_hours": 2}'::jsonb
  ) AS request_id;
  $$
);

-- Hourly Google Sheets writeback sweep (runs 2 minutes after enrichment)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enrich-sheet-writeback-hourly') THEN
    PERFORM cron.unschedule('enrich-sheet-writeback-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'enrich-sheet-writeback-hourly',
  '2 * * * *',
  $$
  SELECT net.http_post(
    url:='https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/enrich-sheet-writeback',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnd3dtdHV2amxtemFwd3FpYWJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzc0OTM4MiwiZXhwIjoyMDgzMzI1MzgyfQ.qj47Xi-zBoUaB7Hh-1u9oXfBVf-7vpJoT1cV0aczHV0"}'::jsonb,
    body:='{}'::jsonb
  ) AS request_id;
  $$
);