
CREATE TABLE IF NOT EXISTS public.client_constraint_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  checklist_type TEXT NOT NULL,
  item_key TEXT NOT NULL,
  checked BOOLEAN NOT NULL DEFAULT false,
  checked_by UUID,
  checked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, checklist_type, item_key)
);

ALTER TABLE public.client_constraint_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read constraint checklists"
  ON public.client_constraint_checklists FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert constraint checklists"
  ON public.client_constraint_checklists FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update constraint checklists"
  ON public.client_constraint_checklists FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete constraint checklists"
  ON public.client_constraint_checklists FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_client_constraint_checklists_updated_at
  BEFORE UPDATE ON public.client_constraint_checklists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_ccc_client ON public.client_constraint_checklists(client_id);

CREATE TABLE IF NOT EXISTS public.client_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  topic TEXT NOT NULL,
  decision TEXT,
  owner_id UUID,
  owner_name TEXT,
  status TEXT NOT NULL DEFAULT 'not_started',
  notes TEXT,
  file_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.client_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read decisions"
  ON public.client_decisions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert decisions"
  ON public.client_decisions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update decisions"
  ON public.client_decisions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete decisions"
  ON public.client_decisions FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_client_decisions_updated_at
  BEFORE UPDATE ON public.client_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_cd_client ON public.client_decisions(client_id);
