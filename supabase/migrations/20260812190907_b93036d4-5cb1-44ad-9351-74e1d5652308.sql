CREATE TABLE public.appointment_call_bridges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  appointment_id text NOT NULL,
  contact_id text,
  contact_name text,
  contact_phone text NOT NULL,
  assigned_user_id text,
  assigned_user_name text,
  assigned_user_phone text NOT NULL,
  appointment_time timestamptz NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  from_number text,
  conference_name text,
  user_call_sid text,
  contact_call_sid text,
  attempts integer NOT NULL DEFAULT 0,
  call_started_at timestamptz,
  user_answered_at timestamptz,
  contact_answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  last_error text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX appointment_call_bridges_appointment_key ON public.appointment_call_bridges (appointment_id);
CREATE INDEX appointment_call_bridges_due_idx ON public.appointment_call_bridges (status, scheduled_at);
CREATE INDEX appointment_call_bridges_user_sid_idx ON public.appointment_call_bridges (user_call_sid);
CREATE INDEX appointment_call_bridges_contact_sid_idx ON public.appointment_call_bridges (contact_call_sid);

GRANT SELECT, UPDATE, DELETE ON public.appointment_call_bridges TO authenticated;
GRANT ALL ON public.appointment_call_bridges TO service_role;
ALTER TABLE public.appointment_call_bridges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view appointment call bridges"
  ON public.appointment_call_bridges FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can update appointment call bridges"
  ON public.appointment_call_bridges FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Team can delete appointment call bridges"
  ON public.appointment_call_bridges FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_appointment_call_bridges_updated_at
  BEFORE UPDATE ON public.appointment_call_bridges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.appointment_call_bridge_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bridge_id uuid NOT NULL REFERENCES public.appointment_call_bridges(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  leg text,
  call_sid text,
  detail text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX appointment_call_bridge_events_bridge_idx ON public.appointment_call_bridge_events (bridge_id, created_at DESC);

GRANT SELECT ON public.appointment_call_bridge_events TO authenticated;
GRANT ALL ON public.appointment_call_bridge_events TO service_role;
ALTER TABLE public.appointment_call_bridge_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view appointment call bridge events"
  ON public.appointment_call_bridge_events FOR SELECT TO authenticated USING (true);