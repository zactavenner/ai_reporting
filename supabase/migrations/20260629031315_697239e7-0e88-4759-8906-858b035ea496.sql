
ALTER TABLE public.ai_studio_canvas_items
  ADD COLUMN IF NOT EXISTS job_id TEXT,
  ADD COLUMN IF NOT EXISTS placeholder_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_canvas_items_job_id ON public.ai_studio_canvas_items(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canvas_items_placeholder_until ON public.ai_studio_canvas_items(placeholder_until) WHERE placeholder_until IS NOT NULL;

ALTER TABLE public.agency_settings
  ADD COLUMN IF NOT EXISTS default_chat_model TEXT NOT NULL DEFAULT 'openrouter/owl-alpha',
  ADD COLUMN IF NOT EXISTS default_image_model TEXT NOT NULL DEFAULT 'google/gemini-3.1-flash-image',
  ADD COLUMN IF NOT EXISTS default_video_model TEXT NOT NULL DEFAULT 'bytedance/seedance-2.0-fast';

CREATE TABLE IF NOT EXISTS public.hermes_task_type_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL UNIQUE,
  agent_types TEXT[] NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hermes_task_type_routes TO authenticated, anon;
GRANT ALL ON public.hermes_task_type_routes TO service_role;
ALTER TABLE public.hermes_task_type_routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read routes" ON public.hermes_task_type_routes;
CREATE POLICY "read routes" ON public.hermes_task_type_routes FOR SELECT USING (true);
DROP POLICY IF EXISTS "auth write routes" ON public.hermes_task_type_routes;
CREATE POLICY "auth write routes" ON public.hermes_task_type_routes FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.hermes_task_type_routes(task_type, agent_types) VALUES
  ('video', ARRAY['video_ads_generator','video_ads','video','creative','content']),
  ('video_ad', ARRAY['video_ads_generator','video_ads','video']),
  ('video_edit', ARRAY['video_editor','video_editing']),
  ('video_editing', ARRAY['video_editor','video_editing']),
  ('static_ad', ARRAY['static_ads_generator','static_ads','image','creative','static_ad']),
  ('static', ARRAY['static_ads_generator','static_ads']),
  ('copy', ARRAY['copy','content','writing']),
  ('research', ARRAY['research','analyst']),
  ('reporting', ARRAY['reporting','analyst']),
  ('report', ARRAY['reporting','analyst']),
  ('task_triage', ARRAY['task_triage','triage','project_manager','pm','operations']),
  ('triage', ARRAY['task_triage','triage','project_manager','pm','operations'])
ON CONFLICT (task_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reap_orphaned_canvas_placeholders()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  WITH d AS (
    DELETE FROM public.ai_studio_canvas_items
    WHERE kind = 'pending'
      AND (
        (placeholder_until IS NOT NULL AND placeholder_until < now())
        OR (placeholder_until IS NULL AND created_at < now() - interval '30 minutes')
      )
    RETURNING id
  ) SELECT count(*) INTO n FROM d;
  RETURN COALESCE(n, 0);
END $$;
GRANT EXECUTE ON FUNCTION public.reap_orphaned_canvas_placeholders() TO service_role, authenticated;

DO $$ BEGIN
  PERFORM cron.unschedule('reap-orphaned-canvas-placeholders');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('reap-orphaned-canvas-placeholders', '*/5 * * * *',
  $$SELECT public.reap_orphaned_canvas_placeholders();$$);
