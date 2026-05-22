CREATE OR REPLACE FUNCTION public.find_unenriched_leads(p_client_id uuid, p_limit int DEFAULT 50)
RETURNS TABLE (id uuid, external_id text, name text, email text, phone text)
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.id, l.external_id, l.name, l.email, l.phone
  FROM public.leads l
  WHERE l.client_id = p_client_id
    AND l.external_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_enrichment le
      WHERE le.client_id = p_client_id AND le.external_id = l.external_id
    )
  ORDER BY l.created_at DESC
  LIMIT p_limit;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-enrich-all-every-15m') THEN
    PERFORM cron.unschedule('auto-enrich-all-every-15m');
  END IF;
END $$;

SELECT cron.schedule(
  'auto-enrich-all-every-15m',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/auto-enrich-all',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnd3dtdHV2amxtemFwd3FpYWJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NDkzODIsImV4cCI6MjA4MzMyNTM4Mn0.STFrUoif30xXQCjabc3skP6_tTnVIATwHhwWxeZoUr4"}'::jsonb,
    body:='{"per_client": 50}'::jsonb
  ) AS request_id;
  $$
);