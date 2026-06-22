ALTER TABLE public.client_offer_files
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS role text;

COMMENT ON COLUMN public.client_offer_files.tags IS 'Free-form tags: product, lifestyle, logo, testimonial, background, etc.';
COMMENT ON COLUMN public.client_offer_files.role IS 'Primary semantic role used as reference hint when feeding into AI prompts.';

CREATE INDEX IF NOT EXISTS client_offer_files_tags_idx ON public.client_offer_files USING gin (tags);