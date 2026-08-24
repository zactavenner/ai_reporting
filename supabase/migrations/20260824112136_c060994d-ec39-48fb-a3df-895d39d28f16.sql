-- Immutable, reproducible decision records for Jeremy action execution.
CREATE TABLE public.jeremy_action_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cycle_id uuid REFERENCES public.jeremy_cycles(id) ON DELETE SET NULL,
  kpi_snapshot_id uuid REFERENCES public.jeremy_kpi_snapshots(id) ON DELETE SET NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('campaign','adset','ad')),
  meta_entity_id text NOT NULL,
  entity_name text,
  action text NOT NULL CHECK (action IN ('hold','pause','adjust_budget')),
  -- Binding fingerprint: client + entity + action + payload. Execution refuses
  -- any request whose recomputed fingerprint differs from this value.
  payload_fingerprint text NOT NULL,
  current_daily_budget numeric,
  proposed_daily_budget numeric,
  basis text NOT NULL DEFAULT 'primary_outcome',
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  executable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','claimed','executed','failed','expired','superseded')),
  approved_by text,
  approved_at timestamptz,
  claimed_at timestamptz,
  executed_at timestamptz,
  execution_id uuid REFERENCES public.jeremy_action_executions(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jeremy_plans_client ON public.jeremy_action_plans(client_id, created_at DESC);
CREATE INDEX idx_jeremy_plans_status ON public.jeremy_action_plans(status, expires_at);
CREATE INDEX idx_jeremy_plans_cycle ON public.jeremy_action_plans(cycle_id);

GRANT SELECT, INSERT, UPDATE ON public.jeremy_action_plans TO authenticated;
GRANT ALL ON public.jeremy_action_plans TO service_role;

ALTER TABLE public.jeremy_action_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators read action plans" ON public.jeremy_action_plans
  FOR SELECT TO authenticated USING (public.is_reporting_operator());
CREATE POLICY "operators insert action plans" ON public.jeremy_action_plans
  FOR INSERT TO authenticated WITH CHECK (public.is_reporting_operator());
CREATE POLICY "operators update action plans" ON public.jeremy_action_plans
  FOR UPDATE TO authenticated USING (public.is_reporting_operator()) WITH CHECK (public.is_reporting_operator());

CREATE TRIGGER trg_jeremy_plans_updated BEFORE UPDATE ON public.jeremy_action_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Link an execution back to the plan it came from (audit both directions).
ALTER TABLE public.jeremy_action_executions
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.jeremy_action_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gate_evidence jsonb;