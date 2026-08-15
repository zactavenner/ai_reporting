-- Agency Reporting 5.0 hardening: fresh-run boundary, durable chunk claims,
-- and semantically correct commitment/funded timestamps.

ALTER TABLE public.agency_daily_report_runs
  ADD COLUMN IF NOT EXISTS collection_started_at timestamptz;

ALTER TABLE public.agency_report_send_chunks
  DROP CONSTRAINT IF EXISTS agency_report_send_chunks_status_check;
ALTER TABLE public.agency_report_send_chunks
  ADD CONSTRAINT agency_report_send_chunks_status_check
  CHECK (status IN ('pending','sending','sent','failed'));
ALTER TABLE public.agency_report_send_chunks
  ADD COLUMN IF NOT EXISTS message_text text,
  ADD COLUMN IF NOT EXISTS message_hash text,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- A commitment is not a funding event. Preserve and repair the historical
-- pipeline-stage records created by the prior sync path.
UPDATE public.funded_investors
SET committed_at = funded_at
WHERE committed_at IS NULL
  AND source = 'commitment_stage'
  AND coalesce(commitment_amount, 0) > 0;

UPDATE public.funded_investors
SET is_verified_funded = true,
    verification_source = coalesce(verification_source, 'configured_pipeline_stage')
WHERE source = 'pipeline_stage'
  AND coalesce(funded_amount, 0) > 0;

ALTER TABLE public.funded_investors ALTER COLUMN funded_at DROP NOT NULL;

UPDATE public.funded_investors
SET funded_at = NULL
WHERE source = 'commitment_stage'
  AND is_verified_funded = false;
