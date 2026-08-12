CREATE TABLE public.phone_call_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  call_id TEXT NOT NULL UNIQUE,
  provider TEXT,
  appointment_id TEXT,
  contact_id TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  assigned_user TEXT,
  assigned_user_id TEXT,
  assigned_user_phone TEXT,
  campaign TEXT,
  direction TEXT,
  call_status TEXT,
  started_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER DEFAULT 0,
  connected BOOLEAN DEFAULT false,
  recording_url TEXT,
  transcript TEXT,
  speaker_segments JSONB DEFAULT '[]'::jsonb,
  transcribed_at TIMESTAMPTZ,
  transcription_status TEXT NOT NULL DEFAULT 'pending',
  transcription_error TEXT,
  summary TEXT,
  outcome TEXT,
  sentiment TEXT,
  intent_score INTEGER,
  next_step TEXT,
  follow_up_date DATE,
  objections JSONB DEFAULT '[]'::jsonb,
  important_quotes JSONB DEFAULT '[]'::jsonb,
  investment_amount NUMERIC,
  investment_range TEXT,
  investment_timeline TEXT,
  accredited TEXT,
  commitment_level TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  analyzed_at TIMESTAMPTZ,
  ghl_synced_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.phone_call_records TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phone_call_records TO authenticated;
GRANT ALL ON public.phone_call_records TO service_role;

ALTER TABLE public.phone_call_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dashboard can view phone call records"
  ON public.phone_call_records FOR SELECT USING (true);
CREATE POLICY "Team can update phone call records"
  ON public.phone_call_records FOR UPDATE TO authenticated, anon USING (true) WITH CHECK (true);

CREATE INDEX idx_phone_call_records_started_at ON public.phone_call_records (started_at DESC);
CREATE INDEX idx_phone_call_records_client ON public.phone_call_records (client_id);
CREATE INDEX idx_phone_call_records_contact ON public.phone_call_records (contact_id);
CREATE INDEX idx_phone_call_records_status ON public.phone_call_records (transcription_status);
CREATE INDEX idx_phone_call_records_transcript_fts ON public.phone_call_records USING gin (to_tsvector('english', coalesce(transcript, '') || ' ' || coalesce(summary, '')));

CREATE TRIGGER update_phone_call_records_updated_at
  BEFORE UPDATE ON public.phone_call_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();