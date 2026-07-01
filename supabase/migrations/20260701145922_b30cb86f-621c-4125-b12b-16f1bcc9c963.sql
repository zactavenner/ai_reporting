
CREATE TABLE public.billing_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_type TEXT NOT NULL CHECK (period_type IN ('quarter','year')),
  period_key TEXT NOT NULL,
  target_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_type, period_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_targets TO authenticated;
GRANT SELECT ON public.billing_targets TO anon;
GRANT ALL ON public.billing_targets TO service_role;

ALTER TABLE public.billing_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing_targets read all"
  ON public.billing_targets FOR SELECT
  USING (true);

CREATE POLICY "billing_targets write authenticated"
  ON public.billing_targets FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_billing_targets_updated_at
  BEFORE UPDATE ON public.billing_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
