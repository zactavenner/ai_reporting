ALTER TABLE public.phone_call_records
  ADD COLUMN IF NOT EXISTS answered boolean,
  ADD COLUMN IF NOT EXISTS qualified boolean,
  ADD COLUMN IF NOT EXISTS appointment_booked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS appointment_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS appointment_status text,
  ADD COLUMN IF NOT EXISTS follow_up_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_ai_caller boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_agent text;

CREATE INDEX IF NOT EXISTS idx_phone_call_records_ai_caller
  ON public.phone_call_records (client_id, is_ai_caller, started_at DESC);