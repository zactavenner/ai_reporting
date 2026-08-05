-- 1. Ingest audit / idempotency
CREATE TABLE public.meeting_ingest_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'meetgeek',
  event_id TEXT,
  meeting_external_id TEXT,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX meeting_ingest_events_dedupe_uidx ON public.meeting_ingest_events (provider, dedupe_key);
CREATE INDEX meeting_ingest_events_client_idx ON public.meeting_ingest_events (client_id, created_at DESC);

GRANT SELECT ON public.meeting_ingest_events TO authenticated;
GRANT ALL ON public.meeting_ingest_events TO service_role;
ALTER TABLE public.meeting_ingest_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read meeting ingest events"
  ON public.meeting_ingest_events FOR SELECT TO authenticated USING (true);

CREATE TRIGGER meeting_ingest_events_updated_at
  BEFORE UPDATE ON public.meeting_ingest_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Normalized meeting records
CREATE TABLE public.meeting_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'meetgeek',
  meeting_external_id TEXT NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT,
  status TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  language TEXT,
  host_email TEXT,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  transcript_url TEXT,
  recording_url TEXT,
  source_url TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX meeting_records_provider_external_uidx ON public.meeting_records (provider, meeting_external_id);
CREATE INDEX meeting_records_client_started_idx ON public.meeting_records (client_id, started_at DESC);

GRANT SELECT ON public.meeting_records TO authenticated;
GRANT ALL ON public.meeting_records TO service_role;
ALTER TABLE public.meeting_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read meeting records"
  ON public.meeting_records FOR SELECT TO authenticated USING (true);

CREATE TRIGGER meeting_records_updated_at
  BEFORE UPDATE ON public.meeting_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Lead <-> meeting context
CREATE TABLE public.lead_meeting_context (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_record_id UUID NOT NULL REFERENCES public.meeting_records(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  matched_email TEXT,
  match_method TEXT,
  match_confidence NUMERIC NOT NULL DEFAULT 0,
  ghl_contact_id TEXT,
  ghl_note_status TEXT NOT NULL DEFAULT 'skipped',
  ghl_note_error TEXT,
  ghl_note_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lead_meeting_context_meeting_lead_uidx
  ON public.lead_meeting_context (meeting_record_id, COALESCE(lead_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX lead_meeting_context_lead_idx ON public.lead_meeting_context (lead_id, created_at DESC);

GRANT SELECT ON public.lead_meeting_context TO authenticated;
GRANT ALL ON public.lead_meeting_context TO service_role;
ALTER TABLE public.lead_meeting_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read lead meeting context"
  ON public.lead_meeting_context FOR SELECT TO authenticated USING (true);

CREATE TRIGGER lead_meeting_context_updated_at
  BEFORE UPDATE ON public.lead_meeting_context
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();