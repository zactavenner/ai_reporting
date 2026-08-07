ALTER TABLE public.meeting_records ADD COLUMN IF NOT EXISTS transcript_text text;

CREATE INDEX IF NOT EXISTS idx_meeting_records_client_started
  ON public.meeting_records (client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_meeting_context_lead
  ON public.lead_meeting_context (lead_id);

CREATE OR REPLACE FUNCTION public.get_lead_call_transcripts(
  p_client_id uuid DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25
)
RETURNS TABLE(
  lead_id uuid,
  lead_name text,
  lead_email text,
  client_id uuid,
  meeting_record_id uuid,
  title text,
  started_at timestamptz,
  duration_minutes integer,
  match_method text,
  match_confidence numeric,
  summary text,
  action_items jsonb,
  transcript text,
  recording_url text,
  qa_total integer,
  qa_gate_status text,
  qa_scores jsonb,
  qa_red_flags jsonb,
  qa_next_step jsonb,
  qa_pipeline_outcome text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id, l.name, l.email, m.client_id, m.id,
    m.title, m.started_at, m.duration_minutes,
    ctx.match_method, ctx.match_confidence,
    COALESCE(a.qa_meetgeek_summary, m.summary),
    m.action_items,
    LEFT(COALESCE(m.transcript_text, ''), 24000),
    m.recording_url,
    a.qa_total, a.qa_gate_status, a.qa_scores, a.qa_red_flags, a.qa_next_step, a.qa_pipeline_outcome
  FROM public.meeting_records m
  JOIN public.lead_meeting_context ctx ON ctx.meeting_record_id = m.id
  JOIN public.leads l ON l.id = ctx.lead_id
  LEFT JOIN public.meeting_call_activity a ON a.meeting_record_id = m.id AND a.lead_id = ctx.lead_id
  WHERE (p_client_id IS NULL OR m.client_id = p_client_id)
    AND (p_lead_id IS NULL OR ctx.lead_id = p_lead_id)
  ORDER BY m.started_at DESC NULLS LAST
  LIMIT GREATEST(COALESCE(p_limit, 25), 1);
$$;

REVOKE ALL ON FUNCTION public.get_lead_call_transcripts(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lead_call_transcripts(uuid, uuid, integer) TO service_role;