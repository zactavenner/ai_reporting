
-- 1) ghl_workflows cache
CREATE TABLE public.ghl_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  name text NOT NULL,
  name_normalized text GENERATED ALWAYS AS (regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')) STORED,
  status text,
  version integer,
  ghl_created_at timestamptz,
  ghl_updated_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, workflow_id)
);
CREATE INDEX idx_ghl_workflows_client ON public.ghl_workflows(client_id);
CREATE INDEX idx_ghl_workflows_status ON public.ghl_workflows(status);
CREATE INDEX idx_ghl_workflows_dup ON public.ghl_workflows(client_id, name_normalized);

GRANT SELECT ON public.ghl_workflows TO authenticated;
GRANT ALL ON public.ghl_workflows TO service_role;
ALTER TABLE public.ghl_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read ghl_workflows" ON public.ghl_workflows FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_ghl_workflows_updated_at
  BEFORE UPDATE ON public.ghl_workflows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) ghl_workflow_history
CREATE TABLE public.ghl_workflow_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ghl_wf_hist_lookup ON public.ghl_workflow_history(client_id, workflow_id, changed_at DESC);

GRANT SELECT ON public.ghl_workflow_history TO authenticated;
GRANT ALL ON public.ghl_workflow_history TO service_role;
ALTER TABLE public.ghl_workflow_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read ghl_workflow_history" ON public.ghl_workflow_history FOR SELECT TO authenticated USING (true);

-- 3) ghl_workflow_sync_runs
CREATE TABLE public.ghl_workflow_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL,
  workflow_count integer,
  error_message text,
  http_status integer
);
CREATE INDEX idx_ghl_wf_runs_client_started ON public.ghl_workflow_sync_runs(client_id, started_at DESC);

GRANT SELECT ON public.ghl_workflow_sync_runs TO authenticated;
GRANT ALL ON public.ghl_workflow_sync_runs TO service_role;
ALTER TABLE public.ghl_workflow_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read ghl_workflow_sync_runs" ON public.ghl_workflow_sync_runs FOR SELECT TO authenticated USING (true);

-- 4) linked workflow reference on canvas steps
ALTER TABLE public.client_funnel_steps
  ADD COLUMN IF NOT EXISTS linked_ghl_workflow_id text;
