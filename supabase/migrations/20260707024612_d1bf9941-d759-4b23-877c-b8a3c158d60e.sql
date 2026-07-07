
ALTER TABLE public.meta_ad_daily_insights
  ADD COLUMN IF NOT EXISTS video_3s_views int,
  ADD COLUMN IF NOT EXISTS video_thruplay int;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS current_disposition text,
  ADD COLUMN IF NOT EXISTS disposition_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_score numeric;

CREATE TABLE IF NOT EXISTS public.lead_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  disposition text NOT NULL CHECK (disposition IN ('new','contacted','qualified','unqualified','bad_contact_info','no_show','not_accredited','not_interested','nurture','booked','showed','opportunity','funded','bad_lead')),
  disposition_reason text,
  disposed_by text,
  source text NOT NULL DEFAULT 'ghl' CHECK (source IN ('ghl','manual','ai_setter')),
  ghl_raw jsonb,
  disposed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_dispositions TO authenticated;
GRANT ALL ON public.lead_dispositions TO service_role;
ALTER TABLE public.lead_dispositions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can manage lead_dispositions" ON public.lead_dispositions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS lead_dispositions_client_disposed_idx ON public.lead_dispositions(client_id, disposed_at DESC);
CREATE INDEX IF NOT EXISTS lead_dispositions_lead_idx ON public.lead_dispositions(lead_id);

CREATE TABLE IF NOT EXISTS public.disposition_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  match_type text NOT NULL CHECK (match_type IN ('stage_contains','tag_equals','field_equals')),
  match_value text NOT NULL,
  disposition text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disposition_mappings TO authenticated;
GRANT ALL ON public.disposition_mappings TO service_role;
ALTER TABLE public.disposition_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can manage disposition_mappings" ON public.disposition_mappings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS disposition_mappings_client_idx ON public.disposition_mappings(client_id, active);
CREATE TRIGGER disposition_mappings_updated_at BEFORE UPDATE ON public.disposition_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.disposition_mappings (client_id, match_type, match_value, disposition) VALUES
  (NULL, 'stage_contains', 'qualified', 'qualified'),
  (NULL, 'stage_contains', 'DQ', 'unqualified'),
  (NULL, 'stage_contains', 'disqualif', 'unqualified'),
  (NULL, 'stage_contains', 'unqualif', 'unqualified'),
  (NULL, 'stage_contains', 'no show', 'no_show'),
  (NULL, 'stage_contains', 'noshow', 'no_show'),
  (NULL, 'stage_contains', 'not accredited', 'not_accredited'),
  (NULL, 'stage_contains', 'booked', 'booked'),
  (NULL, 'stage_contains', 'appointment', 'booked'),
  (NULL, 'stage_contains', 'showed', 'showed'),
  (NULL, 'stage_contains', 'show up', 'showed'),
  (NULL, 'stage_contains', 'won', 'funded'),
  (NULL, 'stage_contains', 'funded', 'funded'),
  (NULL, 'stage_contains', 'nurture', 'nurture'),
  (NULL, 'stage_contains', 'not interested', 'not_interested'),
  (NULL, 'stage_contains', 'contacted', 'contacted'),
  (NULL, 'stage_contains', 'opportunity', 'opportunity'),
  (NULL, 'tag_equals', 'bad lead', 'bad_lead'),
  (NULL, 'tag_equals', 'spam', 'bad_lead'),
  (NULL, 'tag_equals', 'bad contact info', 'bad_contact_info')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ad_lead_quality (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  meta_ad_id text NOT NULL,
  window_size text NOT NULL CHECK (window_size IN ('7d','30d')),
  date date NOT NULL,
  leads int NOT NULL DEFAULT 0,
  qualified int NOT NULL DEFAULT 0,
  qualified_rate numeric NOT NULL DEFAULT 0,
  bad_rate numeric NOT NULL DEFAULT 0,
  booked_rate numeric NOT NULL DEFAULT 0,
  funded int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meta_ad_id, window_size, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_lead_quality TO authenticated;
GRANT ALL ON public.ad_lead_quality TO service_role;
ALTER TABLE public.ad_lead_quality ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can manage ad_lead_quality" ON public.ad_lead_quality
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS ad_lead_quality_client_date_idx ON public.ad_lead_quality(client_id, date DESC);
CREATE INDEX IF NOT EXISTS ad_lead_quality_ad_idx ON public.ad_lead_quality(meta_ad_id, window_size, date DESC);
CREATE TRIGGER ad_lead_quality_updated_at BEFORE UPDATE ON public.ad_lead_quality
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS meta_pixel_id text,
  ADD COLUMN IF NOT EXISTS meta_capi_access_token text;

CREATE TABLE IF NOT EXISTS public.capi_events_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_disposition_id uuid NOT NULL UNIQUE REFERENCES public.lead_dispositions(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  meta_response jsonb,
  success boolean NOT NULL DEFAULT true,
  sent_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capi_events_sent TO authenticated;
GRANT ALL ON public.capi_events_sent TO service_role;
ALTER TABLE public.capi_events_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can manage capi_events_sent" ON public.capi_events_sent
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS capi_events_sent_client_sent_idx ON public.capi_events_sent(client_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS capi_events_sent_event_idx ON public.capi_events_sent(event_name, sent_at DESC);
