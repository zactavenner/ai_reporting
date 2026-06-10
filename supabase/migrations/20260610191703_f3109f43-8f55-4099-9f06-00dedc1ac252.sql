ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS hermes_api_key text,
  ADD COLUMN IF NOT EXISTS hermes_callback_url text,
  ADD COLUMN IF NOT EXISTS hermes_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.ai_studio_conversations
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'user';

CREATE POLICY "shared conversations - read"
  ON public.ai_studio_conversations
  FOR SELECT
  USING (is_shared = true);

CREATE POLICY "shared conversation messages - read"
  ON public.ai_studio_messages
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.ai_studio_conversations c
    WHERE c.id = ai_studio_messages.conversation_id AND c.is_shared = true
  ));

CREATE POLICY "shared canvas items - read"
  ON public.ai_studio_canvas_items
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.ai_studio_conversations c
    WHERE c.id = ai_studio_canvas_items.conversation_id AND c.is_shared = true
  ));