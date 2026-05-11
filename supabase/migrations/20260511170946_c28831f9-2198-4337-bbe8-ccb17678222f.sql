
CREATE TABLE public.app_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'feature',
  priority TEXT DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by_id UUID,
  submitted_by_name TEXT,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view app_feedback" ON public.app_feedback FOR SELECT USING (true);
CREATE POLICY "Public can insert app_feedback" ON public.app_feedback FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update app_feedback" ON public.app_feedback FOR UPDATE USING (true);
CREATE POLICY "Public can delete app_feedback" ON public.app_feedback FOR DELETE USING (true);

CREATE TRIGGER set_app_feedback_updated_at
BEFORE UPDATE ON public.app_feedback
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_app_feedback_status ON public.app_feedback(status);
CREATE INDEX idx_app_feedback_created_at ON public.app_feedback(created_at DESC);
