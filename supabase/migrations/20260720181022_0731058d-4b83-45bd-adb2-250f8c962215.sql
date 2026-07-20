
ALTER TABLE public.client_weekly_calls
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS proposed_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS finalize_status text;

ALTER TABLE public.client_weekly_call_settings
  ADD COLUMN IF NOT EXISTS scorecard_sheet_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND schemaname='storage' AND policyname='weekly_call_recordings_read') THEN
    CREATE POLICY "weekly_call_recordings_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'weekly-call-recordings');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND schemaname='storage' AND policyname='weekly_call_recordings_write') THEN
    CREATE POLICY "weekly_call_recordings_write" ON storage.objects
      FOR INSERT WITH CHECK (bucket_id = 'weekly-call-recordings');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND schemaname='storage' AND policyname='weekly_call_recordings_update') THEN
    CREATE POLICY "weekly_call_recordings_update" ON storage.objects
      FOR UPDATE USING (bucket_id = 'weekly-call-recordings');
  END IF;
END$$;
