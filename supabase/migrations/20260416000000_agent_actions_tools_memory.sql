-- Enterprise AI Automation: Agent Actions + Tool Calling Infrastructure
-- Enables agents to take auditable, reversible actions with approval tiers.

-- ============================================================
-- 1. agent_actions: Every AI-initiated action is logged here
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_run_id UUID, -- links to agent_runs for traceability
  agent_id UUID,     -- which agent template initiated this
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  -- What action was taken
  action_type TEXT NOT NULL CHECK (action_type IN (
    'pause_ad', 'enable_ad', 'adjust_budget', 'create_creative',
    'send_slack', 'create_task', 'update_ghl_contact', 'add_tag',
    'fire_capi_event', 'enqueue_sync', 'update_metric', 'escalate',
    'generate_report', 'send_email', 'custom'
  )),
  action_label TEXT NOT NULL, -- human-readable: "Paused campaign 'Spring Raise 2026' (CPL $142 > $100 threshold)"
  -- Approval tier: auto-execute vs require approval
  approval_tier TEXT NOT NULL DEFAULT 'auto' CHECK (approval_tier IN (
    'auto',            -- execute immediately, log for audit
    'approval_slack',  -- post to Slack with approve/reject buttons, wait
    'approval_ui',     -- queue in UI for manual approval
    'manual_only'      -- never auto-execute, always require human
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',   -- awaiting approval
    'approved',  -- approved, executing or queued
    'executed',  -- action completed
    'rejected',  -- human rejected
    'failed',    -- execution failed
    'rolled_back' -- action was undone
  )),
  -- Before/after state for rollback capability
  before_state JSONB DEFAULT '{}'::jsonb,  -- snapshot before the action
  after_state JSONB DEFAULT '{}'::jsonb,   -- snapshot after the action
  rollback_payload JSONB DEFAULT '{}'::jsonb, -- data needed to undo this action
  -- Execution details
  executed_at TIMESTAMP WITH TIME ZONE,
  executed_by TEXT, -- 'agent' or user email who approved
  error_message TEXT,
  -- Context: why the agent decided to take this action
  reasoning TEXT, -- AI's explanation of why it took this action
  confidence NUMERIC(3,2), -- 0.00 to 1.00
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view agent_actions"
  ON public.agent_actions FOR SELECT USING (true);

CREATE POLICY "Service role full access to agent_actions"
  ON public.agent_actions FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_agent_actions_client ON public.agent_actions(client_id, created_at DESC);
CREATE INDEX idx_agent_actions_status ON public.agent_actions(status, created_at DESC)
  WHERE status IN ('pending', 'approved');
CREATE INDEX idx_agent_actions_agent_run ON public.agent_actions(agent_run_id)
  WHERE agent_run_id IS NOT NULL;

