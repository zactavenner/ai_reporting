
UPDATE public.huddle_settings
SET agenda = '[
  {"key":"wins","name":"Wins & Attendance","duration_s":120},
  {"key":"clients","name":"Client Walkthrough","duration_s":720},
  {"key":"close","name":"Recap & Close","duration_s":120}
]'::jsonb
WHERE singleton = true;

-- Fix any in-flight huddles that still have the removed commitments segment
UPDATE public.huddles
SET agenda = '[
  {"key":"wins","name":"Wins & Attendance","duration_s":120},
  {"key":"clients","name":"Client Walkthrough","duration_s":720},
  {"key":"close","name":"Recap & Close","duration_s":120}
]'::jsonb,
    planned_duration_s = 960
WHERE status IN ('scheduled','in_progress')
  AND agenda::text LIKE '%commitments%';
