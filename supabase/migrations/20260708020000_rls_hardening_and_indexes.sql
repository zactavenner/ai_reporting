-- =============================================================================
-- RLS HARDENING, INTEGRITY FIXES, AND HOT-PATH INDEXES
-- Timestamp: 20260708020000
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. PREREQUISITES
-- ---------------------------------------------------------------------------
-- Create client_users table if it doesn't exist (no prior mapping table found).
-- This is the authoritative user→client membership table used by all RLS policies.
CREATE TABLE IF NOT EXISTS public.client_users (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id)
);
ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_users TO authenticated;
GRANT ALL ON public.client_users TO service_role;
-- Users can see their own memberships
DROP POLICY IF EXISTS "client_users_self_select" ON public.client_users;
CREATE POLICY "client_users_self_select" ON public.client_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Reusable inline accessor (no stored function dependency)
-- All RLS policies below use the EXISTS pattern directly.

-- =============================================================================
-- 1. LEADS
-- =============================================================================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to leads"    ON public.leads;
DROP POLICY IF EXISTS "Public can view leads"                ON public.leads;
DROP POLICY IF EXISTS "leads_select_authenticated"           ON public.leads;
DROP POLICY IF EXISTS "leads_all_authenticated"              ON public.leads;

CREATE POLICY "leads_select" ON public.leads
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = leads.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "leads_insert" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = leads.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "leads_update" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = leads.client_id
        AND cu.user_id   = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = leads.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "leads_delete" ON public.leads
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = leads.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

-- =============================================================================
-- 2. CALLS
-- (No call_date or contact_id column confirmed in migrations — those indexes skipped)
-- =============================================================================
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to calls" ON public.calls;
DROP POLICY IF EXISTS "Public can view calls"             ON public.calls;
DROP POLICY IF EXISTS "calls_select_authenticated"        ON public.calls;
DROP POLICY IF EXISTS "calls_all_authenticated"           ON public.calls;

CREATE POLICY "calls_select" ON public.calls
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = calls.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "calls_insert" ON public.calls
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = calls.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "calls_update" ON public.calls
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = calls.client_id
        AND cu.user_id   = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = calls.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "calls_delete" ON public.calls
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = calls.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;

-- =============================================================================
-- 3. FUNDED_INVESTORS
-- =============================================================================
ALTER TABLE public.funded_investors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to funded_investors" ON public.funded_investors;
DROP POLICY IF EXISTS "Public can view funded_investors"             ON public.funded_investors;
DROP POLICY IF EXISTS "funded_investors_select_authenticated"        ON public.funded_investors;
DROP POLICY IF EXISTS "funded_investors_all_authenticated"           ON public.funded_investors;

CREATE POLICY "funded_investors_select" ON public.funded_investors
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = funded_investors.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "funded_investors_insert" ON public.funded_investors
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = funded_investors.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "funded_investors_update" ON public.funded_investors
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = funded_investors.client_id
        AND cu.user_id   = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = funded_investors.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "funded_investors_delete" ON public.funded_investors
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = funded_investors.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.funded_investors TO authenticated;
GRANT ALL ON public.funded_investors TO service_role;

-- =============================================================================
-- 4. PIPELINE_OPPORTUNITIES
-- No client_id column confirmed — adding it and backfilling via client_pipelines.
-- =============================================================================
ALTER TABLE public.pipeline_opportunities
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE;

-- Backfill client_id from client_pipelines
UPDATE public.pipeline_opportunities po
SET client_id = cp.client_id
FROM public.client_pipelines cp
WHERE cp.id = po.pipeline_id
  AND po.client_id IS NULL;

ALTER TABLE public.pipeline_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view pipeline_opportunities"  ON public.pipeline_opportunities;
DROP POLICY IF EXISTS "pipeline_opportunities_all_authenticated" ON public.pipeline_opportunities;
DROP POLICY IF EXISTS "po_select_authenticated"                  ON public.pipeline_opportunities;

