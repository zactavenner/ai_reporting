
CREATE TABLE public.meta_ad_daily_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  meta_ad_id text NOT NULL,
  meta_adset_id text,
  meta_campaign_id text,
  spend numeric DEFAULT 0,
  impressions bigint DEFAULT 0,
  reach bigint DEFAULT 0,
  frequency numeric DEFAULT 0,
  clicks bigint DEFAULT 0,
  ctr numeric DEFAULT 0,
  cpc numeric DEFAULT 0,
  cpm numeric DEFAULT 0,
  leads integer DEFAULT 0,
  cost_per_lead numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_ad_daily_insights_unique UNIQUE (date, meta_ad_id)
);

CREATE INDEX meta_ad_daily_insights_client_date_idx
  ON public.meta_ad_daily_insights (client_id, date DESC);
CREATE INDEX meta_ad_daily_insights_ad_date_idx
  ON public.meta_ad_daily_insights (meta_ad_id, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_ad_daily_insights TO authenticated;
GRANT ALL ON public.meta_ad_daily_insights TO service_role;

ALTER TABLE public.meta_ad_daily_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can manage meta_ad_daily_insights"
  ON public.meta_ad_daily_insights
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER meta_ad_daily_insights_updated_at
  BEFORE UPDATE ON public.meta_ad_daily_insights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
