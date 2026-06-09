DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-ghl-all-clients-4h') THEN
    PERFORM cron.unschedule('sync-ghl-all-clients-4h');
  END IF;
END $$;