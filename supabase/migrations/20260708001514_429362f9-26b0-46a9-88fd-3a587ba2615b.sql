GRANT SELECT ON public.meta_ad_daily_insights TO anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'meta_ad_daily_insights'
      AND policyname = 'Public can view meta_ad_daily_insights'
  ) THEN
    CREATE POLICY "Public can view meta_ad_daily_insights"
      ON public.meta_ad_daily_insights
      FOR SELECT
      TO anon
      USING (true);
  END IF;
END $$;