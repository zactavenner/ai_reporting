
-- 1. autonomous_audit_log (immutable)
CREATE TABLE public.autonomous_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  agent_name text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('report','budget_change','creative_launch','creative_kill','creative_scale','message_sent','call_made','funnel_change','task_created','escalation','finance_flag','playbook_update')),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  target_entity text,
  target_id text,
  reasoning text NOT NULL,
  inputs jsonb,
  outputs jsonb,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected','auto_approved','not_required')),
  approved_by uuid,
  approved_at timestamptz
);

GRANT SELECT, INSERT ON public.autonomous_audit_log TO authenticated;
GRANT ALL ON public.autonomous_audit_log TO service_role;
REVOKE UPDATE, DELETE ON public.autonomous_audit_log FROM anon, authenticated;

ALTER TABLE public.autonomous_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read audit log"
  ON public.autonomous_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert audit log"
  ON public.autonomous_audit_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role full audit log"
  ON public.autonomous_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.autonomous_audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'autonomous_audit_log rows cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
       OR NEW.created_at <> OLD.created_at
       OR NEW.agent_name <> OLD.agent_name
       OR NEW.action_type <> OLD.action_type
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.target_entity IS DISTINCT FROM OLD.target_entity
       OR NEW.target_id IS DISTINCT FROM OLD.target_id
       OR NEW.reasoning <> OLD.reasoning
       OR NEW.inputs IS DISTINCT FROM OLD.inputs
       OR NEW.outputs IS DISTINCT FROM OLD.outputs THEN
      RAISE EXCEPTION 'autonomous_audit_log columns are immutable';
    END IF;
    IF OLD.approval_status <> 'pending' AND NEW.approval_status <> OLD.approval_status THEN
      RAISE EXCEPTION 'approval_status can only be changed from pending';
    END IF;
    IF NEW.approval_status NOT IN ('approved','rejected','pending') THEN
      RAISE EXCEPTION 'approval_status may only transition to approved or rejected';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_autonomous_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.autonomous_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.autonomous_audit_log_immutable();

CREATE OR REPLACE FUNCTION public.resolve_audit_entry(entry_id uuid, new_status text, resolver uuid)
RETURNS public.autonomous_audit_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  updated public.autonomous_audit_log;
BEGIN
  IF new_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'new_status must be approved or rejected';
  END IF;
  UPDATE public.autonomous_audit_log
    SET approval_status = new_status, approved_by = resolver, approved_at = now()
    WHERE id = entry_id AND approval_status = 'pending'
    RETURNING * INTO updated;
  IF updated.id IS NULL THEN
    RAISE EXCEPTION 'audit entry not found or not pending';
  END IF;
  RETURN updated;
END $$;

REVOKE ALL ON FUNCTION public.resolve_audit_entry(uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_audit_entry(uuid, text, uuid) TO authenticated, service_role;

-- 2. approval_queue
CREATE TABLE public.approval_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  audit_log_id uuid REFERENCES public.autonomous_audit_log(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  queue_type text NOT NULL CHECK (queue_type IN ('creative','budget','launch','report','message','call_script','funnel_change','finance')),
  title text,
  summary text,
  agent_reasoning text,
  compliance_check_result jsonb,
  preview_payload jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','edited_approved','expired')),
  priority int NOT NULL DEFAULT 3,
  rejection_reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  expires_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_queue TO authenticated;
GRANT ALL ON public.approval_queue TO service_role;

ALTER TABLE public.approval_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage approval queue"
  ON public.approval_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_queue;
ALTER TABLE public.approval_queue REPLICA IDENTITY FULL;

-- 3. agent_lessons
CREATE TABLE public.agent_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  agent_name text NOT NULL,
  source text NOT NULL CHECK (source IN ('rejection','error','manual')),
  lesson text NOT NULL,
  context jsonb,
  active boolean NOT NULL DEFAULT true
);

GRANT SELECT, INSERT, UPDATE ON public.agent_lessons TO authenticated;
GRANT ALL ON public.agent_lessons TO service_role;

ALTER TABLE public.agent_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage lessons"
  ON public.agent_lessons FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.approval_queue_rejection_to_lesson()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agent_name text;
BEGIN
  IF NEW.status = 'rejected' AND OLD.status <> 'rejected'
     AND NEW.rejection_reason IS NOT NULL AND length(trim(NEW.rejection_reason)) > 0 THEN
    SELECT agent_name INTO v_agent_name FROM public.autonomous_audit_log WHERE id = NEW.audit_log_id;
    IF v_agent_name IS NOT NULL THEN
      INSERT INTO public.agent_lessons (agent_name, source, lesson, context)
      VALUES (v_agent_name, 'rejection', NEW.rejection_reason,
        jsonb_build_object('queue_id', NEW.id, 'client_id', NEW.client_id, 'queue_type', NEW.queue_type));
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_approval_queue_rejection_lesson
  AFTER UPDATE ON public.approval_queue
  FOR EACH ROW EXECUTE FUNCTION public.approval_queue_rejection_to_lesson();

-- 4. client_kpi_targets
CREATE TABLE public.client_kpi_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  target_cpl numeric,
  target_cps numeric,
  target_cpbc numeric,
  target_cost_per_funded numeric,
  max_daily_budget numeric,
  autonomy_mode text NOT NULL DEFAULT 'copilot' CHECK (autonomy_mode IN ('off','copilot','autopilot')),
  guardrails jsonb NOT NULL DEFAULT '{"max_budget_delta_pct": 20, "never_touch_ad_ids": [], "min_spend_before_kill": 150}'::jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_kpi_targets TO authenticated;
GRANT ALL ON public.client_kpi_targets TO service_role;

ALTER TABLE public.client_kpi_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated manage kpi targets"
  ON public.client_kpi_targets FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_client_kpi_targets_updated_at
  BEFORE UPDATE ON public.client_kpi_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.client_kpi_targets (client_id)
SELECT c.id FROM public.clients c
WHERE c.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM public.client_kpi_targets t WHERE t.client_id = c.id);

CREATE INDEX idx_audit_log_agent_created ON public.autonomous_audit_log(agent_name, created_at DESC);
CREATE INDEX idx_audit_log_client ON public.autonomous_audit_log(client_id, created_at DESC);
CREATE INDEX idx_approval_queue_status ON public.approval_queue(status, priority, created_at DESC);
CREATE INDEX idx_approval_queue_client ON public.approval_queue(client_id);
CREATE INDEX idx_agent_lessons_agent_active ON public.agent_lessons(agent_name, active);
