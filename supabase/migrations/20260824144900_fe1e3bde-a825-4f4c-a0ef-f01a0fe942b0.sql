-- Platform default privileges re-grant EXECUTE on new public functions to
-- anon/authenticated, so REVOKE ... FROM PUBLIC alone was not sufficient.
-- Claiming a job for execution must be a server-only operation.
REVOKE ALL ON FUNCTION public.claim_jeremy_external_job(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_jeremy_external_job(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.claim_jeremy_external_job(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jeremy_external_job(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.jeremy_external_jobs_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jeremy_external_jobs_guard() FROM anon;
REVOKE ALL ON FUNCTION public.jeremy_external_jobs_guard() FROM authenticated;