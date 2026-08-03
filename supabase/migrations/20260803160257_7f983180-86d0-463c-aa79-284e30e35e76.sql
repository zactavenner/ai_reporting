UPDATE public.agency_agents SET default_model = 'openrouter/deepseek/deepseek-v4-flash-latest' WHERE default_model = 'openrouter/deepseek/deepseek-v4-flash';
UPDATE public.agents SET model = 'openrouter/deepseek/deepseek-v4-flash-latest' WHERE model = 'openrouter/deepseek/deepseek-v4-flash';
UPDATE public.client_agents SET model = 'openrouter/deepseek/deepseek-v4-flash-latest' WHERE model = 'openrouter/deepseek/deepseek-v4-flash';
UPDATE public.agency_settings SET jarvis_model = 'openrouter/deepseek/deepseek-v4-flash-latest' WHERE jarvis_model = 'openrouter/deepseek/deepseek-v4-flash';