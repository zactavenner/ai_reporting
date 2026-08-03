-- 1. Collapse existing duplicates (null-safe, per calendar day), keeping newest
DELETE FROM public.ad_spend_reports a
USING public.ad_spend_reports b
WHERE a.client_id = b.client_id
  AND a.reported_at::date = b.reported_at::date
  AND COALESCE(a.platform,'facebook') = COALESCE(b.platform,'facebook')
  AND COALESCE(a.campaign_name,'') = COALESCE(b.campaign_name,'')
  AND COALESCE(a.ad_set_name,'') = COALESCE(b.ad_set_name,'')
  AND (a.created_at, a.id) < (b.created_at, b.id);

-- 2. Normalize keys
UPDATE public.ad_spend_reports
   SET reported_at = date_trunc('day', reported_at),
       campaign_name = COALESCE(campaign_name, ''),
       ad_set_name = COALESCE(ad_set_name, ''),
       platform = COALESCE(platform, 'facebook');

ALTER TABLE public.ad_spend_reports
  ALTER COLUMN campaign_name SET DEFAULT '',
  ALTER COLUMN campaign_name SET NOT NULL,
  ALTER COLUMN ad_set_name SET DEFAULT '',
  ALTER COLUMN ad_set_name SET NOT NULL,
  ALTER COLUMN platform SET DEFAULT 'facebook',
  ALTER COLUMN platform SET NOT NULL;

-- 3. Enforce one report per client/day/platform/campaign/ad set
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_spend_reports_daily
  ON public.ad_spend_reports (client_id, reported_at, platform, campaign_name, ad_set_name);