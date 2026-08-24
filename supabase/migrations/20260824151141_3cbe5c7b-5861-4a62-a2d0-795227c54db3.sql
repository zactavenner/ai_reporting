CREATE UNIQUE INDEX IF NOT EXISTS jeremy_external_jobs_active_fingerprint_uidx
  ON public.jeremy_external_jobs (client_id, request_fingerprint)
  WHERE status IN ('awaiting_approval','approved','claimed','running','succeeded');