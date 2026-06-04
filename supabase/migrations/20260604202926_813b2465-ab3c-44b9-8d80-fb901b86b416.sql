SELECT cron.unschedule('task-due-today-watchdog') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='task-due-today-watchdog');

SELECT cron.schedule(
  'task-due-today-watchdog',
  '0 17 * * *', -- 17:00 UTC = 9am PST / 10am PDT
  $$
  SELECT net.http_post(
    url := 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/task-due-today-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);