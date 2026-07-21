INSERT INTO public.huddle_settings (singleton, agenda)
VALUES (
  true,
  '[{"key":"wins","name":"Wins & Attendance","duration_s":120},{"key":"numbers","name":"Yesterday''s Numbers","duration_s":180},{"key":"clients","name":"Client Walkthrough","duration_s":720},{"key":"commitments","name":"Commitments","duration_s":180},{"key":"close","name":"Recap & Close","duration_s":60}]'::jsonb
)
ON CONFLICT (singleton) DO UPDATE
SET agenda = EXCLUDED.agenda;