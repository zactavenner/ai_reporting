-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Least privilege: signed-in operators may READ jobs but never UPDATE them.
--    Approval/rejection happens only through the authenticated edge endpoint,
--    which uses the service role after verifying the dashboard session token.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Reporting operators can approve or reject pending jobs" ON public.jeremy_external_jobs;
REVOKE UPDATE ON public.jeremy_external_jobs FROM authenticated;
REVOKE INSERT, DELETE ON public.jeremy_external_jobs FROM authenticated;

-- Rejection is recorded separately from approval so the approval actor is write-once.
ALTER TABLE public.jeremy_external_jobs
  ADD COLUMN IF NOT EXISTS decided_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Payload/price binding is immutable for EVERY caller, including service role.
--    This is what makes an approval mean "this exact target at this exact price".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.jeremy_external_jobs_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.target::text IS DISTINCT FROM OLD.target::text
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.quote::text IS DISTINCT FROM OLD.quote::text
     OR NEW.estimated_cost_usd IS DISTINCT FROM OLD.estimated_cost_usd
     OR NEW.quote_expires_at IS DISTINCT FROM OLD.quote_expires_at
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.launch_id IS DISTINCT FROM OLD.launch_id
     OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id THEN
    RAISE EXCEPTION 'jeremy_external_jobs: the quote binding (client, kind, provider, target, fingerprint, cost, expiry, requester) is immutable after quoting';
  END IF;

  IF NEW.status = 'approved' AND OLD.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'jeremy_external_jobs: a job may only be approved from awaiting_approval (was %)', OLD.status;
  END IF;

  IF OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'jeremy_external_jobs: the approval actor is write-once';
  END IF;

  IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'jeremy_external_jobs: the approval timestamp is write-once';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jeremy_external_jobs_guard_trg ON public.jeremy_external_jobs;
CREATE TRIGGER jeremy_external_jobs_guard_trg
  BEFORE UPDATE ON public.jeremy_external_jobs
  FOR EACH ROW EXECUTE FUNCTION public.jeremy_external_jobs_guard();

-- Quote de-duplication and re-quote lookups run on (client, fingerprint, status).
CREATE INDEX IF NOT EXISTS jeremy_external_jobs_fingerprint_idx
  ON public.jeremy_external_jobs (client_id, request_fingerprint, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Atomic Apify spend accounting (no read-modify-write).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_apify_spend(p_settings_id UUID, p_cents INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INTEGER;
BEGIN
  IF p_cents IS NULL OR p_cents <= 0 THEN
    RAISE EXCEPTION 'increment_apify_spend: p_cents must be a positive integer';
  END IF;
  UPDATE public.apify_settings
     SET current_month_spend_cents = COALESCE(current_month_spend_cents, 0) + p_cents,
         updated_at = now()
   WHERE id = p_settings_id
  RETURNING current_month_spend_cents INTO v_total;
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'increment_apify_spend: apify settings row % not found', p_settings_id;
  END IF;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_apify_spend(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_apify_spend(UUID, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.increment_apify_spend(UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_apify_spend(UUID, INTEGER) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Configurable, versioned generation prices. No row ⇒ no quote ⇒ no spend.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jeremy_model_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('static_image','video')),
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('per_image','per_second')),
  unit_cost_usd NUMERIC NOT NULL CHECK (unit_cost_usd > 0),
  cost_source TEXT NOT NULL,
  cost_version TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS jeremy_model_costs_kind_model_uidx
  ON public.jeremy_model_costs (kind, model);

GRANT SELECT ON public.jeremy_model_costs TO authenticated;
GRANT ALL ON public.jeremy_model_costs TO service_role;

ALTER TABLE public.jeremy_model_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reporting operators can read Jeremy model costs"
  ON public.jeremy_model_costs FOR SELECT TO authenticated
  USING (public.is_reporting_operator());

DROP TRIGGER IF EXISTS update_jeremy_model_costs_updated_at ON public.jeremy_model_costs;
CREATE TRIGGER update_jeremy_model_costs_updated_at
  BEFORE UPDATE ON public.jeremy_model_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Only the models Jeremy's executors actually invoke today.
INSERT INTO public.jeremy_model_costs (kind, model, provider, unit, unit_cost_usd, cost_source, cost_version, notes)
VALUES
  ('static_image', 'openai/gpt-image-2', 'openrouter', 'per_image', 0.04,
   'agency_configured_estimate', '2026-08-24',
   'Invoked through generate-static-ad. Update unit_cost_usd when the provider price changes.'),
  ('static_image', 'google/gemini-3.1-flash-image-preview', 'openrouter', 'per_image', 0.04,
   'agency_configured_estimate', '2026-08-24',
   'Invoked through generate-static-ad.'),
  ('video', 'bytedance/seedance-2.0', 'openrouter', 'per_second', 0.06,
   'agency_configured_estimate', '2026-08-24',
   'Invoked through generate-video-from-image (model alias seedance-pro), 5-15s, 1080p.')
ON CONFLICT (kind, model) DO NOTHING;