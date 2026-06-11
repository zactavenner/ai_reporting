
ALTER TABLE public.ai_studio_conversations
  ADD COLUMN IF NOT EXISTS last_actor_member_id uuid;
ALTER TABLE public.ai_studio_messages
  ADD COLUMN IF NOT EXISTS actor_member_id uuid;
ALTER TABLE public.ai_studio_canvas_items
  ADD COLUMN IF NOT EXISTS actor_member_id uuid;

DROP POLICY IF EXISTS "own conversations - all" ON public.ai_studio_conversations;
DROP POLICY IF EXISTS "shared conversations - read" ON public.ai_studio_conversations;
CREATE POLICY "team can read ai studio conversations"
  ON public.ai_studio_conversations FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "team can write ai studio conversations"
  ON public.ai_studio_conversations FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "own messages - all" ON public.ai_studio_messages;
DROP POLICY IF EXISTS "shared conversation messages - read" ON public.ai_studio_messages;
CREATE POLICY "team can read ai studio messages"
  ON public.ai_studio_messages FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "team can write ai studio messages"
  ON public.ai_studio_messages FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "own canvas - all" ON public.ai_studio_canvas_items;
DROP POLICY IF EXISTS "shared canvas - read" ON public.ai_studio_canvas_items;
CREATE POLICY "team can read ai studio canvas"
  ON public.ai_studio_canvas_items FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "team can write ai studio canvas"
  ON public.ai_studio_canvas_items FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_studio_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_studio_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_studio_canvas_items TO authenticated;
