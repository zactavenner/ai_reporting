-- Meeting/transcript/config data becomes service-role only. UI reads go through
-- the JWT-authenticated meetgeek-webhook `mg_activity` / `mg_get_config` actions,
-- which enforce client scoping server-side. No `USING (true)` policies remain.
DROP POLICY IF EXISTS "Team members can manage meeting call activity" ON public.meeting_call_activity;
DROP POLICY IF EXISTS "Team members can view meeting call activity" ON public.meeting_call_activity;
DROP POLICY IF EXISTS "Authenticated can read meeting records" ON public.meeting_records;
DROP POLICY IF EXISTS "Authenticated can read lead meeting context" ON public.lead_meeting_context;
DROP POLICY IF EXISTS "Authenticated can read meeting ingest events" ON public.meeting_ingest_events;
DROP POLICY IF EXISTS "Team members can manage meetgeek settings" ON public.client_meetgeek_settings;
DROP POLICY IF EXISTS "Team members can view meetgeek settings" ON public.client_meetgeek_settings;

ALTER TABLE public.meeting_call_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_meeting_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_ingest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_meetgeek_settings ENABLE ROW LEVEL SECURITY;

-- Revoke direct Data API access; service_role (edge functions) keeps full access.
REVOKE ALL ON public.meeting_call_activity FROM anon, authenticated;
REVOKE ALL ON public.meeting_records FROM anon, authenticated;
REVOKE ALL ON public.lead_meeting_context FROM anon, authenticated;
REVOKE ALL ON public.meeting_ingest_events FROM anon, authenticated;
REVOKE ALL ON public.client_meetgeek_settings FROM anon, authenticated;

GRANT ALL ON public.meeting_call_activity TO service_role;
GRANT ALL ON public.meeting_records TO service_role;
GRANT ALL ON public.lead_meeting_context TO service_role;
GRANT ALL ON public.meeting_ingest_events TO service_role;
GRANT ALL ON public.client_meetgeek_settings TO service_role;