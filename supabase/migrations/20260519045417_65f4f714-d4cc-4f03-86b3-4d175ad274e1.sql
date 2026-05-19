-- Reference image library across clients
CREATE TABLE public.ai_studio_reference_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  image_url TEXT NOT NULL,
  storage_path TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_studio_reference_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read references"
ON public.ai_studio_reference_images FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Signed in users can insert references"
ON public.ai_studio_reference_images FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by OR created_by IS NULL);

CREATE POLICY "Creator can delete references"
ON public.ai_studio_reference_images FOR DELETE
TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "Creator can update references"
ON public.ai_studio_reference_images FOR UPDATE
TO authenticated
USING (auth.uid() = created_by);

-- Per-conversation active references + chat model
ALTER TABLE public.ai_studio_conversations
  ADD COLUMN IF NOT EXISTS active_reference_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS chat_model TEXT;