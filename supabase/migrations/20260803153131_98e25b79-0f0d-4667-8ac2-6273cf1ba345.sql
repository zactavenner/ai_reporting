select cron.schedule(
  'jarvis-mission-sweep',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/jarvis-goal-worker',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"action":"sweep"}'::jsonb
  );
  $$
);