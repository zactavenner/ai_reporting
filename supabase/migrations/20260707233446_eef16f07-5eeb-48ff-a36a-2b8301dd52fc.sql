-- Schedule hourly dispatch of weekly/monthly Sheet Stats email recaps.
-- pg_cron and pg_net are already installed on this project.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-sheet-stats-hourly') THEN
    PERFORM cron.unschedule('dispatch-sheet-stats-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'dispatch-sheet-stats-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/dispatch-sheet-stats',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('password', 'HPA1234$', 'origin', 'https://reporting.highperformanceads.com')
  );
  $$
);