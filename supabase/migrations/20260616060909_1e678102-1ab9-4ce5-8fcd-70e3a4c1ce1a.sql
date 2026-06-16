
-- Phase 1: Meta Ads Manager foundation tables

-- 1. Campaign templates
CREATE TABLE public.meta_campaign_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  platform TEXT NOT NULL DEFAULT 'meta',
  objective TEXT,
  daily_budget NUMERIC,
  lifetime_budget NUMERIC,
  bid_strategy TEXT,
  optimization_goal TEXT,
  attribution_setting TEXT,
  placements JSONB DEFAULT '[]'::jsonb,
  targeting JSONB DEFAULT '{}'::jsonb,
  exclusions JSONB DEFAULT '{}'::jsonb,
  naming_convention JSONB DEFAULT '{}'::jsonb,
  default_lead_form_id TEXT,
  utm_template JSONB DEFAULT '{}'::jsonb,
  config JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_campaign_templates TO authenticated, anon;
GRANT ALL ON public.meta_campaign_templates TO service_role;
ALTER TABLE public.meta_campaign_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_campaign_templates" ON public.meta_campaign_templates FOR SELECT USING (true);
CREATE POLICY "Public write meta_campaign_templates" ON public.meta_campaign_templates FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_meta_campaign_templates_updated BEFORE UPDATE ON public.meta_campaign_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Lead forms (synced from Meta)
CREATE TABLE public.meta_lead_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  meta_ad_account_id TEXT,
  meta_page_id TEXT,
  meta_form_id TEXT NOT NULL,
  name TEXT,
  status TEXT,
  locale TEXT,
  questions JSONB DEFAULT '[]'::jsonb,
  conditional_logic JSONB DEFAULT '{}'::jsonb,
  privacy_policy_url TEXT,
  thank_you_page JSONB DEFAULT '{}'::jsonb,
  leads_count INTEGER DEFAULT 0,
  spend NUMERIC DEFAULT 0,
  cpl NUMERIC DEFAULT 0,
  completion_rate NUMERIC DEFAULT 0,
  conversion_rate NUMERIC DEFAULT 0,
  last_synced_at TIMESTAMPTZ,
  raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meta_form_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_lead_forms TO authenticated, anon;
GRANT ALL ON public.meta_lead_forms TO service_role;
ALTER TABLE public.meta_lead_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_lead_forms" ON public.meta_lead_forms FOR SELECT USING (true);
CREATE POLICY "Service write meta_lead_forms" ON public.meta_lead_forms FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_meta_lead_forms_client ON public.meta_lead_forms(client_id);
CREATE TRIGGER trg_meta_lead_forms_updated BEFORE UPDATE ON public.meta_lead_forms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Lead form templates
CREATE TABLE public.meta_lead_form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  questions JSONB DEFAULT '[]'::jsonb,
  conditional_logic JSONB DEFAULT '{}'::jsonb,
  config JSONB DEFAULT '{}'::jsonb,
  is_global BOOLEAN DEFAULT true,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_lead_form_templates TO authenticated, anon;
