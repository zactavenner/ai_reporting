ALTER TABLE public.agency_settings 
ADD COLUMN IF NOT EXISTS kpi_google_doc_url text,
ADD COLUMN IF NOT EXISTS kpi_google_sheet_url text;