CREATE POLICY "pipeline_opportunities_select" ON public.pipeline_opportunities
  FOR SELECT TO authenticated
  USING (
    client_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = pipeline_opportunities.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "pipeline_opportunities_insert" ON public.pipeline_opportunities
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = pipeline_opportunities.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "pipeline_opportunities_update" ON public.pipeline_opportunities
  FOR UPDATE TO authenticated
  USING (
    client_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = pipeline_opportunities.client_id
        AND cu.user_id   = auth.uid()
    )
  )
  WITH CHECK (
    client_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = pipeline_opportunities.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "pipeline_opportunities_delete" ON public.pipeline_opportunities
  FOR DELETE TO authenticated
  USING (
    client_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = pipeline_opportunities.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_opportunities TO authenticated;
GRANT ALL ON public.pipeline_opportunities TO service_role;

-- =============================================================================
-- 5. API_USAGE
-- =============================================================================
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all" ON public.api_usage;
DROP POLICY IF EXISTS "api_usage_all_authenticated" ON public.api_usage;

CREATE POLICY "api_usage_select" ON public.api_usage
  FOR SELECT TO authenticated
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = api_usage.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "api_usage_insert" ON public.api_usage
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = api_usage.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "api_usage_update" ON public.api_usage
  FOR UPDATE TO authenticated
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = api_usage.client_id
        AND cu.user_id   = auth.uid()
    )
  )
  WITH CHECK (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = api_usage.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "api_usage_delete" ON public.api_usage
  FOR DELETE TO authenticated
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = api_usage.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_usage TO authenticated;
GRANT ALL ON public.api_usage TO service_role;

-- =============================================================================
-- 6. SYNC_ERRORS
-- =============================================================================
ALTER TABLE public.sync_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view sync_errors"   ON public.sync_errors;
DROP POLICY IF EXISTS "Public can insert sync_errors" ON public.sync_errors;
DROP POLICY IF EXISTS "Public can delete sync_errors" ON public.sync_errors;
DROP POLICY IF EXISTS "sync_errors_all_authenticated" ON public.sync_errors;

CREATE POLICY "sync_errors_select" ON public.sync_errors
  FOR SELECT TO authenticated
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = sync_errors.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "sync_errors_insert" ON public.sync_errors
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = sync_errors.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "sync_errors_delete" ON public.sync_errors
  FOR DELETE TO authenticated
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = sync_errors.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_errors TO authenticated;
GRANT ALL ON public.sync_errors TO service_role;

-- =============================================================================
-- 7. SYNC_RUNS
-- =============================================================================
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read sync_runs"           ON public.sync_runs;
DROP POLICY IF EXISTS "Service insert/update sync_runs" ON public.sync_runs;
DROP POLICY IF EXISTS "sync_runs_all_authenticated"     ON public.sync_runs;

CREATE POLICY "sync_runs_select" ON public.sync_runs
  FOR SELECT TO authenticated
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = sync_runs.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "sync_runs_insert" ON public.sync_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = sync_runs.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "sync_runs_update" ON public.sync_runs
  FOR UPDATE TO authenticated
  USING (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = sync_runs.client_id
        AND cu.user_id   = auth.uid()
    )
  )
  WITH CHECK (
    client_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = sync_runs.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_runs TO authenticated;
GRANT ALL ON public.sync_runs TO service_role;

-- =============================================================================
-- 8. LEAD_ENRICHMENT_HISTORY
-- =============================================================================
ALTER TABLE public.lead_enrichment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leh_read_auth"                          ON public.lead_enrichment_history;
DROP POLICY IF EXISTS "lead_enrichment_history_all_authenticated" ON public.lead_enrichment_history;

CREATE POLICY "leh_select" ON public.lead_enrichment_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = lead_enrichment_history.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "leh_insert" ON public.lead_enrichment_history
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = lead_enrichment_history.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "leh_delete" ON public.lead_enrichment_history
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = lead_enrichment_history.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_enrichment_history TO authenticated;
GRANT ALL ON public.lead_enrichment_history TO service_role;

-- =============================================================================
-- 9. META_AD_DAILY_INSIGHTS — RLS + INTEGRITY
-- =============================================================================
ALTER TABLE public.meta_ad_daily_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can manage meta_ad_daily_insights" ON public.meta_ad_daily_insights;
DROP POLICY IF EXISTS "meta_ad_daily_insights_all_authenticated"        ON public.meta_ad_daily_insights;

CREATE POLICY "meta_ad_daily_insights_select" ON public.meta_ad_daily_insights
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = meta_ad_daily_insights.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "meta_ad_daily_insights_insert" ON public.meta_ad_daily_insights
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = meta_ad_daily_insights.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "meta_ad_daily_insights_update" ON public.meta_ad_daily_insights
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = meta_ad_daily_insights.client_id
        AND cu.user_id   = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = meta_ad_daily_insights.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "meta_ad_daily_insights_delete" ON public.meta_ad_daily_insights
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = meta_ad_daily_insights.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_ad_daily_insights TO authenticated;
GRANT ALL ON public.meta_ad_daily_insights TO service_role;

-- Integrity: set client_id NOT NULL (only after confirming all rows have a value)
-- Delete any orphan rows that could not be backfilled before enforcing NOT NULL
DELETE FROM public.meta_ad_daily_insights WHERE client_id IS NULL;
ALTER TABLE public.meta_ad_daily_insights ALTER COLUMN client_id SET NOT NULL;

-- Replace old unique constraint (date, meta_ad_id) → (client_id, date, meta_ad_id)
ALTER TABLE public.meta_ad_daily_insights
  DROP CONSTRAINT IF EXISTS meta_ad_daily_insights_unique;

DROP INDEX IF EXISTS public.meta_ad_daily_insights_unique;

CREATE UNIQUE INDEX IF NOT EXISTS meta_ad_daily_insights_client_date_ad_unique
  ON public.meta_ad_daily_insights (client_id, date, meta_ad_id);

-- (client_id, date DESC) index already exists as meta_ad_daily_insights_client_date_idx
-- Re-create as IF NOT EXISTS to be safe
CREATE INDEX IF NOT EXISTS meta_ad_daily_insights_client_date_desc_idx
  ON public.meta_ad_daily_insights (client_id, date DESC);

-- =============================================================================
-- 10. DAILY_METRICS
-- =============================================================================
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view daily_metrics"    ON public.daily_metrics;
DROP POLICY IF EXISTS "Public can insert daily_metrics"  ON public.daily_metrics;
DROP POLICY IF EXISTS "Public can update daily_metrics"  ON public.daily_metrics;
DROP POLICY IF EXISTS "Service role full access to daily_metrics" ON public.daily_metrics;
DROP POLICY IF EXISTS "daily_metrics_all_authenticated"  ON public.daily_metrics;

CREATE POLICY "daily_metrics_select" ON public.daily_metrics
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = daily_metrics.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "daily_metrics_insert" ON public.daily_metrics
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = daily_metrics.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "daily_metrics_update" ON public.daily_metrics
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = daily_metrics.client_id
        AND cu.user_id   = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = daily_metrics.client_id
        AND cu.user_id   = auth.uid()
    )
  );

