
ALTER TABLE public.agency_agents
  ADD COLUMN IF NOT EXISTS fallback_models text[] NOT NULL DEFAULT '{}'::text[];

INSERT INTO public.agency_agents (slug, name, role, icon, default_model, system_prompt, allowed_creative_types, is_active, sort_order, memory_md, instructions_md, connectors, capabilities, fallback_models)
SELECT
  'account_manager',
  'Jarvis (Account Manager)',
  'Customer success lead. Talks to every specialist agent, relays client feedback, and routes work. All cross-agent chatter lands in the All Channels Inbox.',
  '🤵',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'You are Jarvis, the account manager for High Performance Ads. You coordinate the Media Buyer, Reporting, Static, Video, and Copywriter specialists on behalf of each client. Summarize, ask clarifying questions, and route action items to the right specialist. Surface every cross-agent exchange in the All Channels Inbox.',
  ARRAY['copy','reporting'],
  true,
  5,
  '',
  '',
  '["slack","whatsapp","ghl","meta","google-sheets"]'::jsonb,
  '{"models": ["nvidia/nemotron-3-ultra-550b-a55b:free", "openai/gpt-5"]}'::jsonb,
  ARRAY['google/gemini-2.5-pro','openai/gpt-5']
WHERE NOT EXISTS (SELECT 1 FROM public.agency_agents WHERE slug = 'account_manager');

UPDATE public.agency_agents
   SET capabilities = '{"models": ["nvidia/nemotron-3-ultra-550b-a55b:free", "openai/gpt-image-2", "google/gemini-3.1-flash-image"]}'::jsonb,
       fallback_models = ARRAY['google/gemini-2.5-pro','openai/gpt-5']
 WHERE slug = 'static_ads';

UPDATE public.agency_agents
   SET capabilities = '{"models": ["nvidia/nemotron-3-ultra-550b-a55b:free", "bytedance/seedance-2.0-fast", "alibaba/happyhorse-1.1", "x-ai/grok-imagine-video"]}'::jsonb,
       fallback_models = ARRAY['google/gemini-2.5-pro','openai/gpt-5']
 WHERE slug = 'video_ads';

UPDATE public.agency_agents
   SET capabilities = '{"models": ["nvidia/nemotron-3-ultra-550b-a55b:free", "openai/gpt-5", "google/gemini-2.5-pro"]}'::jsonb,
       fallback_models = ARRAY['openai/gpt-5','google/gemini-2.5-pro']
 WHERE slug = 'copywriter';

UPDATE public.agency_agents
   SET fallback_models = ARRAY['openai/gpt-5','google/gemini-2.5-pro']
 WHERE slug IN ('media_buyer','reporting') AND coalesce(array_length(fallback_models,1),0) = 0;
