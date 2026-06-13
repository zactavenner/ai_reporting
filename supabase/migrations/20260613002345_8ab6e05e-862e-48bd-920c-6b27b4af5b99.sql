
-- AI insights table for anomaly detection + predictive alerts
CREATE TABLE IF NOT EXISTS public.ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  insight_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL, -- 'anomaly' | 'commentary' | 'forecast' | 'risk'
  severity text NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'critical'
  title text NOT NULL,
  body text,
  metrics jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_client_date ON public.ai_insights(client_id, insight_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_insights_severity ON public.ai_insights(severity, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_insights TO authenticated;
GRANT ALL ON public.ai_insights TO service_role;

ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read insights" ON public.ai_insights
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write insights" ON public.ai_insights
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- AI meeting prep cache
CREATE TABLE IF NOT EXISTS public.ai_meeting_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid REFERENCES public.agency_meetings(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  brief_markdown text NOT NULL,
  context_used jsonb,
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_meeting_briefs_meeting ON public.ai_meeting_briefs(meeting_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_meeting_briefs TO authenticated;
GRANT ALL ON public.ai_meeting_briefs TO service_role;

ALTER TABLE public.ai_meeting_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read meeting briefs" ON public.ai_meeting_briefs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write meeting briefs" ON public.ai_meeting_briefs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
