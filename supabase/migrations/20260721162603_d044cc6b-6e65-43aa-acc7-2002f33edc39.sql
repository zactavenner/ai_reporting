GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_flags TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_blockers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_ratings TO anon, authenticated;
GRANT ALL ON public.huddle_flags TO service_role;
GRANT ALL ON public.huddle_blockers TO service_role;
GRANT ALL ON public.huddle_ratings TO service_role;