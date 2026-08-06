CREATE TABLE public.onboarding_stage_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  stage_label text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (client_id, stage_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_stage_progress TO authenticated;
GRANT ALL ON public.onboarding_stage_progress TO service_role;

ALTER TABLE public.onboarding_stage_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage onboarding stage progress"
ON public.onboarding_stage_progress FOR ALL TO authenticated
USING (true) WITH CHECK (true);

CREATE TRIGGER trg_onboarding_stage_progress_updated_at
BEFORE UPDATE ON public.onboarding_stage_progress
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_onboarding_stage_progress_client ON public.onboarding_stage_progress (client_id);