-- MeetGeek ingestion schema: idempotent so a fresh environment matches production.

CREATE TABLE IF NOT EXISTS public.client_meetgeek_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  ghl_location_id text,
  ghl_calendar_id text,
  ghl_calendar_name text,
  bot_join_policy text NOT NULL DEFAULT 'selected_calendar_video_only',
  mapping_valid boolean NOT NULL DEFAULT false,
  mapping_error text,
  webhook_secret_configured boolean NOT NULL DEFAULT false,
  last_event_at timestamptz,
  last_bot_join_at timestamptz,
  last_completed_meeting_at timestamptz,
  last_crm_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meeting_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'meetgeek',
  meeting_external_id text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  title text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer,
  language text,
  host_email text,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript_url text,
  recording_url text,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, meeting_external_id)
);

CREATE TABLE IF NOT EXISTS public.meeting_ingest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'meetgeek',
  dedupe_key text NOT NULL,
  event_id text,
  meeting_external_id text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'processing',
  error_message text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, dedupe_key)
);

CREATE TABLE IF NOT EXISTS public.lead_meeting_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_record_id uuid NOT NULL REFERENCES public.meeting_records(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  matched_email text,
  match_method text,
  match_confidence numeric,
  ghl_contact_id text,
  ghl_note_status text,
  ghl_note_error text,
  ghl_note_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meeting_call_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'meetgeek',
  idempotency_key text NOT NULL,
  ghl_location_id text,
  ghl_calendar_id text,
  ghl_event_id text,
  ghl_contact_id text,
  meetgeek_meeting_id text,
  meetgeek_event_id text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  meeting_record_id uuid REFERENCES public.meeting_records(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'booked',
  title text,
  attendee_email text,
  agent_joined_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer,
  recording_url text,
  transcript_url text,
  summary text,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  crm_sync_status text NOT NULL DEFAULT 'pending',
  crm_sync_error text,
  crm_attempts integer NOT NULL DEFAULT 0,
  crm_synced_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, idempotency_key)
);

-- New columns for ingestion scope + deterministic quality scoring.
ALTER TABLE public.client_meetgeek_settings
  ADD COLUMN IF NOT EXISTS ingest_mode text NOT NULL DEFAULT 'selected_calendar';

ALTER TABLE public.meeting_call_activity
  ADD COLUMN IF NOT EXISTS quality_rating integer,
  ADD COLUMN IF NOT EXISTS quality_rubric jsonb,
  ADD COLUMN IF NOT EXISTS quality_summary text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_meetgeek_settings_ingest_mode_check'
  ) THEN
    ALTER TABLE public.client_meetgeek_settings
      ADD CONSTRAINT client_meetgeek_settings_ingest_mode_check
      CHECK (ingest_mode IN ('selected_calendar','all_mapped_calendars'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meeting_call_activity_quality_rating_check'
  ) THEN
    ALTER TABLE public.meeting_call_activity
      ADD CONSTRAINT meeting_call_activity_quality_rating_check
      CHECK (quality_rating IS NULL OR (quality_rating BETWEEN 1 AND 10));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mca_client_created ON public.meeting_call_activity (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mca_lead ON public.meeting_call_activity (lead_id);
CREATE INDEX IF NOT EXISTS idx_mca_meetgeek_meeting ON public.meeting_call_activity (meetgeek_meeting_id);
CREATE INDEX IF NOT EXISTS idx_mca_event ON public.meeting_call_activity (ghl_event_id);
CREATE INDEX IF NOT EXISTS idx_mie_client_created ON public.meeting_ingest_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mr_client_started ON public.meeting_records (client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lmc_lead ON public.lead_meeting_context (lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lmc_record_lead ON public.lead_meeting_context (meeting_record_id, lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_meetgeek_settings TO authenticated;
GRANT ALL ON public.client_meetgeek_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_call_activity TO authenticated;
GRANT ALL ON public.meeting_call_activity TO service_role;
GRANT SELECT ON public.meeting_ingest_events TO authenticated;
GRANT ALL ON public.meeting_ingest_events TO service_role;
GRANT SELECT ON public.meeting_records TO authenticated;
GRANT ALL ON public.meeting_records TO service_role;
GRANT SELECT ON public.lead_meeting_context TO authenticated;
GRANT ALL ON public.lead_meeting_context TO service_role;

ALTER TABLE public.client_meetgeek_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_call_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_ingest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_meeting_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can view meetgeek settings" ON public.client_meetgeek_settings;
CREATE POLICY "Team members can view meetgeek settings" ON public.client_meetgeek_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Team members can manage meetgeek settings" ON public.client_meetgeek_settings;
CREATE POLICY "Team members can manage meetgeek settings" ON public.client_meetgeek_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Team members can view meeting call activity" ON public.meeting_call_activity;
CREATE POLICY "Team members can view meeting call activity" ON public.meeting_call_activity
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Team members can manage meeting call activity" ON public.meeting_call_activity;
CREATE POLICY "Team members can manage meeting call activity" ON public.meeting_call_activity
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read meeting ingest events" ON public.meeting_ingest_events;
CREATE POLICY "Authenticated can read meeting ingest events" ON public.meeting_ingest_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can read meeting records" ON public.meeting_records;
CREATE POLICY "Authenticated can read meeting records" ON public.meeting_records
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can read lead meeting context" ON public.lead_meeting_context;
CREATE POLICY "Authenticated can read lead meeting context" ON public.lead_meeting_context
  FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS client_meetgeek_settings_updated_at ON public.client_meetgeek_settings;
CREATE TRIGGER client_meetgeek_settings_updated_at BEFORE UPDATE ON public.client_meetgeek_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS meeting_call_activity_updated_at ON public.meeting_call_activity;
CREATE TRIGGER meeting_call_activity_updated_at BEFORE UPDATE ON public.meeting_call_activity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();