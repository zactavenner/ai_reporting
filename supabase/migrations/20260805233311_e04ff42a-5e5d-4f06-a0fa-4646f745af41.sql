-- ============================================================
-- Per-client MeetGeek configuration (server-derived mapping)
-- ============================================================
CREATE TABLE public.client_meetgeek_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  -- Server-derived only. Never written from browser-supplied values.
  ghl_location_id text,
  ghl_calendar_id text,
  ghl_calendar_name text,
  bot_join_policy text NOT NULL DEFAULT 'selected_calendar_video_only'
    CHECK (bot_join_policy IN ('never', 'selected_calendar_video_only', 'all_video_on_calendar')),
  webhook_secret_configured boolean NOT NULL DEFAULT false,
  mapping_valid boolean NOT NULL DEFAULT false,
  mapping_error text,
  last_event_at timestamp with time zone,
  last_bot_join_at timestamp with time zone,
  last_completed_meeting_at timestamp with time zone,
  last_crm_sync_at timestamp with time zone,
  last_error text,
  last_error_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_meetgeek_settings TO authenticated;
GRANT ALL ON public.client_meetgeek_settings TO service_role;

ALTER TABLE public.client_meetgeek_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view meetgeek settings"
  ON public.client_meetgeek_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team members can manage meetgeek settings"
  ON public.client_meetgeek_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_client_meetgeek_settings_updated_at
  BEFORE UPDATE ON public.client_meetgeek_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_client_meetgeek_settings_enabled
  ON public.client_meetgeek_settings (enabled) WHERE enabled = true;
CREATE INDEX idx_client_meetgeek_settings_calendar
  ON public.client_meetgeek_settings (ghl_calendar_id) WHERE ghl_calendar_id IS NOT NULL;

-- ============================================================
-- Client-scoped meeting / call activity lifecycle
-- ============================================================
CREATE TABLE public.meeting_call_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'meetgeek',
  -- Idempotency: one row per logical lifecycle event.
  idempotency_key text NOT NULL,
  ghl_location_id text,
  ghl_calendar_id text,
  ghl_event_id text,
  ghl_contact_id text,
  meetgeek_meeting_id text,
  meetgeek_event_id text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  meeting_record_id uuid REFERENCES public.meeting_records(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'bot_joined', 'completed', 'unmatched', 'rejected', 'error', 'test')),
  title text,
  attendee_email text,
  agent_joined_at timestamp with time zone,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration_minutes integer,
  recording_url text,
  transcript_url text,
  summary text,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  crm_sync_status text NOT NULL DEFAULT 'pending'
    CHECK (crm_sync_status IN ('pending', 'written', 'skipped', 'retrying', 'error', 'not_applicable')),
  crm_sync_error text,
  crm_synced_at timestamp with time zone,
  crm_attempts integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_call_activity TO authenticated;
GRANT ALL ON public.meeting_call_activity TO service_role;

ALTER TABLE public.meeting_call_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view meeting call activity"
  ON public.meeting_call_activity FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team members can manage meeting call activity"
  ON public.meeting_call_activity FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_meeting_call_activity_updated_at
  BEFORE UPDATE ON public.meeting_call_activity
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Idempotency + safe lookup indexes
CREATE UNIQUE INDEX idx_meeting_call_activity_idem
  ON public.meeting_call_activity (source, idempotency_key);
CREATE UNIQUE INDEX idx_meeting_call_activity_event
  ON public.meeting_call_activity (client_id, ghl_event_id)
  WHERE ghl_event_id IS NOT NULL;
CREATE INDEX idx_meeting_call_activity_client_time
  ON public.meeting_call_activity (client_id, started_at DESC NULLS LAST);
CREATE INDEX idx_meeting_call_activity_client_status
  ON public.meeting_call_activity (client_id, status);
CREATE INDEX idx_meeting_call_activity_lead
  ON public.meeting_call_activity (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_meeting_call_activity_meeting
  ON public.meeting_call_activity (meetgeek_meeting_id) WHERE meetgeek_meeting_id IS NOT NULL;
CREATE INDEX idx_meeting_call_activity_crm_retry
  ON public.meeting_call_activity (crm_sync_status, updated_at DESC)
  WHERE crm_sync_status IN ('pending', 'retrying', 'error');