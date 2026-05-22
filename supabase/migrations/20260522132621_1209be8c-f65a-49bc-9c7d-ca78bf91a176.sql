ALTER TABLE public.ai_studio_canvas_items
  ADD COLUMN IF NOT EXISTS feedback_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS feedback_notes  text,
  ADD COLUMN IF NOT EXISTS reviewed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by     uuid;

CREATE INDEX IF NOT EXISTS idx_ai_studio_canvas_feedback
  ON public.ai_studio_canvas_items (conversation_id, feedback_status);