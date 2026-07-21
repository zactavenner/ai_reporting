DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'huddle_ratings' AND policyname = 'Public read huddle_ratings'
  ) THEN
    CREATE POLICY "Public read huddle_ratings" ON public.huddle_ratings FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'huddle_ratings' AND policyname = 'Public write huddle_ratings'
  ) THEN
    CREATE POLICY "Public write huddle_ratings" ON public.huddle_ratings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'huddle_flags' AND policyname = 'Public read huddle_flags'
  ) THEN
    CREATE POLICY "Public read huddle_flags" ON public.huddle_flags FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'huddle_flags' AND policyname = 'Public write huddle_flags'
  ) THEN
    CREATE POLICY "Public write huddle_flags" ON public.huddle_flags FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'huddle_blockers' AND policyname = 'Public read huddle_blockers'
  ) THEN
    CREATE POLICY "Public read huddle_blockers" ON public.huddle_blockers FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'huddle_blockers' AND policyname = 'Public write huddle_blockers'
  ) THEN
    CREATE POLICY "Public write huddle_blockers" ON public.huddle_blockers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;