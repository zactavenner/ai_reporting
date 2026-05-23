
ALTER TABLE public.ai_studio_conversations
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ai_studio_conv_client_active
  ON public.ai_studio_conversations (client_id, user_id, last_active_at DESC)
  WHERE archived_at IS NULL;
