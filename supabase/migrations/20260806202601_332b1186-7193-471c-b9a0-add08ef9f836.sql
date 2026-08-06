ALTER TABLE public.client_offers
  ADD COLUMN IF NOT EXISTS offer_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS offer_review_notes text;

-- Remove the runaway near-identical onboarding statics for AMT Capital Fund 3,
-- keeping only the 10 most recent so the client is back inside budget.
DELETE FROM public.creatives c
 WHERE c.client_id = '9a1c113d-a65a-47de-b650-302318e98945'
   AND c.source = 'onboarding-build'
   AND c.id NOT IN (
     SELECT id FROM public.creatives
      WHERE client_id = '9a1c113d-a65a-47de-b650-302318e98945'
        AND source = 'onboarding-build'
      ORDER BY created_at DESC
      LIMIT 10
   );