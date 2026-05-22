CREATE TABLE IF NOT EXISTS public.client_onboarding_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_onboarding_tasks_client ON public.client_onboarding_tasks(client_id);

ALTER TABLE public.client_onboarding_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Onboarding tasks readable by all" ON public.client_onboarding_tasks;
CREATE POLICY "Onboarding tasks readable by all" ON public.client_onboarding_tasks FOR SELECT USING (true);

DROP POLICY IF EXISTS "Onboarding tasks writable by all" ON public.client_onboarding_tasks;
CREATE POLICY "Onboarding tasks writable by all" ON public.client_onboarding_tasks FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_client_onboarding_tasks_updated_at ON public.client_onboarding_tasks;
CREATE TRIGGER update_client_onboarding_tasks_updated_at
BEFORE UPDATE ON public.client_onboarding_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();