DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_contacts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'whatsapp_send_queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_send_queue;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_sessions_label_unique'
      AND conrelid = 'public.whatsapp_sessions'::regclass
  ) THEN
    ALTER TABLE public.whatsapp_sessions ADD CONSTRAINT whatsapp_sessions_label_unique UNIQUE (label);
  END IF;
END $$;