-- ============================================================
-- 2. agent_tools: Available tools agents can invoke
-- ============================================================
-- This is a reference table — tools are implemented in run-agent,
-- but this table documents what's available and sets per-tool approval tiers.
CREATE TABLE IF NOT EXISTS public.agent_tools (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  -- Default approval tier for this tool (can be overridden per-agent)
  default_approval_tier TEXT NOT NULL DEFAULT 'auto' CHECK (default_approval_tier IN (
    'auto', 'approval_slack', 'approval_ui', 'manual_only'
  )),
  -- Parameter schema (JSON Schema format for validation)
  parameter_schema JSONB DEFAULT '{}'::jsonb,
  -- Whether this tool is currently enabled
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view agent_tools"
  ON public.agent_tools FOR SELECT USING (true);

CREATE POLICY "Service role full access to agent_tools"
  ON public.agent_tools FOR ALL USING (true) WITH CHECK (true);

-- Seed the tool registry
INSERT INTO public.agent_tools (tool_name, description, default_approval_tier) VALUES
  ('query_metrics', 'Query daily_metrics, attribution_results, or performance views for a date range', 'auto'),
  ('query_leads', 'Fetch leads with filters (source, date range, spam status)', 'auto'),
  ('query_calls', 'Fetch calls with filters (showed, date range)', 'auto'),
  ('query_funded', 'Fetch funded investors with amounts', 'auto'),
  ('query_attribution', 'Get revenue attribution by campaign/adset/ad for any model', 'auto'),
  ('query_touchpoints', 'Get customer journey touchpoints for a lead', 'auto'),
  ('query_goals', 'Get active goals and progress snapshots', 'auto'),
  ('send_slack', 'Post a message to a Slack channel', 'auto'),
  ('create_task', 'Create a task in the task board', 'auto'),
  ('update_ghl_contact', 'Update fields or tags on a GHL contact', 'approval_slack'),
  ('enqueue_ghl_job', 'Enqueue a GHL sync job (enrich, push_field, add_tag)', 'auto'),
  ('fire_capi_event', 'Send a conversion event to Meta via CAPI', 'approval_slack'),
  ('pause_ad', 'Pause a Meta ad campaign/adset/ad', 'approval_slack'),
  ('enable_ad', 'Enable a paused Meta ad', 'approval_slack'),
  ('adjust_budget', 'Change daily/lifetime budget on a Meta campaign', 'approval_ui'),
  ('create_creative', 'Generate a new ad creative variant', 'approval_slack'),
  ('escalate', 'Create an escalation for human review', 'auto'),
  ('generate_report', 'Generate a formatted performance report', 'auto'),
  ('update_goal', 'Create or update a KPI goal', 'auto'),
  ('compute_attribution', 'Trigger attribution computation for a client', 'auto')
ON CONFLICT (tool_name) DO NOTHING;

-- ============================================================
-- 3. agent_memory: Persistent memory with vector search (pgvector)
-- ============================================================
-- Requires pgvector extension. If not available, this table still works
-- for text-based memory; vector search just won't be available.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not available — agent_memory will work without vector search';
END;
$$;

CREATE TABLE IF NOT EXISTS public.agent_memory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID, -- which agent wrote this memory (NULL = shared)
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL CHECK (memory_type IN (
    'insight',       -- analytical conclusion from a run
    'preference',    -- learned client preference
    'action_result', -- outcome of a past action (what worked/didn't)
    'context',       -- background context about the client
    'warning'        -- something to watch out for
  )),
  content TEXT NOT NULL,       -- the memory text
  -- embedding VECTOR(1536),  -- uncomment when pgvector is available
  importance NUMERIC(3,2) DEFAULT 0.5, -- 0.00 to 1.00, higher = more relevant
  expires_at TIMESTAMP WITH TIME ZONE, -- NULL = permanent
  source_run_id UUID, -- which agent_run created this memory
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view agent_memory"
  ON public.agent_memory FOR SELECT USING (true);

CREATE POLICY "Service role full access to agent_memory"
  ON public.agent_memory FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_agent_memory_client ON public.agent_memory(client_id, importance DESC);
CREATE INDEX idx_agent_memory_agent ON public.agent_memory(agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;
CREATE INDEX idx_agent_memory_type ON public.agent_memory(memory_type, created_at DESC);

-- ============================================================
-- 4. Add tool_permissions to agents table (if agents table exists)
-- ============================================================
-- This allows per-agent customization of which tools are available
-- and what approval tier each tool requires for that specific agent.
DO $$
BEGIN
  ALTER TABLE public.agents
    ADD COLUMN IF NOT EXISTS tool_permissions JSONB DEFAULT '{}'::jsonb;
  -- tool_permissions format: { "pause_ad": "approval_slack", "send_slack": "auto" }
  -- Overrides the default_approval_tier from agent_tools for this specific agent.
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'agents table does not exist yet — skipping tool_permissions column';
END;
$$;

-- ============================================================
-- 5. View: pending agent actions for approval UI
-- ============================================================
CREATE OR REPLACE VIEW public.v_pending_agent_actions AS
SELECT
  aa.id,
  aa.client_id,
  c.name AS client_name,
  aa.action_type,
  aa.action_label,
  aa.approval_tier,
  aa.status,
  aa.reasoning,
  aa.confidence,
  aa.before_state,
  aa.metadata,
  aa.created_at
FROM public.agent_actions aa
JOIN public.clients c ON c.id = aa.client_id
WHERE aa.status = 'pending'
ORDER BY aa.created_at DESC;
