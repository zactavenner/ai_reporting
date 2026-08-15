CREATE TABLE IF NOT EXISTS public.meta_campaign_launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  objective text NOT NULL DEFAULT 'leads' CHECK (objective IN ('leads','traffic')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','publishing','published','failed')),
  stage text NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft','campaign','adset','media','creative','ad','done')),
  daily_budget_cents integer NOT NULL DEFAULT 2000 CHECK (daily_budget_cents >= 100),
  cta text NOT NULL DEFAULT 'LEARN_MORE',
  destination_url text,
  primary_text text NOT NULL DEFAULT '',
  headline text NOT NULL DEFAULT '',
  description text,
  page_id text,
  pixel_id text,
  countries text[] NOT NULL DEFAULT ARRAY['US'],
  age_min integer NOT NULL DEFAULT 18 CHECK (age_min >= 18 AND age_min <= 65),
  age_max integer NOT NULL DEFAULT 65 CHECK (age_max >= 18 AND age_max <= 65),
  special_ad_category text NOT NULL DEFAULT 'NONE',
  creative_id uuid REFERENCES public.creatives(id) ON DELETE SET NULL,
  creative_url text,
  creative_type text CHECK (creative_type IN ('image','video')),
  meta_campaign_id text,
  meta_adset_id text,
  meta_image_hash text,
  meta_video_id text,
  meta_creative_id text,
  meta_ad_id text,
  error_detail jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  created_by text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_campaign_launches_age_order CHECK (age_max >= age_min)
);

CREATE INDEX IF NOT EXISTS meta_campaign_launches_client_idx ON public.meta_campaign_launches(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meta_campaign_launches_status_idx ON public.meta_campaign_launches(status);

GRANT SELECT, INSERT, UPDATE ON public.meta_campaign_launches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.meta_campaign_launches TO anon;
GRANT ALL ON public.meta_campaign_launches TO service_role;
ALTER TABLE public.meta_campaign_launches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "launches_read" ON public.meta_campaign_launches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "launches_draft_insert" ON public.meta_campaign_launches FOR INSERT TO anon, authenticated WITH CHECK (status = 'draft' AND stage = 'draft' AND meta_campaign_id IS NULL AND meta_ad_id IS NULL);
CREATE POLICY "launches_draft_update" ON public.meta_campaign_launches FOR UPDATE TO anon, authenticated USING (status = 'draft') WITH CHECK (status = 'draft' AND meta_campaign_id IS NULL AND meta_ad_id IS NULL);

CREATE TABLE IF NOT EXISTS public.meta_ad_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  run_id uuid,
  entity_type text NOT NULL CHECK (entity_type IN ('campaign','adset','ad')),
  entity_name text NOT NULL,
  meta_entity_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('pause','resume','adjust_budget','hold')),
  reason text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  proposed_daily_budget numeric,
  health_score integer CHECK (health_score >= 0 AND health_score <= 100),
  summary text,
  metrics_snapshot jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applying','applied','rejected','failed','acknowledged')),
  meta_response jsonb,
  error_detail text,
  claimed_at timestamptz,
  applied_at timestamptz,
  decided_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_ad_recs_client_idx ON public.meta_ad_recommendations(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meta_ad_recs_status_idx ON public.meta_ad_recommendations(status);
CREATE INDEX IF NOT EXISTS meta_ad_recs_entity_idx ON public.meta_ad_recommendations(meta_entity_id);

GRANT SELECT, UPDATE ON public.meta_ad_recommendations TO authenticated;
GRANT SELECT, UPDATE ON public.meta_ad_recommendations TO anon;
GRANT ALL ON public.meta_ad_recommendations TO service_role;
ALTER TABLE public.meta_ad_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recs_read" ON public.meta_ad_recommendations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "recs_dismiss_update" ON public.meta_ad_recommendations FOR UPDATE TO anon, authenticated USING (status IN ('pending','failed')) WITH CHECK (status IN ('rejected','acknowledged','pending','failed'));

CREATE TRIGGER meta_campaign_launches_touch BEFORE UPDATE ON public.meta_campaign_launches
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER meta_ad_recommendations_touch BEFORE UPDATE ON public.meta_ad_recommendations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.agency_agents (slug, name, role, icon, default_model, system_prompt, allowed_creative_types, is_active, sort_order, capabilities, connectors)
VALUES (
  'media_buyer_jeremy',
  'Media Buyer (JEREMY)',
  'Reviews live Meta campaigns, ad sets, and ads against CRM funded outcomes and proposes reviewable pause / resume / budget actions. Never writes to Meta without operator approval.',
  'trending-up',
  'openrouter/owl-alpha',
  'You are Media Buyer (JEREMY), a senior paid-media analyst for a capital-raising agency. You review live Meta performance combined with CRM funded outcomes. You NEVER change anything in Meta yourself: you only emit reviewable recommendations that a human operator approves. Judge on funded outcomes and cost per funded first, cost per lead second, CTR/frequency third. Be specific, cite numbers, and never recommend action on an entity with under $100 spend unless the data quality itself is the issue.',
  ARRAY[]::text[],
  false,
  11,
  '{"meta_review": true, "writes_meta": false, "requires_approval": true}'::jsonb,
  '[]'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, capabilities = EXCLUDED.capabilities;