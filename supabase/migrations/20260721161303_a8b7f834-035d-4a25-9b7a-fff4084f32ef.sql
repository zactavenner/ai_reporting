UPDATE public.huddle_settings
SET agenda = '[
  {"key":"wins","name":"Wins & Attendance","duration_s":120},
  {"key":"numbers","name":"Yesterday''s Numbers","duration_s":180},
  {"key":"clients","name":"Client Walkthrough","duration_s":720},
  {"key":"commitments","name":"Commitments","duration_s":180},
  {"key":"close","name":"Recap & Close","duration_s":60}
]'::jsonb
WHERE singleton = true;