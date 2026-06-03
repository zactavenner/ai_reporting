CREATE TABLE public.fundad_creatives (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  client_id uuid NULL,
  batch_id uuid NOT NULL,
  fund_name text NOT NULL,
  fund_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  creative_type text NOT NULL,
  creative_index int NOT NULL DEFAULT 0,
  ad_title text,
  hook text,
  script text,
  seedance_prompt text,
  scene_breakdown jsonb DEFAULT '[]'::jsonb,
  captions jsonb DEFAULT '[]'::jsonb,
  cta text,
  compliance_disclaimer text,
  character_desc text,
  scene_location text,
  video_url text,
  video_status text DEFAULT 'idle',
  is_variation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fundad_creatives TO authenticated;
GRANT ALL ON public.fundad_creatives TO service_role;

ALTER TABLE public.fundad_creatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own fundad creatives"
ON public.fundad_creatives FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own fundad creatives"
ON public.fundad_creatives FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update their own fundad creatives"
ON public.fundad_creatives FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users delete their own fundad creatives"
ON public.fundad_creatives FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_fundad_creatives_user_batch ON public.fundad_creatives(user_id, batch_id, creative_index);
CREATE INDEX idx_fundad_creatives_created ON public.fundad_creatives(user_id, created_at DESC);

CREATE TRIGGER trg_fundad_creatives_updated
BEFORE UPDATE ON public.fundad_creatives
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();