GRANT ALL ON public.meta_lead_form_templates TO service_role;
ALTER TABLE public.meta_lead_form_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_lead_form_templates" ON public.meta_lead_form_templates FOR SELECT USING (true);
CREATE POLICY "Public write meta_lead_form_templates" ON public.meta_lead_form_templates FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_meta_lead_form_templates_updated BEFORE UPDATE ON public.meta_lead_form_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Lead form field mappings to CRMs
CREATE TABLE public.meta_lead_form_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  meta_form_id TEXT NOT NULL,
  destination TEXT NOT NULL, -- 'ghl' | 'hubspot' | 'salesforce' | 'webhook'
  destination_config JSONB DEFAULT '{}'::jsonb,
  field_mappings JSONB DEFAULT '[]'::jsonb, -- [{source, target, transform}]
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_lead_form_mappings TO authenticated, anon;
GRANT ALL ON public.meta_lead_form_mappings TO service_role;
ALTER TABLE public.meta_lead_form_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_lead_form_mappings" ON public.meta_lead_form_mappings FOR SELECT USING (true);
CREATE POLICY "Public write meta_lead_form_mappings" ON public.meta_lead_form_mappings FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_meta_lead_form_mappings_updated BEFORE UPDATE ON public.meta_lead_form_mappings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Creative performance tags
CREATE TABLE public.meta_creative_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  meta_ad_id TEXT NOT NULL,
  tag TEXT NOT NULL, -- 'winner' | 'emerging' | 'fatigued' | 'underperforming'
  source TEXT NOT NULL DEFAULT 'auto', -- 'auto' | 'manual'
  score NUMERIC,
  reasons JSONB DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meta_ad_id, tag, source)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_creative_tags TO authenticated, anon;
GRANT ALL ON public.meta_creative_tags TO service_role;
ALTER TABLE public.meta_creative_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_creative_tags" ON public.meta_creative_tags FOR SELECT USING (true);
CREATE POLICY "Service write meta_creative_tags" ON public.meta_creative_tags FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_meta_creative_tags_ad ON public.meta_creative_tags(meta_ad_id);
CREATE INDEX idx_meta_creative_tags_client_tag ON public.meta_creative_tags(client_id, tag);
CREATE TRIGGER trg_meta_creative_tags_updated BEFORE UPDATE ON public.meta_creative_tags FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. AI creative insights (daily)
CREATE TABLE public.meta_ai_creative_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  meta_ad_id TEXT,
  scope TEXT NOT NULL DEFAULT 'ad', -- 'ad' | 'account' | 'campaign'
  insight_type TEXT, -- 'hook' | 'headline' | 'offer' | 'angle' | 'imagery' | 'cta' | 'summary'
  title TEXT,
  body TEXT,
  evidence JSONB DEFAULT '{}'::jsonb,
  confidence NUMERIC,
  model TEXT,
  generated_for_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_ai_creative_insights TO authenticated, anon;
GRANT ALL ON public.meta_ai_creative_insights TO service_role;
ALTER TABLE public.meta_ai_creative_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_ai_creative_insights" ON public.meta_ai_creative_insights FOR SELECT USING (true);
CREATE POLICY "Service write meta_ai_creative_insights" ON public.meta_ai_creative_insights FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_meta_ai_insights_client_date ON public.meta_ai_creative_insights(client_id, generated_for_date DESC);
CREATE INDEX idx_meta_ai_insights_ad ON public.meta_ai_creative_insights(meta_ad_id);

-- 7. Weekly briefs
CREATE TABLE public.meta_weekly_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  summary TEXT,
  winners JSONB DEFAULT '[]'::jsonb,
  fatigued JSONB DEFAULT '[]'::jsonb,
  recommendations JSONB DEFAULT '[]'::jsonb,
  new_concepts JSONB DEFAULT '[]'::jsonb,
  totals JSONB DEFAULT '{}'::jsonb,
  pdf_url TEXT,
  doc_url TEXT,
  notion_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, week_start)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_weekly_briefs TO authenticated, anon;
GRANT ALL ON public.meta_weekly_briefs TO service_role;
ALTER TABLE public.meta_weekly_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_weekly_briefs" ON public.meta_weekly_briefs FOR SELECT USING (true);
CREATE POLICY "Public write meta_weekly_briefs" ON public.meta_weekly_briefs FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_meta_weekly_briefs_updated BEFORE UPDATE ON public.meta_weekly_briefs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Automation rules
CREATE TABLE public.meta_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  platform TEXT NOT NULL DEFAULT 'meta',
  scope_level TEXT NOT NULL, -- 'account'|'campaign'|'adset'|'ad'
  scope_ids JSONB DEFAULT '[]'::jsonb,
  schedule TEXT NOT NULL DEFAULT 'every_30_min', -- cron-like or label
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  action TEXT NOT NULL, -- 'pause'|'scale_up'|'scale_down'|'notify'|'duplicate'
  action_config JSONB DEFAULT '{}'::jsonb,
  notify_channels JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_rules TO authenticated, anon;
