
-- Ad spend daily table (source of truth)
CREATE TABLE public.ad_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name text,
  ad_account_id text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text,
  spend numeric(14,2) NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  leads integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_spend_daily_date_campaign_uk UNIQUE (date, campaign_id)
);
CREATE INDEX idx_ad_spend_daily_client_date ON public.ad_spend_daily (client_id, date DESC);
CREATE INDEX idx_ad_spend_daily_date ON public.ad_spend_daily (date DESC);
CREATE INDEX idx_ad_spend_daily_account ON public.ad_spend_daily (ad_account_id, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_spend_daily TO authenticated;
GRANT ALL ON public.ad_spend_daily TO service_role;
ALTER TABLE public.ad_spend_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read ad_spend_daily" ON public.ad_spend_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY "service manage ad_spend_daily" ON public.ad_spend_daily FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_ad_spend_daily_updated_at
  BEFORE UPDATE ON public.ad_spend_daily
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Per-account reliability log
CREATE TABLE public.ad_spend_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  client_name text,
  ad_account_id text,
  sync_date date,
  status text NOT NULL CHECK (status IN ('success','error','partial','running')),
  error_message text,
  rows_written integer NOT NULL DEFAULT 0,
  sheet_status text CHECK (sheet_status IN ('ok','error','skipped')),
  sheet_error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  triggered_by text NOT NULL DEFAULT 'cron'
);
CREATE INDEX idx_ad_spend_sync_runs_client ON public.ad_spend_sync_runs (client_id, started_at DESC);
CREATE INDEX idx_ad_spend_sync_runs_account ON public.ad_spend_sync_runs (ad_account_id, started_at DESC);
CREATE INDEX idx_ad_spend_sync_runs_started ON public.ad_spend_sync_runs (started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_spend_sync_runs TO authenticated;
GRANT ALL ON public.ad_spend_sync_runs TO service_role;
ALTER TABLE public.ad_spend_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read ad_spend_sync_runs" ON public.ad_spend_sync_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "service manage ad_spend_sync_runs" ON public.ad_spend_sync_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Sheet URL setting
ALTER TABLE public.agency_settings ADD COLUMN IF NOT EXISTS meta_spend_sheet_url text;

-- Health view: one row per active ad account
CREATE OR REPLACE VIEW public.v_ad_spend_health AS
WITH accounts AS (
  SELECT c.id AS client_id, c.name AS client_name,
         COALESCE(c.meta_ad_account_id, '') AS ad_account_id
    FROM public.clients c
   WHERE c.status = 'active' AND c.meta_ad_account_id IS NOT NULL AND c.meta_ad_account_id <> ''
  UNION
  SELECT c.id, c.name, unnest(c.meta_ad_account_ids)
    FROM public.clients c
   WHERE c.status = 'active' AND c.meta_ad_account_ids IS NOT NULL AND array_length(c.meta_ad_account_ids,1) > 0
),
latest_run AS (
  SELECT DISTINCT ON (client_id, ad_account_id)
    client_id, ad_account_id, status, error_message, rows_written,
    sheet_status, sheet_error, started_at, finished_at
  FROM public.ad_spend_sync_runs
  WHERE ad_account_id IS NOT NULL
  ORDER BY client_id, ad_account_id, started_at DESC
),
latest_success AS (
  SELECT DISTINCT ON (client_id, ad_account_id)
    client_id, ad_account_id, finished_at AS last_success_at
  FROM public.ad_spend_sync_runs
  WHERE status = 'success' AND ad_account_id IS NOT NULL
  ORDER BY client_id, ad_account_id, started_at DESC
),
latest_data AS (
  SELECT client_id, ad_account_id, MAX(date) AS last_date, MAX(synced_at) AS last_synced_at
  FROM public.ad_spend_daily
  GROUP BY client_id, ad_account_id
)
SELECT a.client_id, a.client_name, a.ad_account_id,
       lr.status AS last_status, lr.error_message, lr.rows_written,
       lr.sheet_status, lr.sheet_error, lr.started_at AS last_run_at,
       ls.last_success_at, ld.last_date, ld.last_synced_at,
       CASE
         WHEN lr.status = 'error' THEN true
         WHEN ls.last_success_at IS NULL THEN true
         WHEN ls.last_success_at < now() - interval '36 hours' THEN true
         ELSE false
       END AS is_stale
  FROM accounts a
  LEFT JOIN latest_run lr ON lr.client_id = a.client_id AND lr.ad_account_id = a.ad_account_id
  LEFT JOIN latest_success ls ON ls.client_id = a.client_id AND ls.ad_account_id = a.ad_account_id
  LEFT JOIN latest_data ld ON ld.client_id = a.client_id AND ld.ad_account_id = a.ad_account_id;

GRANT SELECT ON public.v_ad_spend_health TO authenticated, service_role;
