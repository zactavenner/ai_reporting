ALTER TABLE public.notetaker_coverage
  ADD COLUMN IF NOT EXISTS call_record_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_answer_reason text;

ALTER TABLE public.notetaker_coverage DROP CONSTRAINT IF EXISTS notetaker_coverage_coverage_state_chk;
ALTER TABLE public.notetaker_coverage ADD CONSTRAINT notetaker_coverage_coverage_state_chk
  CHECK (coverage_state = ANY (ARRAY['pending','invited','awaiting_transcript','transcript_complete','no_answer','not_required','exception']));

ALTER TABLE public.notetaker_coverage DROP CONSTRAINT IF EXISTS notetaker_coverage_outcome_chk;
ALTER TABLE public.notetaker_coverage ADD CONSTRAINT notetaker_coverage_outcome_chk
  CHECK (outcome IS NULL OR outcome = ANY (ARRAY['transcript_complete','no_transcript','no_answer','cancelled','not_required','pending']));

CREATE INDEX IF NOT EXISTS notetaker_coverage_call_record_idx ON public.notetaker_coverage(call_record_id);

ALTER TABLE public.meeting_ingest_events
  ADD COLUMN IF NOT EXISTS hydration_code text,
  ADD COLUMN IF NOT EXISTS hydration_detail text,
  ADD COLUMN IF NOT EXISTS hydration_failed_at timestamptz;