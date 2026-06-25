ALTER TABLE public.agency_settings
ADD COLUMN IF NOT EXISTS openrouter_api_key text;