GRANT ALL ON public.meta_rules TO service_role;
ALTER TABLE public.meta_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_rules" ON public.meta_rules FOR SELECT USING (true);
CREATE POLICY "Public write meta_rules" ON public.meta_rules FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_meta_rules_updated BEFORE UPDATE ON public.meta_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Rule run history
CREATE TABLE public.meta_rule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.meta_rules(id) ON DELETE CASCADE,
  client_id UUID,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_entities JSONB DEFAULT '[]'::jsonb,
  actions_taken JSONB DEFAULT '[]'::jsonb,
  before_metrics JSONB DEFAULT '{}'::jsonb,
  after_metrics JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_rule_runs TO authenticated, anon;
GRANT ALL ON public.meta_rule_runs TO service_role;
ALTER TABLE public.meta_rule_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_rule_runs" ON public.meta_rule_runs FOR SELECT USING (true);
CREATE POLICY "Service write meta_rule_runs" ON public.meta_rule_runs FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_meta_rule_runs_rule ON public.meta_rule_runs(rule_id, ran_at DESC);

-- 10. Alerts
CREATE TABLE public.meta_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, -- 'cpl_spike'|'roas_drop'|'fatigue'|'rejection'|'leadform_disconnect'|'pixel_issue'
  severity TEXT NOT NULL DEFAULT 'info', -- 'info'|'warning'|'critical'
  title TEXT NOT NULL,
  message TEXT,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  dispatched_channels JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_alerts TO authenticated, anon;
GRANT ALL ON public.meta_alerts TO service_role;
ALTER TABLE public.meta_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_alerts" ON public.meta_alerts FOR SELECT USING (true);
CREATE POLICY "Public write meta_alerts" ON public.meta_alerts FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_meta_alerts_client_created ON public.meta_alerts(client_id, created_at DESC);

-- 11. Swipe files (competitor ads / saved inspiration)
CREATE TABLE public.meta_swipe_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'meta_ad_library',
  source_url TEXT,
  brand_name TEXT,
  ad_copy TEXT,
  headline TEXT,
  cta TEXT,
  media_url TEXT,
  media_type TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  saved_by UUID,
  raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_swipe_files TO authenticated, anon;
GRANT ALL ON public.meta_swipe_files TO service_role;
ALTER TABLE public.meta_swipe_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_swipe_files" ON public.meta_swipe_files FOR SELECT USING (true);
CREATE POLICY "Public write meta_swipe_files" ON public.meta_swipe_files FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_meta_swipe_files_updated BEFORE UPDATE ON public.meta_swipe_files FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 12. Creative comments + approvals
CREATE TABLE public.meta_creative_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  meta_ad_id TEXT,
  swipe_file_id UUID REFERENCES public.meta_swipe_files(id) ON DELETE CASCADE,
  author_id UUID,
  author_name TEXT,
  body TEXT NOT NULL,
  approval_state TEXT, -- null | 'requested' | 'approved' | 'rejected'
  parent_id UUID REFERENCES public.meta_creative_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_creative_comments TO authenticated, anon;
GRANT ALL ON public.meta_creative_comments TO service_role;
ALTER TABLE public.meta_creative_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read meta_creative_comments" ON public.meta_creative_comments FOR SELECT USING (true);
CREATE POLICY "Public write meta_creative_comments" ON public.meta_creative_comments FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_meta_creative_comments_ad ON public.meta_creative_comments(meta_ad_id);
CREATE TRIGGER trg_meta_creative_comments_updated BEFORE UPDATE ON public.meta_creative_comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
