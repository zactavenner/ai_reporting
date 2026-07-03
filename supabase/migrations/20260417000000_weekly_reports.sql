-- Weekly Reporting System: sheet-style editable weekly reports with
-- computed-vs-override values and external baseline cross-referencing.

-- ============================================================
-- 1. weekly_reports: one row per client per week
-- ============================================================
CREATE TABLE IF NOT EXISTS public.weekly_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start DATE NOT NULL, -- Monday
  week_end DATE NOT NULL,
  -- Core metrics: { "<metric_key>": { "computed": number, "override": number|null, "note": string|null } }
  -- computed = from DB aggregation, override = human edit (wins for display),
  -- so the sheet-style edit never destroys the system-of-record value.
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- GHL form question answers aggregated for leads created this week:
  -- { "<question text>": { "<answer>": count, ... }, ... }
  question_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Lead disposition counts for the week: { "call_booked": 12, "lost": 4, ... }
  disposition_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- User-added custom rows: [ { "label": "...", "value": ..., "note": "..." } ]
  custom_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'sent')),
  generated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id, week_start)
);

ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view weekly_reports"
  ON public.weekly_reports FOR SELECT USING (true);
CREATE POLICY "Service role full access to weekly_reports"
  ON public.weekly_reports FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_weekly_reports_client_week
  ON public.weekly_reports(client_id, week_start DESC);

CREATE TRIGGER update_weekly_reports_updated_at
  BEFORE UPDATE ON public.weekly_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. report_baselines: external numbers (e.g. the Google Sheet)
--    pasted in for cross-referencing against DB-computed values
-- ============================================================
CREATE TABLE IF NOT EXISTS public.report_baselines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  source_label TEXT NOT NULL DEFAULT 'sheet', -- 'sheet', 'ads_manager', etc.
  -- { "<metric_key>": number } — same keys as weekly_reports.metrics
  "values" JSONB NOT NULL DEFAULT '{}'::jsonb,
  entered_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id, week_start, source_label)
);

ALTER TABLE public.report_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view report_baselines"
  ON public.report_baselines FOR SELECT USING (true);
CREATE POLICY "Service role full access to report_baselines"
  ON public.report_baselines FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_report_baselines_client_week
  ON public.report_baselines(client_id, week_start DESC);

-- ============================================================
-- 3. RetargetIQ per-client settings + note-sync tracking
-- ============================================================
ALTER TABLE public.client_settings
  ADD COLUMN IF NOT EXISTS retargetiq_website_slug TEXT,
  ADD COLUMN IF NOT EXISTS retargetiq_notes_sync_enabled BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.client_settings.retargetiq_website_slug IS
  'RetargetIQ website slug for enrichment API calls (e.g. high-performance-ads). API key lives in the RETARGETIQ_API_KEY Supabase secret, never in the DB.';

-- Track which leads have had enrichment notes pushed to GHL (idempotency)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS enrichment_note_synced_at TIMESTAMP WITH TIME ZONE;

-- ============================================================
-- 4. Agent tool registry entries
-- ============================================================
INSERT INTO public.agent_tools (tool_name, description, default_approval_tier) VALUES
  ('generate_weekly_report', 'Compute/refresh a weekly report for a client and week. Preserves human overrides. Params: clientId, weekStart (Monday, yyyy-mm-dd).', 'auto'),
  ('enrich_and_note_ghl', 'Enrich a lead via RetargetIQ and write the enrichment summary as a note on the GHL contact. Params: clientId, leadId.', 'auto')
ON CONFLICT (tool_name) DO NOTHING;
