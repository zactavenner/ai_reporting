-- Per-client reference scoping for AI Studio
ALTER TABLE public.ai_studio_reference_images
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'library',
  ADD COLUMN IF NOT EXISTS source_creative_id uuid;

CREATE INDEX IF NOT EXISTS idx_ai_studio_refs_client ON public.ai_studio_reference_images(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_studio_refs_source_creative ON public.ai_studio_reference_images(source_creative_id);

-- Prevent duplicate auto-imports of the same approved creative
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_studio_refs_creative
  ON public.ai_studio_reference_images(source_creative_id)
  WHERE source_creative_id IS NOT NULL;