CREATE POLICY "daily_metrics_delete" ON public.daily_metrics
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_users cu
      WHERE cu.client_id = daily_metrics.client_id
        AND cu.user_id   = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_metrics TO authenticated;
GRANT ALL ON public.daily_metrics TO service_role;

-- =============================================================================
-- 11. HOT-PATH COMPOSITE INDEXES
-- =============================================================================

-- calls: no call_date or contact_id column confirmed in migrations — skipped.
-- Adding (client_id, created_at DESC) as general-purpose substitute.
CREATE INDEX IF NOT EXISTS idx_calls_client_created_at
  ON public.calls (client_id, created_at DESC);

-- sync_errors
CREATE INDEX IF NOT EXISTS idx_sync_errors_client_created_at
  ON public.sync_errors (client_id, created_at DESC);

-- sync_runs
CREATE INDEX IF NOT EXISTS idx_sync_runs_client_started_at
  ON public.sync_runs (client_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_status_started_at
  ON public.sync_runs (status, started_at DESC)
  WHERE status IN ('running', 'queued');

-- lead_enrichment_history: no enriched_at column — using created_at
CREATE INDEX IF NOT EXISTS idx_leh_client_lead_created_at
  ON public.lead_enrichment_history (client_id, lead_id, created_at DESC);

-- leads
CREATE INDEX IF NOT EXISTS idx_leads_client_created_at
  ON public.leads (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_client_utm_campaign
  ON public.leads (client_id, utm_campaign)
  WHERE utm_campaign IS NOT NULL;

-- pipeline_opportunities (client_id column just added above)
CREATE INDEX IF NOT EXISTS idx_pipeline_opportunities_client_updated_at
  ON public.pipeline_opportunities (client_id, updated_at DESC);

