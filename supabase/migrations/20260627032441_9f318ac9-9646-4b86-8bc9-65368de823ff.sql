UPDATE public.agents SET model = 'openrouter/owl-alpha' WHERE model IS DISTINCT FROM 'openrouter/owl-alpha';
UPDATE public.agency_agents SET default_model = 'openrouter/owl-alpha' WHERE default_model IS DISTINCT FROM 'openrouter/owl-alpha';
UPDATE public.client_agents SET model = 'openrouter/owl-alpha' WHERE model IS DISTINCT FROM 'openrouter/owl-alpha';

DO $$
DECLARE jarvis_id uuid;
BEGIN
  SELECT id INTO jarvis_id FROM public.agents
    WHERE template_key = 'ai_coo' OR lower(name) LIKE '%jarvis%'
    ORDER BY is_core DESC NULLS LAST, created_at ASC LIMIT 1;
  IF jarvis_id IS NOT NULL THEN
    UPDATE public.agents
      SET parent_agent_id = jarvis_id
      WHERE id <> jarvis_id
        AND (
          template_key IN ('media_buyer','creative','reporting_agent','sheet_auditor','qa_agent','operations')
          OR lower(name) ~ '(media buyer|creative agent|reporting agent|qa agent|sentry|canvas|pulse|scale)'
        );
  END IF;
END $$;