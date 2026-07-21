
UPDATE public.huddle_settings
SET agenda = (
  SELECT jsonb_agg(seg)
  FROM jsonb_array_elements(agenda) seg
  WHERE seg->>'key' <> 'numbers'
)
WHERE singleton = true;

UPDATE public.huddles
SET agenda = (
  SELECT jsonb_agg(seg)
  FROM jsonb_array_elements(agenda) seg
  WHERE seg->>'key' <> 'numbers'
),
planned_duration_s = COALESCE((
  SELECT SUM((seg->>'duration_s')::int)
  FROM jsonb_array_elements(agenda) seg
  WHERE seg->>'key' <> 'numbers'
), planned_duration_s)
WHERE agenda @> '[{"key":"numbers"}]'::jsonb;
