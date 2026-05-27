
CREATE OR REPLACE FUNCTION public.get_top_performers(p_client_ids uuid[] DEFAULT NULL)
RETURNS TABLE(
  scope text,
  entity_id uuid,
  meta_id text,
  name text,
  client_id uuid,
  spend numeric,
  leads integer,
  funded integer,
  funded_dollars numeric,
  cost_per_lead numeric,
  cost_per_funded numeric,
  thumbnail_url text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH camp AS (
    SELECT 'campaign'::text AS scope, c.id AS entity_id, c.meta_campaign_id AS meta_id,
           c.name, c.client_id, c.spend,
           COALESCE(c.attributed_leads, 0) AS leads,
           COALESCE(c.attributed_funded, 0) AS funded,
           COALESCE(c.attributed_funded_dollars, 0) AS funded_dollars,
           COALESCE(c.cost_per_lead, 0) AS cost_per_lead,
           COALESCE(c.cost_per_funded, 0) AS cost_per_funded,
           NULL::text AS thumbnail_url
    FROM public.meta_campaigns c
    WHERE (p_client_ids IS NULL OR c.client_id = ANY(p_client_ids))
      AND COALESCE(c.spend, 0) > 0
    ORDER BY COALESCE(c.attributed_funded_dollars, 0) DESC,
             CASE WHEN COALESCE(c.cost_per_lead, 0) > 0 THEN c.cost_per_lead ELSE 1e9 END ASC
    LIMIT 1
  ),
  adset AS (
    SELECT 'adset'::text AS scope, s.id, s.meta_adset_id, s.name, s.client_id, s.spend,
           COALESCE(s.attributed_leads, 0),
           COALESCE(s.attributed_funded, 0),
           COALESCE(s.attributed_funded_dollars, 0),
           COALESCE(s.cost_per_lead, 0),
           COALESCE(s.cost_per_funded, 0),
           NULL::text
    FROM public.meta_ad_sets s
    WHERE (p_client_ids IS NULL OR s.client_id = ANY(p_client_ids))
      AND COALESCE(s.spend, 0) > 0
    ORDER BY COALESCE(s.attributed_funded_dollars, 0) DESC,
             CASE WHEN COALESCE(s.cost_per_lead, 0) > 0 THEN s.cost_per_lead ELSE 1e9 END ASC
    LIMIT 1
  ),
  ad AS (
    SELECT 'ad'::text AS scope, a.id, a.meta_ad_id, a.name, a.client_id, a.spend,
           COALESCE(a.attributed_leads, 0),
           COALESCE(a.attributed_funded, 0),
           COALESCE(a.attributed_funded_dollars, 0),
           COALESCE(a.cost_per_lead, 0),
           COALESCE(a.cost_per_funded, 0),
           COALESCE(a.thumbnail_url, a.video_thumbnail_url, a.image_url)
    FROM public.meta_ads a
    WHERE (p_client_ids IS NULL OR a.client_id = ANY(p_client_ids))
      AND COALESCE(a.spend, 0) > 0
    ORDER BY COALESCE(a.attributed_funded_dollars, 0) DESC,
             CASE WHEN COALESCE(a.cost_per_lead, 0) > 0 THEN a.cost_per_lead ELSE 1e9 END ASC
    LIMIT 1
  )
  SELECT * FROM camp
  UNION ALL SELECT * FROM adset
  UNION ALL SELECT * FROM ad;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_performers(uuid[]) TO authenticated, anon, service_role;
