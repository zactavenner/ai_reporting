-- Lead Status Sync v2: pipeline stage tracking with full history
-- Gives agents and the dashboard a single source of truth for where every
-- lead sits in the funnel: new → call_booked → call_showed → committed → funded (or lost)

-- ============================================================
-- 1. pipeline_status on leads (distinct from the free-text `status` column
--    which GHL syncs overwrite with arbitrary CRM values)
-- ============================================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pipeline_status TEXT NOT NULL DEFAULT 'new'
    CHECK (pipeline_status IN ('new', 'contacted', 'call_booked', 'call_showed', 'committed', 'funded', 'lost')),
  ADD COLUMN IF NOT EXISTS pipeline_status_updated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS ghl_last_synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_leads_pipeline_status
  ON public.leads(client_id, pipeline_status);
CREATE INDEX IF NOT EXISTS idx_leads_ghl_sync
  ON public.leads(client_id, ghl_last_synced_at NULLS FIRST);

-- ============================================================
-- 2. lead_status_history: every transition, who/what caused it
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lead_status_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  -- What triggered the transition
  source TEXT NOT NULL CHECK (source IN (
    'ghl_pull',      -- lead-status-sync-v2 reconcile
    'ghl_webhook',   -- real-time webhook
    'manual',        -- human edit in dashboard
    'agent',         -- AI agent action
    'csv_import'
  )),
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb -- e.g. ghl appointment id, opportunity id, dollar amounts
);

ALTER TABLE public.lead_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view lead_status_history"
  ON public.lead_status_history FOR SELECT USING (true);

CREATE POLICY "Service role full access to lead_status_history"
  ON public.lead_status_history FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_lead_status_history_lead
  ON public.lead_status_history(lead_id, changed_at DESC);
CREATE INDEX idx_lead_status_history_client
  ON public.lead_status_history(client_id, changed_at DESC);

-- ============================================================
-- 3. v_lead_pipeline_status: agent/dashboard-readable current state
--    of every lead with attribution context attached
-- ============================================================
CREATE OR REPLACE VIEW public.v_lead_pipeline_status AS
SELECT
  l.id AS lead_id,
  l.client_id,
  c.name AS client_name,
  l.name AS lead_name,
  l.email,
  l.phone,
  l.external_id AS ghl_contact_id,
  l.pipeline_status,
  l.pipeline_status_updated_at,
  l.ghl_last_synced_at,
  l.is_spam,
  l.created_at AS lead_created_at,
  -- Attribution context
  l.campaign_name,
  l.utm_source,
  l.utm_campaign,
  l.ad_id,
  -- Funnel facts
  (SELECT COUNT(*) FROM public.calls ca WHERE ca.lead_id = l.id) AS total_calls,
  (SELECT COUNT(*) FROM public.calls ca WHERE ca.lead_id = l.id AND ca.showed = true) AS showed_calls,
  fi.commitment_amount,
  fi.funded_amount,
  fi.funded_at,
  -- Staleness: days since last GHL sync (NULL = never synced)
  CASE WHEN l.ghl_last_synced_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (now() - l.ghl_last_synced_at)) / 86400
    ELSE NULL
  END AS days_since_ghl_sync
FROM public.leads l
JOIN public.clients c ON c.id = l.client_id
LEFT JOIN LATERAL (
  SELECT commitment_amount, funded_amount, funded_at
  FROM public.funded_investors f
  WHERE f.lead_id = l.id
  ORDER BY f.funded_at DESC NULLS LAST
  LIMIT 1
) fi ON true;

-- ============================================================
-- 4. Register agent tools for the v2 API
-- ============================================================
INSERT INTO public.agent_tools (tool_name, description, default_approval_tier) VALUES
  ('sync_lead_status', 'Pull current lead status from GHL (contact + appointments + opportunities), derive pipeline stage, and write to reporting tables. Params: clientId + (leadId | ghlContactId | email), or syncAll+sinceDays for batch.', 'auto'),
  ('get_lead_status', 'Read the current pipeline status of a lead from v_lead_pipeline_status without hitting GHL. Params: clientId + (leadId | email).', 'auto')
ON CONFLICT (tool_name) DO NOTHING;
