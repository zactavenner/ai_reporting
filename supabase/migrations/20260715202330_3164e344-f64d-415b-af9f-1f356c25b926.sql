DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ghl-recent-conversations-15m') THEN
    PERFORM cron.unschedule('ghl-recent-conversations-15m');
  END IF;
END $$;

SELECT cron.schedule(
  'ghl-recent-conversations-15m',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/sync-ghl-contacts',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInJlZiI6Impnd3dtdHV2amxtemFwd3FpYWJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NDkzODIsImV4cCI6MjA4MzMyNTM4Mn0.STFrUoif30xXQCjabc3skP6_tTnVIATwHhwWxeZoUr4"}'::jsonb,
    body := '{"mode":"recent_conversations","syncTimeline":true,"sinceMinutes":60,"maxConversations":100}'::jsonb
  ) AS request_id;
  $$
);