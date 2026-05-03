-- Clean up stuck sync_logs that have been "running" for > 15 minutes
UPDATE public.sync_logs
SET status = 'failed',
    error_message = 'Cleanup: stuck in running state',
    completed_at = NOW()
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '15 minutes';

-- Reset ghl_sync_status for clients whose last sync is > 48 hours old
-- so they show as needing attention on the dashboard
UPDATE public.clients
SET ghl_sync_status = CASE
  WHEN ghl_sync_status = 'error' THEN 'error'
  ELSE 'stale'
END
WHERE ghl_api_key IS NOT NULL
  AND ghl_location_id IS NOT NULL
  AND last_ghl_sync_at IS NOT NULL
  AND last_ghl_sync_at < NOW() - INTERVAL '48 hours'
  AND ghl_sync_status IS DISTINCT FROM 'error';
