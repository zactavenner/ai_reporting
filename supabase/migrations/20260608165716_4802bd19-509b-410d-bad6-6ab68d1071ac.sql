
CREATE TABLE public.onboarding_template_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX onboarding_template_items_key_sort_idx
  ON public.onboarding_template_items (template_key, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_template_items TO authenticated;
GRANT ALL ON public.onboarding_template_items TO service_role;

ALTER TABLE public.onboarding_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read templates"
  ON public.onboarding_template_items FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can manage templates"
  ON public.onboarding_template_items FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER onboarding_template_items_updated_at
  BEFORE UPDATE ON public.onboarding_template_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed Standard
INSERT INTO public.onboarding_template_items (template_key, category, title, sort_order) VALUES
('standard','Setup','Complete client intake form',1),
('standard','Setup','Upload brand assets (logo, colors, fonts)',2),
('standard','Setup','Connect GHL sub-account',3),
('standard','Setup','Set up pipelines & calendar mappings',4),
('standard','Setup','Configure webhook mappings',5),
('standard','Ads','Connect Meta ad account',6),
('standard','Ads','Install Meta pixel on website',7),
('standard','Ads','Create first ad campaign',8),
('standard','Ads','Upload initial creatives',9),
('standard','Funnel','Set up landing page',10),
('standard','Funnel','Set up booking page',11),
('standard','Funnel','Configure email/SMS sequences',12),
('standard','Fulfillment','Generate research report',13),
('standard','Fulfillment','Generate marketing angles',14),
('standard','Fulfillment','Generate ad copy & scripts',15),
('standard','Launch','Client kickoff call completed',16),
('standard','Launch','Verify pixel tracking',17),
('standard','Launch','Launch ads',18);

-- Seed Capital
INSERT INTO public.onboarding_template_items (template_key, category, title, sort_order) VALUES
('capital','Compliance & Legal','Confirm Reg D 506(b) or 506(c) exemption',1),
('capital','Compliance & Legal','Upload Private Placement Memorandum (PPM)',2),
('capital','Compliance & Legal','Add subscription agreement & operating agreement',3),
('capital','Compliance & Legal','Approve mandatory risk disclaimer + "Targeted returns" copy rules',4),
('capital','Compliance & Legal','Set accredited investor verification process',5),
('capital','Offer Setup','Define target return %, hold period, and minimum investment',6),
('capital','Offer Setup','Document fund/asset thesis and track record',7),
('capital','Offer Setup','Upload investor deck & one-pager',8),
('capital','Offer Setup','Generate AI offer summary in client_assets',9),
('capital','Brand & Creative','Load Capital Creative ad style (Deep Green / Gold / Playfair)',10),
('capital','Brand & Creative','Generate hero return statics (15% / 18% targeted return)',11),
('capital','Brand & Creative','Generate VSL script + caller script via generate-asset',12),
('capital','Brand & Creative','Produce 3 avatar ad variations (Veo 3.1)',13),
('capital','Brand & Creative','Compliance review — no "guaranteed", disclaimer present',14),
('capital','Funnel','Build accredited investor opt-in landing page',15),
('capital','Funnel','Add accreditation qualifier quiz/form',16),
('capital','Funnel','Set up investor booking calendar (45-min discovery)',17),
('capital','Funnel','Configure nurture email/SMS sequence with PPM delivery',18),
('capital','Ads','Connect Meta ad account & install pixel',19),
('capital','Ads','Create CBO campaign with accredited audience targeting',20),
('capital','Ads','Upload Capital Creative statics & video ads',21),
('capital','Ads','Set CPL / CoC% target thresholds & alerts',22),
('capital','CRM & Pipeline','Connect GHL sub-account & map investor pipeline stages',23),
('capital','CRM & Pipeline','Set stages: Lead → Qualified → Booked → Showed → Committed → Funded',24),
('capital','CRM & Pipeline','Wire webhook ingest for accreditation form',25),
('capital','CRM & Pipeline','Enable Slack channel mapping (creatives + approvals)',26),
('capital','Launch','Investor kickoff call completed',27),
('capital','Launch','Verify pixel + lead/call tracking end-to-end',28),
('capital','Launch','Launch ads & enable daily reporting',29),
('capital','Launch','Schedule weekly investor pipeline review',30);
