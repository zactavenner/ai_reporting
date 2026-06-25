CREATE TABLE IF NOT EXISTS public.ai_studio_video_model_decision_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  conversation_id UUID REFERENCES public.ai_studio_conversations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID,
  requested_model TEXT,
  chosen_model TEXT,
  downstream_model TEXT,
  override_reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_studio_video_model_decision_logs TO authenticated;
GRANT ALL ON public.ai_studio_video_model_decision_logs TO service_role;

ALTER TABLE public.ai_studio_video_model_decision_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own video model decision logs - read" ON public.ai_studio_video_model_decision_logs;
CREATE POLICY "own video model decision logs - read"
  ON public.ai_studio_video_model_decision_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_studio_video_model_decision_logs_conv
  ON public.ai_studio_video_model_decision_logs(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_studio_video_model_decision_logs_client
  ON public.ai_studio_video_model_decision_logs(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_studio_video_model_decision_logs_model
  ON public.ai_studio_video_model_decision_logs(chosen_model, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_studio_video_model_decision_logs_event
  ON public.ai_studio_video_model_decision_logs(event, created_at DESC);