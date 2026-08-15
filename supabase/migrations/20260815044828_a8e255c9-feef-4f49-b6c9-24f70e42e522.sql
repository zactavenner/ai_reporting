CREATE TABLE IF NOT EXISTS public.jeremy_review_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','skipped')),
  source text NOT NULL DEFAULT 'cron',
  result_summary jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jeremy_review_runs_idempotency UNIQUE (client_id, run_date)
);

GRANT SELECT ON public.jeremy_review_runs TO anon, authenticated;
GRANT ALL ON public.jeremy_review_runs TO service_role;

ALTER TABLE public.jeremy_review_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jeremy_review_runs_read" ON public.jeremy_review_runs;
CREATE POLICY "jeremy_review_runs_read" ON public.jeremy_review_runs
  FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS jeremy_review_runs_client_created_idx
  ON public.jeremy_review_runs (client_id, created_at DESC);

ALTER TABLE public.agency_agents ADD COLUMN IF NOT EXISTS mcp_enabled boolean NOT NULL DEFAULT false;
UPDATE public.agency_agents SET mcp_enabled = true WHERE slug = 'media_buyer_jeremy';