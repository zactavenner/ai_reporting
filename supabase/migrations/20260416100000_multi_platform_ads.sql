-- Multi-platform ad support (Google Ads via GHL unified reporting)
-- The meta_* tables become the unified ad entity store with a platform discriminator.
-- Renaming tables would break 90+ edge functions; a platform column is the pragmatic path.

ALTER TABLE public.meta_campaigns
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'meta'
    CHECK (platform IN ('meta', 'google', 'tiktok', 'linkedin'));

ALTER TABLE public.meta_ad_sets
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'meta'
    CHECK (platform IN ('meta', 'google', 'tiktok', 'linkedin'));

ALTER TABLE public.meta_ads
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'meta'
    CHECK (platform IN ('meta', 'google', 'tiktok', 'linkedin'));

CREATE INDEX IF NOT EXISTS idx_meta_campaigns_platform
  ON public.meta_campaigns(client_id, platform);
CREATE INDEX IF NOT EXISTS idx_meta_ads_platform
  ON public.meta_ads(client_id, platform);

-- Platform-aware campaign performance view for the dashboard
CREATE OR REPLACE VIEW public.v_campaigns_by_platform AS
SELECT
  mc.client_id,
  c.name AS client_name,
  mc.platform,
  mc.meta_campaign_id AS campaign_id,
  mc.name AS campaign_name,
  mc.status,
  mc.spend,
  mc.impressions,
  mc.clicks,
  mc.ctr,
  mc.cpc,
  mc.cpm,
  mc.attributed_leads,
  mc.attributed_calls,
  mc.attributed_showed,
  mc.attributed_funded,
  mc.attributed_funded_dollars,
  mc.cost_per_lead,
  mc.cost_per_call,
  mc.cost_per_funded,
  CASE WHEN mc.spend > 0 AND mc.attributed_funded_dollars > 0
    THEN ROUND((mc.attributed_funded_dollars / mc.spend)::numeric, 2)
    ELSE 0
  END AS roas,
  mc.synced_at
FROM public.meta_campaigns mc
JOIN public.clients c ON c.id = mc.client_id;
