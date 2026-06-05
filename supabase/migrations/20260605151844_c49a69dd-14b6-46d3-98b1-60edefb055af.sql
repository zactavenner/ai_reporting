
-- 1. Add columns to lead_enrichment
ALTER TABLE public.lead_enrichment
  ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS enrichment_version integer DEFAULT 2,
  ADD COLUMN IF NOT EXISTS confidence_score numeric,
  ADD COLUMN IF NOT EXISTS estimated_income numeric,
  ADD COLUMN IF NOT EXISTS home_equity numeric,
  ADD COLUMN IF NOT EXISTS investor_score integer,
  ADD COLUMN IF NOT EXISTS accredited_probability text,
  ADD COLUMN IF NOT EXISTS business_owner boolean;

-- Backfill last_enriched_at for existing rows
UPDATE public.lead_enrichment
  SET last_enriched_at = enriched_at, enrichment_version = COALESCE(enrichment_version, 1)
  WHERE last_enriched_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lead_enrichment_last_enriched_at ON public.lead_enrichment (last_enriched_at);
CREATE INDEX IF NOT EXISTS idx_lead_enrichment_client_score ON public.lead_enrichment (client_id, investor_score);
CREATE INDEX IF NOT EXISTS idx_lead_enrichment_networth_midpoint ON public.lead_enrichment (net_worth_midpoint);

-- 2. client_settings.ghl_custom_field_map
ALTER TABLE public.client_settings
  ADD COLUMN IF NOT EXISTS ghl_custom_field_map jsonb DEFAULT '{}'::jsonb;

-- 3. lead_enrichment_history
CREATE TABLE IF NOT EXISTS public.lead_enrichment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  lead_id uuid,
  external_id text,
  event_type text NOT NULL,
  changes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leh_client_external ON public.lead_enrichment_history (client_id, external_id, created_at DESC);
GRANT SELECT ON public.lead_enrichment_history TO authenticated;
GRANT ALL ON public.lead_enrichment_history TO service_role;
ALTER TABLE public.lead_enrichment_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leh_read_auth" ON public.lead_enrichment_history FOR SELECT TO authenticated USING (true);

-- 4. enrichment_run_log
CREATE TABLE IF NOT EXISTS public.enrichment_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  run_date date NOT NULL DEFAULT (now()::date),
  processed integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  skipped_recent integer NOT NULL DEFAULT 0,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_erl_client_date ON public.enrichment_run_log (client_id, run_date DESC);
GRANT SELECT ON public.enrichment_run_log TO authenticated;
GRANT ALL ON public.enrichment_run_log TO service_role;
ALTER TABLE public.enrichment_run_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "erl_read_auth" ON public.enrichment_run_log FOR SELECT TO authenticated USING (true);

-- 5. enrichment_alerts
CREATE TABLE IF NOT EXISTS public.enrichment_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ea_active ON public.enrichment_alerts (client_id, type) WHERE resolved_at IS NULL;
GRANT SELECT ON public.enrichment_alerts TO authenticated;
GRANT ALL ON public.enrichment_alerts TO service_role;
ALTER TABLE public.enrichment_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ea_read_auth" ON public.enrichment_alerts FOR SELECT TO authenticated USING (true);

-- 6. enrichment_jobs
CREATE TABLE IF NOT EXISTS public.enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', -- pending | running | paused | completed | failed
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  last_offset integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ej_status ON public.enrichment_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ej_client ON public.enrichment_jobs (client_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.enrichment_jobs TO authenticated;
GRANT ALL ON public.enrichment_jobs TO service_role;
ALTER TABLE public.enrichment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ej_read_auth" ON public.enrichment_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "ej_insert_auth" ON public.enrichment_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ej_update_auth" ON public.enrichment_jobs FOR UPDATE TO authenticated USING (true);

CREATE TRIGGER trg_ej_updated_at BEFORE UPDATE ON public.enrichment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. Views
CREATE OR REPLACE VIEW public.v_client_enrichment_coverage AS
WITH lead_counts AS (
  SELECT client_id,
    COUNT(*) FILTER (WHERE NOT COALESCE(is_spam, false) AND email IS NOT NULL AND email <> '' AND phone IS NOT NULL AND phone <> '') AS total_contacts
  FROM public.leads
  GROUP BY client_id
),
enrich_counts AS (
  SELECT client_id,
    COUNT(*) AS enriched_contacts,
    COUNT(*) FILTER (WHERE last_enriched_at >= now() - interval '24 hours') AS last_24h,
    COUNT(*) FILTER (WHERE last_enriched_at >= now() - interval '7 days') AS last_7d,
    MAX(last_enriched_at) AS last_run_at
  FROM public.lead_enrichment
  GROUP BY client_id
),
run_fail AS (
  SELECT client_id, COALESCE(SUM(failed),0) AS failed_matches
  FROM public.enrichment_run_log
  WHERE run_date >= (now()::date - 30)
  GROUP BY client_id
)
SELECT c.id AS client_id, c.name AS client_name,
  COALESCE(l.total_contacts, 0) AS total_contacts,
  COALESCE(e.enriched_contacts, 0) AS enriched_contacts,
  CASE WHEN COALESCE(l.total_contacts,0) = 0 THEN 0
       ELSE ROUND( (COALESCE(e.enriched_contacts,0)::numeric / l.total_contacts::numeric) * 100, 2)
  END AS coverage_pct,
  COALESCE(rf.failed_matches, 0) AS failed_matches,
  COALESCE(e.last_24h, 0) AS last_24h,
  COALESCE(e.last_7d, 0) AS last_7d,
  e.last_run_at
FROM public.clients c
LEFT JOIN lead_counts l ON l.client_id = c.id
LEFT JOIN enrich_counts e ON e.client_id = c.id
LEFT JOIN run_fail rf ON rf.client_id = c.id
WHERE c.status IN ('active','onboarding','paused');

GRANT SELECT ON public.v_client_enrichment_coverage TO authenticated;

CREATE OR REPLACE VIEW public.v_agency_enrichment_kpis AS
SELECT
  (SELECT COUNT(*) FROM public.clients WHERE status IN ('active','onboarding','paused')) AS total_clients,
  COALESCE(SUM(total_contacts), 0) AS total_contacts,
  COALESCE(SUM(enriched_contacts), 0) AS total_enriched,
  CASE WHEN COALESCE(SUM(total_contacts),0) = 0 THEN 0
       ELSE ROUND( (SUM(enriched_contacts)::numeric / SUM(total_contacts)::numeric) * 100, 2)
  END AS coverage_pct,
  (SELECT COUNT(*) FROM public.lead_enrichment WHERE accredited_probability = 'high') AS accredited_found,
  (SELECT COUNT(*) FROM public.lead_enrichment WHERE COALESCE(net_worth_midpoint,0) >= 1000000) AS millionaires_found,
  COALESCE(SUM(last_24h), 0) AS daily_enrichments,
  MAX(last_run_at) AS last_sync_at,
  COALESCE((SELECT SUM(net_worth_midpoint) FROM public.lead_enrichment WHERE COALESCE(net_worth_midpoint,0) >= 1000000), 0) AS estimated_prospect_value
FROM public.v_client_enrichment_coverage;

GRANT SELECT ON public.v_agency_enrichment_kpis TO authenticated;
