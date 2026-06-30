
UPDATE public.agency_agents
SET fallback_models = ARRAY(
  SELECT CASE WHEN m = 'nvidia/nemotron-3-ultra:free' THEN 'nvidia/nemotron-3-ultra-550b-a55b:free' ELSE m END
  FROM unnest(fallback_models) AS m
)
WHERE 'nvidia/nemotron-3-ultra:free' = ANY(fallback_models);
