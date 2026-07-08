-- RPC used by bulk-enrich-account-worker to do a true SQL anti-join
-- instead of pulling 50-100k rows into memory and filtering in JS.
--
-- Returns up to p_limit leads that have NO lead_enrichment record with
-- last_enriched_at >= p_cutoff (i.e. they are "stale" or never enriched).
CREATE OR REPLACE FUNCTION public.get_unenriched_leads(
  p_client_id uuid,
  p_cutoff     timestamptz,
  p_limit      integer DEFAULT 25
)
RETURNS TABLE (
  id          uuid,
  external_id text,
  name        text,
  email       text,
  phone       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    l.id,
    l.external_id,
    l.name,
    l.email,
    l.phone
  FROM public.leads l
  LEFT JOIN public.lead_enrichment e
         ON e.client_id   = l.client_id
        AND e.external_id = l.external_id
        AND e.last_enriched_at >= p_cutoff
  WHERE l.client_id    = p_client_id
    AND l.external_id IS NOT NULL
    AND e.external_id IS NULL        -- anti-join: exclude recently enriched
  ORDER BY l.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_unenriched_leads(uuid, timestamptz, integer) TO service_role;
