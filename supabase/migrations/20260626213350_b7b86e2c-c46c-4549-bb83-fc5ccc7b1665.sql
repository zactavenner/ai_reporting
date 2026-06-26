DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='tasks') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='deals') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.deals';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='agency_meetings') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agency_meetings';
  END IF;
END$$;

ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER TABLE public.deals REPLICA IDENTITY FULL;
ALTER TABLE public.agency_meetings REPLICA IDENTITY FULL;