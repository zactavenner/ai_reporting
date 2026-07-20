
CREATE TABLE public.client_call_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text,
  kind text NOT NULL DEFAULT 'note',
  content text NOT NULL,
  source text,
  occurred_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_call_notes TO authenticated, anon;
GRANT ALL ON public.client_call_notes TO service_role;
ALTER TABLE public.client_call_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read client_call_notes" ON public.client_call_notes FOR SELECT USING (true);
CREATE POLICY "Public write client_call_notes" ON public.client_call_notes FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_client_call_notes_client ON public.client_call_notes (client_id, created_at DESC);
CREATE TRIGGER trg_client_call_notes_updated BEFORE UPDATE ON public.client_call_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
