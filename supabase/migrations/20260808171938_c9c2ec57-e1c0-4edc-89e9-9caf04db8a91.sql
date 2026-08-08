ALTER TABLE public.meetgeek_guest_invite_jobs
  ADD COLUMN IF NOT EXISTS ghl_contact_id text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS assigned_user_id text,
  ADD COLUMN IF NOT EXISTS assigned_user_name text,
  ADD COLUMN IF NOT EXISTS assigned_user_email text,
  ADD COLUMN IF NOT EXISTS ghl_calendar_name text,
  ADD COLUMN IF NOT EXISTS invite_summary text,
  ADD COLUMN IF NOT EXISTS meeting_record_id uuid REFERENCES public.meeting_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS match_method text;

CREATE INDEX IF NOT EXISTS idx_mgij_appointment ON public.meetgeek_guest_invite_jobs (ghl_appointment_id);
CREATE INDEX IF NOT EXISTS idx_mgij_invite_uid ON public.meetgeek_guest_invite_jobs (invite_uid);
CREATE INDEX IF NOT EXISTS idx_mgij_window ON public.meetgeek_guest_invite_jobs (client_id, scheduled_start);

ALTER TABLE public.meeting_records
  ADD COLUMN IF NOT EXISTS guest_invite_job_id uuid REFERENCES public.meetgeek_guest_invite_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ghl_appointment_id text,
  ADD COLUMN IF NOT EXISTS ghl_calendar_id text,
  ADD COLUMN IF NOT EXISTS ghl_calendar_name text,
  ADD COLUMN IF NOT EXISTS ghl_location_id text,
  ADD COLUMN IF NOT EXISTS ghl_contact_id text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS sales_agent_id text,
  ADD COLUMN IF NOT EXISTS sales_agent_name text,
  ADD COLUMN IF NOT EXISTS attribution_method text,
  ADD COLUMN IF NOT EXISTS attributed_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_meeting_records_appointment ON public.meeting_records (ghl_appointment_id);
CREATE INDEX IF NOT EXISTS idx_meeting_records_agent ON public.meeting_records (client_id, sales_agent_name);

ALTER TABLE public.client_meetgeek_settings
  ADD COLUMN IF NOT EXISTS booking_calendars jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE VIEW public.v_meeting_agent_rollup AS
  SELECT
    m.client_id,
    COALESCE(m.sales_agent_name, 'Unassigned') AS sales_agent_name,
    m.sales_agent_id,
    COUNT(*)::bigint AS meetings_recorded,
    COUNT(*) FILTER (WHERE m.started_at >= now() - interval '30 days')::bigint AS meetings_last_30d,
    COUNT(*) FILTER (WHERE m.started_at >= now() - interval '7 days')::bigint AS meetings_last_7d,
    COALESCE(AVG(m.duration_minutes), 0)::numeric AS avg_duration_minutes,
    MAX(m.started_at) AS last_meeting_at
  FROM public.meeting_records m
  WHERE m.client_id IS NOT NULL
  GROUP BY m.client_id, COALESCE(m.sales_agent_name, 'Unassigned'), m.sales_agent_id;

GRANT SELECT ON public.v_meeting_agent_rollup TO service_role;