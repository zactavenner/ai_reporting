
-- Reference video library for AI Studio (parallel to ai_studio_reference_images)
CREATE TABLE public.ai_studio_reference_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tags text[] DEFAULT '{}'::text[],
  video_url text NOT NULL,
  poster_url text,
  storage_path text,
  duration_seconds numeric,
  aspect_ratio text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'library',
  source_creative_id uuid,
  notes text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_studio_reference_videos TO authenticated;
GRANT ALL ON public.ai_studio_reference_videos TO service_role;

ALTER TABLE public.ai_studio_reference_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read video references"
  ON public.ai_studio_reference_videos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Signed in users can insert video references"
  ON public.ai_studio_reference_videos FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = created_by) OR (created_by IS NULL));

CREATE POLICY "Creator can update video references"
  ON public.ai_studio_reference_videos FOR UPDATE TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Creator can delete video references"
  ON public.ai_studio_reference_videos FOR DELETE TO authenticated
  USING (auth.uid() = created_by);

CREATE INDEX idx_ai_studio_ref_videos_client ON public.ai_studio_reference_videos(client_id);
CREATE UNIQUE INDEX uq_ai_studio_ref_videos_creative
  ON public.ai_studio_reference_videos(source_creative_id) WHERE source_creative_id IS NOT NULL;

-- Track active video references per conversation (parallel to active_reference_ids)
ALTER TABLE public.ai_studio_conversations
  ADD COLUMN IF NOT EXISTS active_video_reference_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
