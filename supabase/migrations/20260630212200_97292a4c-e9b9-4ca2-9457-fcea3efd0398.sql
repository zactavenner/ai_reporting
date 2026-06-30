
UPDATE agency_agents SET default_model = 'nvidia/nemotron-3-ultra:free' WHERE default_model ILIKE '%owl%';
UPDATE agency_agents SET fallback_models = array_replace(fallback_models, 'openrouter/owl-alpha', 'nvidia/nemotron-3-ultra:free') WHERE 'openrouter/owl-alpha' = ANY(fallback_models);
UPDATE agents SET model = 'nvidia/nemotron-3-ultra:free' WHERE model ILIKE '%owl%';
UPDATE client_agents SET model = 'nvidia/nemotron-3-ultra:free' WHERE model ILIKE '%owl%';
UPDATE agency_settings SET default_chat_model = 'nvidia/nemotron-3-ultra:free' WHERE default_chat_model ILIKE '%owl%';
UPDATE ai_studio_conversations SET chat_model = 'nvidia/nemotron-3-ultra:free' WHERE chat_model ILIKE '%owl%';
