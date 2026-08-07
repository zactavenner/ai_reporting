ALTER TABLE public.meetgeek_guest_invite_jobs
  ADD COLUMN IF NOT EXISTS invite_mode text NOT NULL DEFAULT 'shadow_email',
  ADD COLUMN IF NOT EXISTS invite_uid text,
  ADD COLUMN IF NOT EXISTS invite_sequence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invite_method text,
  ADD COLUMN IF NOT EXISTS invite_provider text,
  ADD COLUMN IF NOT EXISTS invite_message_id text,
  ADD COLUMN IF NOT EXISTS invite_last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_send_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invite_update_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invite_cancel_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_signature text,
  ADD COLUMN IF NOT EXISTS meeting_url text;

GRANT ALL ON public.meetgeek_guest_invite_jobs TO service_role;