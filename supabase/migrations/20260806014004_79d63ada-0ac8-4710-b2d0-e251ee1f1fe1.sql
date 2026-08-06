ALTER TABLE public.h3_creatives
  ADD COLUMN IF NOT EXISTS provider_generation_id text;

COMMENT ON COLUMN public.h3_creatives.provider_generation_id IS
  'Provider-side generation id returned by OpenRouter GET /api/v1/videos/{id} (generation_id). Distinct from internal_generation_id, which is ours.';