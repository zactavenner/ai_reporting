ALTER TABLE public.meeting_call_activity
  DROP COLUMN IF EXISTS quality_rating,
  DROP COLUMN IF EXISTS quality_rubric,
  DROP COLUMN IF EXISTS quality_summary;

ALTER TABLE public.meeting_call_activity
  ADD COLUMN IF NOT EXISTS qa_total integer,
  ADD COLUMN IF NOT EXISTS qa_gate_status text,
  ADD COLUMN IF NOT EXISTS qa_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS qa_evidence_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS qa_na_redistribution jsonb,
  ADD COLUMN IF NOT EXISTS qa_red_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS qa_next_step jsonb,
  ADD COLUMN IF NOT EXISTS qa_action_owners jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS qa_meetgeek_summary text,
  ADD COLUMN IF NOT EXISTS qa_pipeline_outcome text,
  ADD COLUMN IF NOT EXISTS qa_scored_at timestamptz;

ALTER TABLE public.meeting_call_activity
  DROP CONSTRAINT IF EXISTS meeting_call_activity_qa_total_range;
ALTER TABLE public.meeting_call_activity
  ADD CONSTRAINT meeting_call_activity_qa_total_range
  CHECK (qa_total IS NULL OR (qa_total >= 0 AND qa_total <= 100));

ALTER TABLE public.meeting_call_activity
  DROP CONSTRAINT IF EXISTS meeting_call_activity_qa_gate_status_valid;
ALTER TABLE public.meeting_call_activity
  ADD CONSTRAINT meeting_call_activity_qa_gate_status_valid
  CHECK (qa_gate_status IS NULL OR qa_gate_status IN ('pass','fail','manual_review'));

CREATE INDEX IF NOT EXISTS meeting_call_activity_qa_gate_status_idx
  ON public.meeting_call_activity (client_id, qa_gate_status);