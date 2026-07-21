GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_attendance TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_wins TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_ratings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_flags TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_blockers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_commitments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_client_reviews TO anon, authenticated;
GRANT ALL ON public.huddles TO service_role;
GRANT ALL ON public.huddle_settings TO service_role;
GRANT ALL ON public.huddle_attendance TO service_role;
GRANT ALL ON public.huddle_wins TO service_role;
GRANT ALL ON public.huddle_ratings TO service_role;
GRANT ALL ON public.huddle_flags TO service_role;
GRANT ALL ON public.huddle_blockers TO service_role;
GRANT ALL ON public.huddle_commitments TO service_role;
GRANT ALL ON public.huddle_client_reviews TO service_role;

UPDATE public.huddle_settings
SET agenda = '[{"key":"wins","name":"Wins & Attendance","duration_s":120},{"key":"numbers","name":"Yesterday''s Numbers","duration_s":180},{"key":"clients","name":"Client Walkthrough","duration_s":720},{"key":"commitments","name":"Commitments","duration_s":180},{"key":"close","name":"Recap & Close","duration_s":60}]'::jsonb
WHERE singleton = true;

UPDATE public.huddles
SET agenda = '[{"key":"wins","name":"Wins & Attendance","duration_s":120},{"key":"numbers","name":"Yesterday''s Numbers","duration_s":180},{"key":"clients","name":"Client Walkthrough","duration_s":720},{"key":"commitments","name":"Commitments","duration_s":180},{"key":"close","name":"Recap & Close","duration_s":60}]'::jsonb,
    planned_duration_s = 1260,
    timer_state = jsonb_set(
      jsonb_set(
        COALESCE(timer_state, '{}'::jsonb),
        '{segment_index}',
        to_jsonb(LEAST(COALESCE((timer_state->>'segment_index')::int, 0), 4))
      ),
      '{sub_index}',
      COALESCE(timer_state->'sub_index', '0'::jsonb)
    )
WHERE date >= (CURRENT_DATE - INTERVAL '1 day')
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(public.huddles.agenda::jsonb, '[]'::jsonb)) AS segment
    WHERE segment->>'key' IN ('health', 'accountability', 'blockers')
  );