ALTER TABLE public.client_offers
  ADD COLUMN IF NOT EXISTS offer_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS offer_review_notes text;

CREATE INDEX IF NOT EXISTS idx_client_offers_reviewed
  ON public.client_offers (client_id, offer_reviewed_at DESC);