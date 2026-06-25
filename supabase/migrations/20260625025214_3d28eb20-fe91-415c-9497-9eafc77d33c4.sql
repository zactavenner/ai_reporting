
CREATE TABLE public.video_style_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  builtin_key TEXT,
  ai_trained_prompt TEXT,
  "references" JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, builtin_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_style_presets TO authenticated;
GRANT ALL ON public.video_style_presets TO service_role;

ALTER TABLE public.video_style_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own video style presets"
  ON public.video_style_presets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_video_style_presets_updated_at
  BEFORE UPDATE ON public.video_style_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX video_style_presets_user_idx ON public.video_style_presets (user_id, is_archived);
