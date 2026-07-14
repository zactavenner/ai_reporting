
-- Open huddle tables to anon since the app uses PasswordGate, not Supabase auth
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_wins TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_blockers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_attendance TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_ratings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_flags TO anon;

DROP POLICY IF EXISTS "Authenticated read huddles" ON public.huddles;
DROP POLICY IF EXISTS "Authenticated write huddles" ON public.huddles;
CREATE POLICY "Public read huddles" ON public.huddles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddles" ON public.huddles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read huddle_wins" ON public.huddle_wins;
DROP POLICY IF EXISTS "Authenticated write huddle_wins" ON public.huddle_wins;
CREATE POLICY "Public read huddle_wins" ON public.huddle_wins FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddle_wins" ON public.huddle_wins FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read huddle_blockers" ON public.huddle_blockers;
DROP POLICY IF EXISTS "Authenticated write huddle_blockers" ON public.huddle_blockers;
CREATE POLICY "Public read huddle_blockers" ON public.huddle_blockers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddle_blockers" ON public.huddle_blockers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read huddle_attendance" ON public.huddle_attendance;
DROP POLICY IF EXISTS "Authenticated write huddle_attendance" ON public.huddle_attendance;
CREATE POLICY "Public read huddle_attendance" ON public.huddle_attendance FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddle_attendance" ON public.huddle_attendance FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read huddle_ratings" ON public.huddle_ratings;
DROP POLICY IF EXISTS "Authenticated write huddle_ratings" ON public.huddle_ratings;
CREATE POLICY "Public read huddle_ratings" ON public.huddle_ratings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddle_ratings" ON public.huddle_ratings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read huddle_settings" ON public.huddle_settings;
DROP POLICY IF EXISTS "Authenticated write huddle_settings" ON public.huddle_settings;
CREATE POLICY "Public read huddle_settings" ON public.huddle_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddle_settings" ON public.huddle_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated read huddle_flags" ON public.huddle_flags;
DROP POLICY IF EXISTS "Authenticated write huddle_flags" ON public.huddle_flags;
CREATE POLICY "Public read huddle_flags" ON public.huddle_flags FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public write huddle_flags" ON public.huddle_flags FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
