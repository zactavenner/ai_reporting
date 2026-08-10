ALTER TABLE public.meetgeek_guest_invite_jobs
  ADD COLUMN IF NOT EXISTS ghl_appointment_status text,
  ADD COLUMN IF NOT EXISTS attendance_status text,
  ADD COLUMN IF NOT EXISTS attendance_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS meetgeek_guest_invite_jobs_attendance_idx
  ON public.meetgeek_guest_invite_jobs (scheduled_start DESC, attendance_status);