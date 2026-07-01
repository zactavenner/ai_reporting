
DROP POLICY IF EXISTS "own jarvis conversations" ON public.jarvis_conversations;
DROP POLICY IF EXISTS "own jarvis messages" ON public.jarvis_messages;

ALTER TABLE public.jarvis_conversations DROP CONSTRAINT IF EXISTS jarvis_conversations_user_id_fkey;
ALTER TABLE public.jarvis_conversations ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE public.jarvis_messages ALTER COLUMN user_id TYPE text USING user_id::text;

CREATE POLICY "jarvis convs internal access" ON public.jarvis_conversations
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "jarvis msgs internal access" ON public.jarvis_messages
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_conversations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_messages TO anon;
