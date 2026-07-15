
CREATE TABLE public.jarvis_alert_recipients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  alert_types TEXT[] NOT NULL DEFAULT ARRAY['all']::text[],
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_alert_recipients TO authenticated;
GRANT ALL ON public.jarvis_alert_recipients TO service_role;

ALTER TABLE public.jarvis_alert_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read jarvis recipients"
  ON public.jarvis_alert_recipients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert jarvis recipients"
  ON public.jarvis_alert_recipients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update jarvis recipients"
  ON public.jarvis_alert_recipients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete jarvis recipients"
  ON public.jarvis_alert_recipients FOR DELETE TO authenticated USING (true);

CREATE TRIGGER jarvis_recipients_updated_at
  BEFORE UPDATE ON public.jarvis_alert_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.jarvis_alert_recipients (name, phone_e164, active, alert_types, notes)
VALUES ('Zac', '+19167097345', true, ARRAY['all']::text[], 'Primary Jarvis alert recipient')
ON CONFLICT (phone_e164) DO NOTHING;
