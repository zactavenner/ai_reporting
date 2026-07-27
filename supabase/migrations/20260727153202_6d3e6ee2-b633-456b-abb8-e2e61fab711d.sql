-- 1. Launches (idempotent)
CREATE TABLE public.campaign_launches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|created_paused|active|failed|partial
  current_step TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta_campaign_id TEXT,
  meta_adset_ids TEXT[] DEFAULT '{}',
  meta_ad_ids TEXT[] DEFAULT '{}',
  meta_creative_ids TEXT[] DEFAULT '{}',
  meta_lead_form_id TEXT,
  offering_exemption TEXT, -- 506c|506b|other
  compliance_approval_id UUID,
  error_message TEXT,
  error_code TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_launches TO authenticated;
GRANT ALL ON public.campaign_launches TO service_role;
ALTER TABLE public.campaign_launches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read/write launches" ON public.campaign_launches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_launches_client ON public.campaign_launches(client_id, created_at DESC);
CREATE INDEX idx_launches_status ON public.campaign_launches(status);

-- 2. Launch objects (for resume)
CREATE TABLE public.campaign_launch_objects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.campaign_launches(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- campaign|adset|creative|ad|leadform|image|video
  ordinal INT NOT NULL DEFAULT 0,
  meta_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|created|failed
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_launch_objects TO authenticated;
GRANT ALL ON public.campaign_launch_objects TO service_role;
ALTER TABLE public.campaign_launch_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read/write launch objects" ON public.campaign_launch_objects FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_launch_objects_launch ON public.campaign_launch_objects(launch_id, kind, ordinal);

-- 3. Launch events
CREATE TABLE public.campaign_launch_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  launch_id UUID NOT NULL REFERENCES public.campaign_launches(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_launch_events TO authenticated;
GRANT ALL ON public.campaign_launch_events TO service_role;
ALTER TABLE public.campaign_launch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read/write launch events" ON public.campaign_launch_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_launch_events_launch ON public.campaign_launch_events(launch_id, created_at);

-- 4. Templates
CREATE TABLE public.campaign_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT, -- website_lead|instant_form|schedule_call|creative_test_abo|audience_test_abo|scale_cbo|custom
  config JSONB NOT NULL DEFAULT '{}'::jsonb, -- objective, budget, targeting, creative slots, copy, form structure
  is_starter BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_templates TO authenticated;
GRANT ALL ON public.campaign_templates TO service_role;
ALTER TABLE public.campaign_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read/write templates" ON public.campaign_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Approved claims
CREATE TABLE public.approved_claims (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  supporting_source TEXT,
  gross_or_net TEXT, -- gross|net
  time_period TEXT,
  approval_status TEXT NOT NULL DEFAULT 'approved', -- approved|expired|revoked
  approver TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  required_disclosure TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approved_claims TO authenticated;
GRANT ALL ON public.approved_claims TO service_role;
ALTER TABLE public.approved_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read/write approved claims" ON public.approved_claims FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_approved_claims_client ON public.approved_claims(client_id);

-- 6. Compliance approvals (audit-only overrides for 506(b)/other)
CREATE TABLE public.compliance_approvals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  launch_id UUID REFERENCES public.campaign_launches(id) ON DELETE SET NULL,
  exemption TEXT NOT NULL, -- 506c|506b|other
  approver_name TEXT NOT NULL,
  approver_email TEXT,
  reason TEXT NOT NULL,
  attested BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_approvals TO authenticated;
GRANT ALL ON public.compliance_approvals TO service_role;
ALTER TABLE public.compliance_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read/write compliance approvals" ON public.compliance_approvals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Trigger to keep updated_at fresh
CREATE TRIGGER trg_campaign_launches_updated_at BEFORE UPDATE ON public.campaign_launches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_campaign_templates_updated_at BEFORE UPDATE ON public.campaign_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed 6 starter templates
INSERT INTO public.campaign_templates (name, description, category, is_starter, config) VALUES
  ('Website Lead — CBO', 'Send traffic to a landing page with the Meta pixel firing Lead event.', 'website_lead', true, '{"objective":"conversions","budget_type":"CBO","daily_budget":100,"targeting":{"age_min":30,"age_max":65,"countries":["US"]},"placements":"automatic","primary_text_prefix":"Accredited Investor:","cta":"LEARN_MORE"}'::jsonb),
  ('Instant Form — Lead Gen ABO', 'Meta native lead form with accredited-investor qualifier questions.', 'instant_form', true, '{"objective":"leads","budget_type":"ABO","daily_budget":75,"targeting":{"age_min":30,"age_max":65,"countries":["US"]},"placements":"automatic","primary_text_prefix":"Accredited Investor:","cta":"SIGN_UP","lead_form":{"questions":[{"type":"FULL_NAME"},{"type":"EMAIL"},{"type":"PHONE"},{"type":"MULTIPLE_CHOICE","key":"accredited","label":"Are you an accredited investor?","options":["Yes","No"]}]}}'::jsonb),
  ('Schedule Call', 'Drive booked calls via calendar landing page.', 'schedule_call', true, '{"objective":"conversions","budget_type":"CBO","daily_budget":150,"custom_event_type":"SCHEDULE","placements":"automatic","primary_text_prefix":"Accredited Investor:","cta":"BOOK_TRAVEL"}'::jsonb),
  ('Creative Test — ABO', 'One ad set per creative, equal budgets, 3-5 day read.', 'creative_test_abo', true, '{"objective":"leads","budget_type":"ABO","daily_budget":50,"adset_count":4,"placements":"automatic","primary_text_prefix":"Accredited Investor:"}'::jsonb),
  ('Audience Test — ABO', 'Same creative across multiple audiences, ABO for clean reads.', 'audience_test_abo', true, '{"objective":"leads","budget_type":"ABO","daily_budget":50,"adset_count":3,"placements":"automatic","primary_text_prefix":"Accredited Investor:"}'::jsonb),
  ('Scale — CBO', 'Move winning creatives + audiences into a CBO with higher budget.', 'scale_cbo', true, '{"objective":"leads","budget_type":"CBO","daily_budget":500,"placements":"automatic","primary_text_prefix":"Accredited Investor:"}'::jsonb);