CREATE UNIQUE INDEX IF NOT EXISTS calendar_mappings_client_calendar_uidx
  ON public.calendar_mappings (client_id, ghl_calendar_id)
  WHERE client_id IS NOT NULL AND ghl_calendar_id IS NOT NULL;

INSERT INTO public.calendar_mappings (client_id, ghl_calendar_id, calendar_id, calendar_name)
VALUES (
  '18acd701-92ff-4bbc-86aa-1f7cd9a9c973',
  '5NMmbITnqFbds1yWP3TD',
  '5NMmbITnqFbds1yWP3TD',
  '30-min Discovery Call'
)
ON CONFLICT (client_id, ghl_calendar_id) WHERE client_id IS NOT NULL AND ghl_calendar_id IS NOT NULL
DO UPDATE SET calendar_id = EXCLUDED.calendar_id, calendar_name = EXCLUDED.calendar_name;