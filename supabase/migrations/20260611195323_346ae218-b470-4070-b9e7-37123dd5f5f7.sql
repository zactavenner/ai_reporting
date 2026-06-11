
CREATE TABLE IF NOT EXISTS public.meta_token_state (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_validated_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  ad_account_count INTEGER,
  CONSTRAINT singleton CHECK (id = 1)
);

GRANT SELECT ON public.meta_token_state TO authenticated;
GRANT ALL ON public.meta_token_state TO service_role;

ALTER TABLE public.meta_token_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view token state"
  ON public.meta_token_state FOR SELECT
  TO authenticated USING (true);
