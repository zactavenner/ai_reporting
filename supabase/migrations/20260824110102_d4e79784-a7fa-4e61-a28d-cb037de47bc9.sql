-- Jeremy Autonomous Creative & Media Buyer — durable state and policy layer.

CREATE TABLE public.jeremy_autonomy_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ad_account_id text,
  mode text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','approval','autopilot')),
  allowed_actions text[] NOT NULL DEFAULT ARRAY['hold']::text[],
  paid_discovery_enabled boolean NOT NULL DEFAULT false,
  paid_discovery_per_run_cap_usd numeric NOT NULL DEFAULT 0,
  paid_discovery_monthly_cap_usd numeric NOT NULL DEFAULT 0,
  paid_generation_enabled boolean NOT NULL DEFAULT false,
  paid_generation_per_run_cap_usd numeric NOT NULL DEFAULT 0,
  paid_generation_monthly_cap_usd numeric NOT NULL DEFAULT 0,
  min_spend_usd numeric NOT NULL DEFAULT 100,
  min_live_days integer NOT NULL DEFAULT 3,
  min_qualified_leads integer NOT NULL DEFAULT 5,
  min_funded_count integer NOT NULL DEFAULT 1,
  min_attribution_coverage numeric NOT NULL DEFAULT 0.7,
  scale_max_pct integer NOT NULL DEFAULT 20,
  scale_hard_max_pct integer NOT NULL DEFAULT 30,
  cooldown_hours integer NOT NULL DEFAULT 72,
  max_daily_budget_usd numeric NOT NULL DEFAULT 500,
  max_account_daily_budget_delta_usd numeric NOT NULL DEFAULT 250,
  notes text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

CREATE TABLE public.jeremy_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'shadow',
  stage text NOT NULL DEFAULT 'discovery'
    CHECK (stage IN ('discovery','selection','recreation','launch','analysis','action','verification')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','blocked')),
  stage_timestamps jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_state jsonb,
  kpi_snapshot_id uuid,
  triggered_by text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jeremy_cycles_client ON public.jeremy_cycles(client_id, created_at DESC);

CREATE TABLE public.jeremy_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cycle_id uuid REFERENCES public.jeremy_cycles(id) ON DELETE SET NULL,
  contract_version text NOT NULL,
  window_days integer NOT NULL DEFAULT 30,
  primary_outcomes jsonb NOT NULL DEFAULT '{}'::jsonb,
  media_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  creative_diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  reliability jsonb NOT NULL DEFAULT '{}'::jsonb,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jeremy_kpi_snapshots_client ON public.jeremy_kpi_snapshots(client_id, created_at DESC);

CREATE TABLE public.jeremy_creative_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cycle_id uuid REFERENCES public.jeremy_cycles(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN
    ('meta_account','client_library','scraped_ad','client_live_ad','viral_video','apify_social')),
  source_reference text,
  source_url text,
  title text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric NOT NULL DEFAULT 0,
  rank integer,
  recreation_brief jsonb,
  generation_kind text CHECK (generation_kind IN ('static_image','video')),
  generation_status text NOT NULL DEFAULT 'not_prepared'
    CHECK (generation_status IN ('not_prepared','prepared','queued','blocked_paid_disabled','generated','failed')),
  generation_reference text,
  expected_cost_usd numeric,
  actual_cost_usd numeric,
  launch_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jeremy_candidates_cycle ON public.jeremy_creative_candidates(cycle_id, score DESC);
CREATE INDEX idx_jeremy_candidates_client ON public.jeremy_creative_candidates(client_id, created_at DESC);

CREATE TABLE public.jeremy_action_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cycle_id uuid REFERENCES public.jeremy_cycles(id) ON DELETE SET NULL,
  recommendation_id uuid REFERENCES public.meta_ad_recommendations(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('pause','adjust_budget')),
  entity_type text NOT NULL,
  meta_entity_id text NOT NULL,
  before_snapshot jsonb,
  requested_change jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_receipt jsonb,
  after_snapshot jsonb,
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','mismatch','failed','skipped_dry_run')),
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed','executing','succeeded','failed','verification_failed','blocked')),
  error_detail text,
  executed_by text,
  dry_run boolean NOT NULL DEFAULT true,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jeremy_actions_client ON public.jeremy_action_executions(client_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jeremy_autonomy_policies TO authenticated;
GRANT ALL ON public.jeremy_autonomy_policies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jeremy_cycles TO authenticated;
GRANT ALL ON public.jeremy_cycles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jeremy_kpi_snapshots TO authenticated;
GRANT ALL ON public.jeremy_kpi_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jeremy_creative_candidates TO authenticated;
GRANT ALL ON public.jeremy_creative_candidates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jeremy_action_executions TO authenticated;
GRANT ALL ON public.jeremy_action_executions TO service_role;

ALTER TABLE public.jeremy_autonomy_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jeremy_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jeremy_kpi_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jeremy_creative_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jeremy_action_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read policies" ON public.jeremy_autonomy_policies
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert policies" ON public.jeremy_autonomy_policies
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators update policies" ON public.jeremy_autonomy_policies
  FOR UPDATE TO authenticated USING (public.is_reporting_operator()) WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators delete policies" ON public.jeremy_autonomy_policies
  FOR DELETE TO authenticated USING (public.is_reporting_operator());

CREATE POLICY "operators read cycles" ON public.jeremy_cycles
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert cycles" ON public.jeremy_cycles
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators update cycles" ON public.jeremy_cycles
  FOR UPDATE TO authenticated USING (public.is_reporting_operator()) WITH CHECK (public.is_reporting_operator());

CREATE POLICY "operators read kpi snapshots" ON public.jeremy_kpi_snapshots
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert kpi snapshots" ON public.jeremy_kpi_snapshots
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());

CREATE POLICY "operators read candidates" ON public.jeremy_creative_candidates
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert candidates" ON public.jeremy_creative_candidates
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators update candidates" ON public.jeremy_creative_candidates
  FOR UPDATE TO authenticated USING (public.is_reporting_operator()) WITH CHECK (public.is_reporting_operator());

CREATE POLICY "operators read action executions" ON public.jeremy_action_executions
  FOR SELECT TO authenticated USING (public.is_reporting_operator());

CREATE TRIGGER trg_jeremy_policies_updated BEFORE UPDATE ON public.jeremy_autonomy_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_jeremy_cycles_updated BEFORE UPDATE ON public.jeremy_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_jeremy_candidates_updated BEFORE UPDATE ON public.jeremy_creative_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_jeremy_actions_updated BEFORE UPDATE ON public.jeremy_action_executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();