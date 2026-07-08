-- Add new sync_type values used by daily-master-sync queue jobs.
ALTER TABLE public.sync_queue DROP CONSTRAINT IF EXISTS sync_queue_sync_type_check;
ALTER TABLE public.sync_queue ADD CONSTRAINT sync_queue_sync_type_check
  CHECK (sync_type = ANY (ARRAY[
    'contacts', 'appointments', 'timeline', 'full',
    'lead_upsert', 'call_upsert', 'opportunity_upsert', 'backfill',
    'meta_ads_sync', 'ghl_contacts_sync', 'ghl_calendar_sync',
    'ghl_pipelines_sync', 'recalculate_metrics'
  ]));

-- Allow next_retry_at to be used for initial scheduling on pending jobs
-- (no schema change needed — column already exists from prior migration).
-- Comment for clarity:
COMMENT ON COLUMN public.sync_queue.next_retry_at IS
  'For retrying jobs: next eligible attempt time. Also used for initial scheduling delay (pending jobs with a future next_retry_at are held until that time).';
