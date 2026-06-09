
-- 1) Enable RLS on sync_queue
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.sync_queue TO anon, authenticated;
GRANT ALL ON public.sync_queue TO service_role;

DROP POLICY IF EXISTS "Public can view sync_queue" ON public.sync_queue;
DROP POLICY IF EXISTS "Service role manages sync_queue" ON public.sync_queue;

CREATE POLICY "Public can view sync_queue"
  ON public.sync_queue FOR SELECT
  USING (true);

CREATE POLICY "Service role manages sync_queue"
  ON public.sync_queue FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2) cron_run_log for visibility into scheduled job failures
CREATE TABLE IF NOT EXISTS public.cron_run_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  status_code integer,
  response_body text,
  error_message text,
  duration_ms integer,
  ran_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cron_run_log_job_name_ran_at_idx
  ON public.cron_run_log (job_name, ran_at DESC);
CREATE INDEX IF NOT EXISTS cron_run_log_status_ran_at_idx
  ON public.cron_run_log (status, ran_at DESC);

GRANT SELECT ON public.cron_run_log TO anon, authenticated;
GRANT ALL ON public.cron_run_log TO service_role;

ALTER TABLE public.cron_run_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view cron_run_log"
  ON public.cron_run_log FOR SELECT
  USING (true);

CREATE POLICY "Service role manages cron_run_log"
  ON public.cron_run_log FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 3) Helper to record a cron run from PL/pgSQL or edge functions
CREATE OR REPLACE FUNCTION public.log_cron_run(
  p_job_name text,
  p_status text,
  p_status_code integer DEFAULT NULL,
  p_response_body text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.cron_run_log (job_name, status, status_code, response_body, error_message, duration_ms)
  VALUES (p_job_name, p_status, p_status_code, p_response_body, p_error_message, p_duration_ms)
  RETURNING id;
$$;
