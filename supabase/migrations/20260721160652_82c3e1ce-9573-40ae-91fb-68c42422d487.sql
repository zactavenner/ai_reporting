DROP POLICY IF EXISTS "auth rw huddle_commitments" ON public.huddle_commitments;
DROP POLICY IF EXISTS "auth rw huddle_client_reviews" ON public.huddle_client_reviews;

CREATE POLICY "Public read huddle_commitments" ON public.huddle_commitments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddle_commitments" ON public.huddle_commitments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Public read huddle_client_reviews" ON public.huddle_client_reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddle_client_reviews" ON public.huddle_client_reviews FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);