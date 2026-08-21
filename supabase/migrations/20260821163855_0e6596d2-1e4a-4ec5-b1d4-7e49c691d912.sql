ALTER TABLE public.ad_spend_daily ALTER COLUMN ad_account_id SET DEFAULT '';
UPDATE public.ad_spend_daily SET ad_account_id = '' WHERE ad_account_id IS NULL;
ALTER TABLE public.ad_spend_daily ALTER COLUMN ad_account_id SET NOT NULL;

ALTER TABLE public.ad_spend_daily DROP CONSTRAINT IF EXISTS ad_spend_daily_date_campaign_uk;
DROP INDEX IF EXISTS public.ad_spend_daily_date_campaign_uk;
CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_daily_campaign_day_uk
  ON public.ad_spend_daily (client_id, ad_account_id, campaign_id, date);

ALTER TABLE public.ad_spend_reports
  ADD COLUMN IF NOT EXISTS ad_account_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS campaign_id text NOT NULL DEFAULT '';

ALTER TABLE public.ad_spend_reports
  ADD COLUMN IF NOT EXISTS report_date date
  GENERATED ALWAYS AS ((reported_at AT TIME ZONE 'America/Los_Angeles')::date) STORED;

DELETE FROM public.ad_spend_reports a
USING public.ad_spend_reports b
WHERE a.id <> b.id
  AND a.client_id = b.client_id
  AND a.ad_account_id = b.ad_account_id
  AND a.campaign_id = b.campaign_id
  AND a.report_date = b.report_date
  AND (a.created_at, a.id) < (b.created_at, b.id);

ALTER TABLE public.ad_spend_reports DROP CONSTRAINT IF EXISTS ad_spend_reports_unique_record;
ALTER TABLE public.ad_spend_reports DROP CONSTRAINT IF EXISTS uq_ad_spend_reports_daily;
DROP INDEX IF EXISTS public.ad_spend_reports_unique_record;
DROP INDEX IF EXISTS public.uq_ad_spend_reports_daily;
CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_reports_campaign_day_uk
  ON public.ad_spend_reports (client_id, ad_account_id, campaign_id, report_date);