
-- Extend funnel steps with new content types
ALTER TABLE public.client_funnel_steps
  ADD COLUMN IF NOT EXISTS step_kind text NOT NULL DEFAULT 'page',
  ADD COLUMN IF NOT EXISTS ad_platform text,
  ADD COLUMN IF NOT EXISTS sms_body text,
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS email_from_name text,
  ADD COLUMN IF NOT EXISTS email_body text;

-- Backfill step_kind from existing step_type/url
UPDATE public.client_funnel_steps
  SET step_kind = CASE
    WHEN url = 'fb://lead-form' THEN 'fb_lead_form'
    ELSE 'page'
  END
  WHERE step_kind = 'page';

-- Link table between steps and creatives (for ad-rotator steps)
CREATE TABLE IF NOT EXISTS public.funnel_step_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES public.client_funnel_steps(id) ON DELETE CASCADE,
  creative_id uuid NOT NULL REFERENCES public.creatives(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_id, creative_id)
);

CREATE INDEX IF NOT EXISTS idx_funnel_step_ads_step ON public.funnel_step_ads(step_id);
CREATE INDEX IF NOT EXISTS idx_funnel_step_ads_creative ON public.funnel_step_ads(creative_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.funnel_step_ads TO authenticated;
GRANT SELECT ON public.funnel_step_ads TO anon;
GRANT ALL ON public.funnel_step_ads TO service_role;

ALTER TABLE public.funnel_step_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on funnel_step_ads" ON public.funnel_step_ads;
CREATE POLICY "Allow all operations on funnel_step_ads"
  ON public.funnel_step_ads
  FOR ALL
  USING (true)
  WITH CHECK (true);
