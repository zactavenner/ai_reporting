
-- Wave B hardening

-- 5: Shadow mode flags
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;
ALTER TABLE public.client_agents ADD COLUMN IF NOT EXISTS shadow_mode boolean NOT NULL DEFAULT false;

-- 6: Per-agent monthly budget cap (null = unlimited)
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS budget_usd_monthly numeric;

-- 7: Heartbeat + stale reaper for agent_tasks
ALTER TABLE public.agent_tasks ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

CREATE OR REPLACE FUNCTION public.reap_stale_agent_tasks(p_minutes integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  reaped integer;
BEGIN
  WITH r AS (
    UPDATE public.agent_tasks
       SET status = 'pending',
           claimed_by = NULL,
           claimed_at = NULL,
           heartbeat_at = NULL,
           result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('reaped_at', now(), 'reason', 'stale_claim')
     WHERE status = 'in_progress'
       AND COALESCE(heartbeat_at, claimed_at, started_at) < now() - (p_minutes::text || ' minutes')::interval
    RETURNING id
  )
  SELECT count(*) INTO reaped FROM r;
  RETURN reaped;
END;
$$;

-- Per-agent month-to-date cost helper
CREATE OR REPLACE FUNCTION public.agent_cost_mtd(p_agent_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(cost_usd), 0)::numeric
    FROM public.agent_runs
   WHERE agent_id = p_agent_id
     AND started_at >= date_trunc('month', now());
$$;
