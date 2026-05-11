-- Sheet audit runs storage
CREATE TABLE IF NOT EXISTS public.sheet_audit_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'client',
  sheet_url TEXT,
  tab_gid TEXT,
  quality_score INTEGER,
  spam_count INTEGER NOT NULL DEFAULT 0,
  quality_issue_count INTEGER NOT NULL DEFAULT 0,
  accuracy_delta_count INTEGER NOT NULL DEFAULT 0,
  findings JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  whatsapp_message TEXT,
  triggered_by UUID,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sheet_audit_runs_client ON public.sheet_audit_runs(client_id, run_at DESC);

ALTER TABLE public.sheet_audit_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read sheet_audit_runs"
ON public.sheet_audit_runs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages sheet_audit_runs"
ON public.sheet_audit_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can insert sheet_audit_runs"
ON public.sheet_audit_runs FOR INSERT TO authenticated WITH CHECK (true);

-- Notification channels on agents
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS notify_channels TEXT[] NOT NULL DEFAULT ARRAY['slack']::text[],
  ADD COLUMN IF NOT EXISTS whatsapp_recipients TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

-- Per-client WhatsApp recipients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS whatsapp_notify_numbers TEXT[] NOT NULL DEFAULT ARRAY[]::text[];

-- Agency-level Twilio WhatsApp config
ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS twilio_whatsapp_from TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_default_recipients TEXT[] NOT NULL DEFAULT ARRAY[]::text[];