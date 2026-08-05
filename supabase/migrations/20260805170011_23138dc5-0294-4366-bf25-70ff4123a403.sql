CREATE TABLE public.client_weekly_report_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  wins text,
  risks text,
  next_plan text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, week_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_weekly_report_notes TO authenticated;
GRANT SELECT ON public.client_weekly_report_notes TO anon;
GRANT ALL ON public.client_weekly_report_notes TO service_role;

ALTER TABLE public.client_weekly_report_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read weekly report notes" ON public.client_weekly_report_notes FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert weekly report notes" ON public.client_weekly_report_notes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update weekly report notes" ON public.client_weekly_report_notes FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete weekly report notes" ON public.client_weekly_report_notes FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_client_weekly_report_notes_updated
BEFORE UPDATE ON public.client_weekly_report_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_cwrn_client_week ON public.client_weekly_report_notes (client_id, week_start DESC);