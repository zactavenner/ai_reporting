DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_studio_canvas_items'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_studio_canvas_items';
  END IF;
END $$;
ALTER TABLE public.ai_studio_canvas_items REPLICA IDENTITY FULL;