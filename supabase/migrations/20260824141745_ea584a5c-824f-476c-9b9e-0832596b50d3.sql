CREATE TABLE public.jeremy_external_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  cycle_id UUID NULL,
  candidate_id UUID NULL,
  launch_id UUID NULL,
  kind TEXT NOT NULL CHECK (kind IN ('apify_discovery','image_generation','video_generation','meta_publish')),
  provider TEXT NOT NULL DEFAULT 'unknown',
  target JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN ('awaiting_approval','approved','rejected','claimed','running','succeeded','failed','verification_failed','expired')),
  quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  estimated_cost_usd NUMERIC NULL,
  actual_cost_usd NUMERIC NULL,
  quote_expires_at TIMESTAMPTZ NULL,
  requested_by TEXT NULL,
  approved_by TEXT NULL,
  approved_at TIMESTAMPTZ NULL,
  claimed_by TEXT NULL,
  claimed_at TIMESTAMPTZ NULL,
  provider_job_id TEXT NULL,
  provider_response JSONB NULL,
  verification JSONB NULL,
  result_summary JSONB NULL,
  error TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX jeremy_external_jobs_idempotency_key_uidx ON public.jeremy_external_jobs (idempotency_key);
CREATE INDEX jeremy_external_jobs_client_kind_idx ON public.jeremy_external_jobs (client_id, kind, created_at DESC);
CREATE INDEX jeremy_external_jobs_cycle_idx ON public.jeremy_external_jobs (cycle_id);
CREATE INDEX jeremy_external_jobs_status_idx ON public.jeremy_external_jobs (status);

GRANT SELECT, UPDATE ON public.jeremy_external_jobs TO authenticated;
GRANT ALL ON public.jeremy_external_jobs TO service_role;

ALTER TABLE public.jeremy_external_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reporting operators can read Jeremy external jobs"
  ON public.jeremy_external_jobs FOR SELECT TO authenticated
  USING (public.is_reporting_operator());

CREATE POLICY "Reporting operators can approve or reject pending jobs"
  ON public.jeremy_external_jobs FOR UPDATE TO authenticated
  USING (public.is_reporting_operator() AND status IN ('awaiting_approval','approved'))
  WITH CHECK (public.is_reporting_operator() AND status IN ('approved','rejected'));

CREATE TRIGGER update_jeremy_external_jobs_updated_at
  BEFORE UPDATE ON public.jeremy_external_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.claim_jeremy_external_job(p_job_id UUID, p_claimed_by TEXT)
RETURNS public.jeremy_external_jobs
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.jeremy_external_jobs
     SET status = 'claimed', claimed_by = p_claimed_by, claimed_at = now(), started_at = now()
   WHERE id = p_job_id AND status = 'approved'
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.claim_jeremy_external_job(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_jeremy_external_job(UUID, TEXT) TO service_role;