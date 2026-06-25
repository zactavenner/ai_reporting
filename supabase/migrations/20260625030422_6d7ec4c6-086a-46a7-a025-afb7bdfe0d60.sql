
CREATE TABLE public.client_report_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  email text,
  phone_e164 text,
  channels text[] NOT NULL DEFAULT ARRAY['email']::text[],
  cadences text[] NOT NULL DEFAULT ARRAY['weekly','monthly']::text[],
  active boolean NOT NULL DEFAULT true,
  unsubscribed_at timestamptz,
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipient_has_contact CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE INDEX idx_crr_client ON public.client_report_recipients(client_id);
CREATE UNIQUE INDEX idx_crr_unsub_token ON public.client_report_recipients(unsubscribe_token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_report_recipients TO authenticated;
GRANT ALL ON public.client_report_recipients TO service_role;
ALTER TABLE public.client_report_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth manage recipients" ON public.client_report_recipients FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_crr_updated_at BEFORE UPDATE ON public.client_report_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.client_report_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.client_report_recipients(id) ON DELETE SET NULL,
  cadence text NOT NULL,
  channel text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  ghl_message_id text,
  ghl_contact_id text,
  error text,
  payload jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_crs_idem ON public.client_report_sends(idempotency_key);
CREATE INDEX idx_crs_client ON public.client_report_sends(client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_report_sends TO authenticated;
GRANT ALL ON public.client_report_sends TO service_role;
ALTER TABLE public.client_report_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read sends" ON public.client_report_sends FOR SELECT TO authenticated USING (true);
CREATE POLICY "service write sends" ON public.client_report_sends FOR ALL TO service_role USING (true) WITH CHECK (true);
