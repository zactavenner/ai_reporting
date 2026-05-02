
-- 1. Extend sync_queue
ALTER TABLE public.sync_queue
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_letter boolean NOT NULL DEFAULT false;

-- Drop & recreate constraints to allow new values
ALTER TABLE public.sync_queue DROP CONSTRAINT IF EXISTS sync_queue_status_check;
ALTER TABLE public.sync_queue ADD CONSTRAINT sync_queue_status_check
  CHECK (status = ANY (ARRAY['pending','processing','completed','failed','retrying','dead_letter']));

ALTER TABLE public.sync_queue DROP CONSTRAINT IF EXISTS sync_queue_sync_type_check;
ALTER TABLE public.sync_queue ADD CONSTRAINT sync_queue_sync_type_check
  CHECK (sync_type = ANY (ARRAY['contacts','appointments','timeline','full','lead_upsert','call_upsert','opportunity_upsert','backfill']));

-- Idempotency: same key = same job (no duplicate enqueues)
CREATE UNIQUE INDEX IF NOT EXISTS sync_queue_idempotency_key_unique
  ON public.sync_queue (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_queue_ready
  ON public.sync_queue (priority, next_retry_at NULLS FIRST, created_at)
  WHERE status IN ('pending','retrying') AND dead_letter = false;

CREATE INDEX IF NOT EXISTS idx_sync_queue_processing_started
  ON public.sync_queue (started_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_sync_queue_client_status_created
  ON public.sync_queue (client_id, status, created_at DESC);

-- 2. lead_change_log
CREATE TABLE IF NOT EXISTS public.lead_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  external_id text,
  source text NOT NULL,           -- webhook | cursor_sync | master_sync | manual | reconciliation
  provider text,                  -- ghl | meta | manual
  action text NOT NULL,           -- insert | update | no_op
  changed_fields jsonb DEFAULT '{}'::jsonb,
  job_id uuid REFERENCES public.sync_queue(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_change_log_lead ON public.lead_change_log (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_change_log_client_created ON public.lead_change_log (client_id, created_at DESC);

ALTER TABLE public.lead_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view lead change log"
  ON public.lead_change_log FOR SELECT
  TO authenticated
  USING (true);

-- 3. webhook_events (dedup inbound webhooks)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,                       -- ghl | meta | fathom | etc.
  provider_event_id text NOT NULL,              -- the upstream event id / hash
  event_type text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  raw_payload jsonb,
  processed_at timestamptz,
  enqueued_job_id uuid REFERENCES public.sync_queue(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_eventid_unique
  ON public.webhook_events (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_client_created
  ON public.webhook_events (client_id, created_at DESC);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view webhook events"
  ON public.webhook_events FOR SELECT
  TO authenticated
  USING (true);

-- 4. sync_health_snapshots (rollups for the dashboard)
CREATE TABLE IF NOT EXISTS public.sync_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  queue_pending integer NOT NULL DEFAULT 0,
  queue_processing integer NOT NULL DEFAULT 0,
  queue_failed integer NOT NULL DEFAULT 0,
  queue_dead_letter integer NOT NULL DEFAULT 0,
  success_rate_24h numeric,
  last_webhook_at timestamptz,
  last_cursor_sync_at timestamptz,
  last_master_sync_at timestamptz,
  source_lead_count integer,
  db_lead_count integer,
  delta_pct numeric,
  details jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sync_health_client_snapshot
  ON public.sync_health_snapshots (client_id, snapshot_at DESC);

ALTER TABLE public.sync_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view sync health"
  ON public.sync_health_snapshots FOR SELECT
  TO authenticated
  USING (true);
