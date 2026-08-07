-- 1) Organizer Google Calendar OAuth connections (server-only secret store)
CREATE TABLE public.google_calendar_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organizer_email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  google_account_id TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_refreshed_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON public.google_calendar_connections FROM PUBLIC;
REVOKE ALL ON public.google_calendar_connections FROM anon;
REVOKE ALL ON public.google_calendar_connections FROM authenticated;
GRANT ALL ON public.google_calendar_connections TO service_role;
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: service_role only (service_role bypasses RLS).

CREATE TRIGGER update_google_calendar_connections_updated_at
BEFORE UPDATE ON public.google_calendar_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Per-client guest (notetaker-as-attendee) configuration
CREATE TABLE public.client_meetgeek_guest_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  ghl_location_id TEXT,
  ghl_calendar_id TEXT,
  calendar_connection_id UUID REFERENCES public.google_calendar_connections(id) ON DELETE SET NULL,
  organizer_calendar_id TEXT NOT NULL DEFAULT 'primary',
  bot_guest_email TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  validation_status TEXT NOT NULL DEFAULT 'unvalidated',
  validation_error TEXT,
  last_validated_at TIMESTAMPTZ,
  last_invite_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON public.client_meetgeek_guest_configs FROM PUBLIC;
REVOKE ALL ON public.client_meetgeek_guest_configs FROM anon;
REVOKE ALL ON public.client_meetgeek_guest_configs FROM authenticated;
GRANT ALL ON public.client_meetgeek_guest_configs TO service_role;
ALTER TABLE public.client_meetgeek_guest_configs ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: service_role only.

CREATE TRIGGER update_client_meetgeek_guest_configs_updated_at
BEFORE UPDATE ON public.client_meetgeek_guest_configs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Guest-invite job / audit trail (operational metadata only)
CREATE TABLE public.meetgeek_guest_invite_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  guest_config_id UUID REFERENCES public.client_meetgeek_guest_configs(id) ON DELETE SET NULL,
  ghl_appointment_id TEXT,
  ghl_calendar_id TEXT,
  ghl_location_id TEXT,
  google_calendar_id TEXT,
  google_event_id TEXT,
  bot_guest_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  rejection_reason TEXT,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mg_guest_jobs_client ON public.meetgeek_guest_invite_jobs(client_id, created_at DESC);
CREATE INDEX idx_mg_guest_jobs_appt ON public.meetgeek_guest_invite_jobs(ghl_appointment_id);

REVOKE ALL ON public.meetgeek_guest_invite_jobs FROM PUBLIC;
REVOKE ALL ON public.meetgeek_guest_invite_jobs FROM anon;
REVOKE ALL ON public.meetgeek_guest_invite_jobs FROM authenticated;
GRANT ALL ON public.meetgeek_guest_invite_jobs TO service_role;
ALTER TABLE public.meetgeek_guest_invite_jobs ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: service_role only.

CREATE TRIGGER update_meetgeek_guest_invite_jobs_updated_at
BEFORE UPDATE ON public.meetgeek_guest_invite_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();