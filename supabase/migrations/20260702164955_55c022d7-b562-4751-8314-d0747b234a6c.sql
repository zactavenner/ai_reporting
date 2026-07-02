
UPDATE public.agency_agents
SET default_model = 'nvidia/nemotron-3-ultra-550b-a55b:free'
WHERE default_model IN ('nvidia/nemotron-3-ultra:free', 'nvidia/nemotron-3-ultra');

-- connectors is jsonb array. Rebuild it, filtering out dead ones.
UPDATE public.agency_agents
SET connectors = COALESCE(
  (
    SELECT jsonb_agg(v)
    FROM jsonb_array_elements_text(connectors) AS v
    WHERE v NOT IN ('stripe','slack','whatsapp','notion','google-drive','wave','openrouter','database')
  ),
  '[]'::jsonb
);

UPDATE public.agency_agents
SET connectors = '["meta","ghl","google-sheets","fathom"]'::jsonb
WHERE slug = 'account_manager';

UPDATE public.agency_agents
SET connectors = COALESCE(
  (
    SELECT jsonb_agg(DISTINCT v)
    FROM jsonb_array_elements_text(connectors || '["fathom"]'::jsonb) AS v
  ),
  '["fathom"]'::jsonb
)
WHERE slug IN ('reporting','media_buyer');
