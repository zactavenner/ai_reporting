
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS meta_system_user_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_token_type TEXT
    CHECK (meta_token_type IN ('system_user','long_lived','master','user'))
    DEFAULT 'long_lived';

COMMENT ON COLUMN public.clients.meta_system_user_token IS
  'Business Manager System User token. Non-expiring. Preferred over meta_access_token when present.';

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_pending
  ON public.agent_tasks (status, priority, created_at)
  WHERE status IN ('pending','queued');

CREATE INDEX IF NOT EXISTS idx_agent_tasks_assigned
  ON public.agent_tasks (assigned_to_agent, status);

CREATE OR REPLACE VIEW public.v_agent_dispatch_recent AS
SELECT id, job_name, status, status_code, duration_ms, error_message, ran_at
FROM public.cron_run_log
WHERE job_name LIKE 'dispatch-scheduled-agents%'
   OR job_name LIKE 'jarvis-dispatch%'
   OR job_name LIKE 'run-agent:%'
ORDER BY ran_at DESC
LIMIT 200;

GRANT SELECT ON public.v_agent_dispatch_recent TO authenticated, service_role;
