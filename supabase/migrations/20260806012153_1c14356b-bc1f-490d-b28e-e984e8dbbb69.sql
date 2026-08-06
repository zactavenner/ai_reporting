-- Defense-in-depth: the public schema in this project still carries legacy
-- blanket grants to anon/PUBLIC. RLS policies on the H3 tables are already
-- scoped TO authenticated, but these tables hold counsel-pending fund terms,
-- so strip the residual privileges outright.
REVOKE ALL ON public.h3_runs FROM PUBLIC, anon;
REVOKE ALL ON public.h3_creatives FROM PUBLIC, anon;
REVOKE ALL ON public.h3_script_revisions FROM PUBLIC, anon;
REVOKE ALL ON public.h3_creative_events FROM PUBLIC, anon;

-- Re-assert the intended grants (no-ops if already present).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.h3_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.h3_creatives TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.h3_script_revisions TO authenticated;
GRANT SELECT, INSERT ON public.h3_creative_events TO authenticated;

GRANT ALL ON public.h3_runs TO service_role;
GRANT ALL ON public.h3_creatives TO service_role;
GRANT ALL ON public.h3_script_revisions TO service_role;
GRANT ALL ON public.h3_creative_events TO service_role;