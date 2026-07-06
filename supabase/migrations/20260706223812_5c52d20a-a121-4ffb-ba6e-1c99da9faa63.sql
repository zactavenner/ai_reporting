
CREATE TABLE public.media_buyer_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  run_type text NOT NULL CHECK (run_type IN ('account_audit','daily_review','weekly_review','creative_intel','fatigue_scan','pixel_audit','launch_plan')),
  status text NOT NULL CHECK (status IN ('running','complete','failed')) DEFAULT 'running',
  findings_md text,
  structured_findings jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposals_created integer NOT NULL DEFAULT 0,
  cost_usd numeric,
  error_message text,
  finished_at timestamptz
);
CREATE INDEX idx_mbr_client_created ON public.media_buyer_runs (client_id, created_at DESC);
CREATE INDEX idx_mbr_type_created ON public.media_buyer_runs (run_type, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_buyer_runs TO authenticated;
GRANT ALL ON public.media_buyer_runs TO service_role;
ALTER TABLE public.media_buyer_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage media_buyer_runs" ON public.media_buyer_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);


CREATE TABLE public.ad_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid NOT NULL REFERENCES public.media_buyer_runs(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  meta_ad_id text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('scale','keep','watch','iterate','pause','insufficient_data')),
  reasoning text,
  metrics_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (run_id, meta_ad_id)
);
CREATE INDEX idx_adcls_client_created ON public.ad_classifications (client_id, created_at DESC);
CREATE INDEX idx_adcls_classification ON public.ad_classifications (classification, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_classifications TO authenticated;
GRANT ALL ON public.ad_classifications TO service_role;
ALTER TABLE public.ad_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage ad_classifications" ON public.ad_classifications FOR ALL TO authenticated USING (true) WITH CHECK (true);


CREATE TABLE public.creative_intel_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid NOT NULL REFERENCES public.media_buyer_runs(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('client','portfolio')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  pattern_type text NOT NULL CHECK (pattern_type IN ('hook','headline','format','offer_presentation','visual','cta','spokesperson')),
  pattern_description text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text NOT NULL,
  confidence numeric
);
CREATE INDEX idx_cif_scope_created ON public.creative_intel_findings (scope, created_at DESC);
CREATE INDEX idx_cif_pattern ON public.creative_intel_findings (pattern_type, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_intel_findings TO authenticated;
GRANT ALL ON public.creative_intel_findings TO service_role;
ALTER TABLE public.creative_intel_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage creative_intel_findings" ON public.creative_intel_findings FOR ALL TO authenticated USING (true) WITH CHECK (true);
