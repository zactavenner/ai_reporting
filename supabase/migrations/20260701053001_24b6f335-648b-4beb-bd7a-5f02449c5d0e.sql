ALTER TABLE public.agency_agents
  ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS schedule_cron text,
  ADD COLUMN IF NOT EXISTS schedule_prompt text,
  ADD COLUMN IF NOT EXISTS schedule_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_agency_agents_archived ON public.agency_agents(archived_at) WHERE archived_at IS NULL;