CREATE TABLE public.notetaker_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ghl_appointment_id text NOT NULL,
  ghl_calendar_id text,
  ghl_calendar_name text,
  ghl_location_id text,
  ghl_contact_id text,
  contact_name text,
  contact_email text,
  contact_phone text,
  assigned_user_id text,
  assigned_user_name text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  schedule_signature text,
  meeting_url text,
  expected_provider text NOT NULL DEFAULT 'unknown',
  appointment_state text NOT NULL DEFAULT 'scheduled',
  coverage_state text NOT NULL DEFAULT 'pending',
  outcome text,
  invite_job_id uuid REFERENCES public.meetgeek_guest_invite_jobs(id) ON DELETE SET NULL,
  invite_state text,
  meeting_record_id uuid REFERENCES public.meeting_records(id) ON DELETE SET NULL,
  phone_call_record_id uuid REFERENCES public.phone_call_records(id) ON DELETE SET NULL,
  match_method text,
  transcript_source text,
  transcript_chars integer NOT NULL DEFAULT 0,
  transcript_complete_at timestamptz,
  exception_code text,
  exception_message text,
  overdue_at timestamptz,
  last_checked_at timestamptz,
  reconcile_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notetaker_coverage_appointment_uidx UNIQUE (client_id, ghl_appointment_id),
  CONSTRAINT notetaker_coverage_expected_provider_chk CHECK (expected_provider IN ('meetgeek','ghl_phone','none','unknown')),
  CONSTRAINT notetaker_coverage_appointment_state_chk CHECK (appointment_state IN ('scheduled','rescheduled','cancelled','completed','noshow','unknown')),
  CONSTRAINT notetaker_coverage_coverage_state_chk CHECK (coverage_state IN ('pending','invited','awaiting_transcript','transcript_complete','not_required','exception')),
  CONSTRAINT notetaker_coverage_outcome_chk CHECK (outcome IS NULL OR outcome IN ('transcript_complete','no_transcript','cancelled','not_required','pending'))
);

GRANT ALL ON public.notetaker_coverage TO service_role;

ALTER TABLE public.notetaker_coverage ENABLE ROW LEVEL SECURITY;

CREATE INDEX notetaker_coverage_state_idx ON public.notetaker_coverage (coverage_state);
CREATE INDEX notetaker_coverage_client_start_idx ON public.notetaker_coverage (client_id, scheduled_start DESC);
CREATE INDEX notetaker_coverage_overdue_idx ON public.notetaker_coverage (overdue_at) WHERE coverage_state IN ('pending','invited','awaiting_transcript');

CREATE TRIGGER update_notetaker_coverage_updated_at
BEFORE UPDATE ON public.notetaker_coverage
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();