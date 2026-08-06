-- ============================================================================
-- H3 run manager: replace "any authenticated user" policies with the existing
-- agency-operator authorization boundary (public.reporting_operator_users).
--
-- A valid JWT is NEVER sufficient. The live project has no verified
-- client-to-user membership mapping, so a signed-in user must be explicitly
-- allowlisted. The allowlist stays service-role-only and is not granted here.
-- ============================================================================

-- 1. Operator predicate. SECURITY DEFINER so RLS policies can consult the
--    allowlist without granting authenticated any privilege on that table.
CREATE OR REPLACE FUNCTION public.is_reporting_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.reporting_operator_users o
        WHERE o.user_id = auth.uid()
     );
$$;

REVOKE ALL ON FUNCTION public.is_reporting_operator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_reporting_operator() TO authenticated, service_role;

-- 2. Remove the permissive USING/WITH CHECK true policies.
DROP POLICY IF EXISTS "staff manage h3 runs"             ON public.h3_runs;
DROP POLICY IF EXISTS "staff manage h3 creatives"        ON public.h3_creatives;
DROP POLICY IF EXISTS "staff manage h3 script revisions" ON public.h3_script_revisions;
DROP POLICY IF EXISTS "staff read h3 events"             ON public.h3_creative_events;
DROP POLICY IF EXISTS "staff add h3 events"              ON public.h3_creative_events;

-- 3. Reset table privileges. anon/PUBLIC get nothing at all.
REVOKE ALL ON public.h3_runs             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.h3_creatives        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.h3_script_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.h3_creative_events  FROM PUBLIC, anon, authenticated;

-- Operator-managed working tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.h3_runs      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.h3_creatives TO authenticated;

-- Append-only audit surfaces: read + insert, never update/delete.
GRANT SELECT, INSERT ON public.h3_script_revisions TO authenticated;
GRANT SELECT, INSERT ON public.h3_creative_events  TO authenticated;

-- Server-side poller / cron.
GRANT ALL ON public.h3_runs             TO service_role;
GRANT ALL ON public.h3_creatives        TO service_role;
GRANT ALL ON public.h3_script_revisions TO service_role;
GRANT ALL ON public.h3_creative_events  TO service_role;

-- 4. RLS enabled (idempotent) + operator-only policies.
ALTER TABLE public.h3_runs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.h3_creatives        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.h3_script_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.h3_creative_events  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read h3 runs" ON public.h3_runs
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert h3 runs" ON public.h3_runs
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators update h3 runs" ON public.h3_runs
  FOR UPDATE TO authenticated
  USING (public.is_reporting_operator()) WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators delete h3 runs" ON public.h3_runs
  FOR DELETE TO authenticated USING (public.is_reporting_operator());

CREATE POLICY "operators read h3 creatives" ON public.h3_creatives
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert h3 creatives" ON public.h3_creatives
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators update h3 creatives" ON public.h3_creatives
  FOR UPDATE TO authenticated
  USING (public.is_reporting_operator()) WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators delete h3 creatives" ON public.h3_creatives
  FOR DELETE TO authenticated USING (public.is_reporting_operator());

-- Append-only: no UPDATE/DELETE policy exists, so those are denied outright.
CREATE POLICY "operators read h3 script revisions" ON public.h3_script_revisions
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert h3 script revisions" ON public.h3_script_revisions
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());

CREATE POLICY "operators read h3 events" ON public.h3_creative_events
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert h3 events" ON public.h3_creative_events
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());

COMMENT ON FUNCTION public.is_reporting_operator() IS
  'Agency-operator authorization boundary for H3 tables. True only when the JWT subject is allowlisted in public.reporting_operator_users. Not a tenant scope and not investor/lead authorization.';