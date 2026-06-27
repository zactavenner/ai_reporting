
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_channels TO authenticated;
GRANT ALL ON public.agent_channels TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_messages TO authenticated;
GRANT ALL ON public.agent_messages TO service_role;

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_channels';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END$$;

ALTER TABLE public.agent_messages REPLICA IDENTITY FULL;
ALTER TABLE public.agent_channels REPLICA IDENTITY FULL;

INSERT INTO public.agent_channels (scope, client_id, agent_id, kind, name)
SELECT
  CASE WHEN a.client_id IS NULL THEN 'agency' ELSE 'client' END,
  a.client_id,
  a.id,
  'agent',
  '#agent-' || substr(a.id::text, 1, 6)
FROM public.agents a
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_channels c
  WHERE c.agent_id = a.id AND c.kind = 'agent'
    AND ((c.client_id IS NULL AND a.client_id IS NULL) OR c.client_id = a.client_id)
);
