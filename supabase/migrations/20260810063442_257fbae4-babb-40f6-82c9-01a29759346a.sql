CREATE UNIQUE INDEX IF NOT EXISTS call_analysis_call_id_key
  ON public.call_analysis (call_id);

CREATE INDEX IF NOT EXISTS idx_calls_pending_transcript
  ON public.calls (scheduled_at DESC)
  WHERE transcript IS NULL AND scheduled_at IS NOT NULL;