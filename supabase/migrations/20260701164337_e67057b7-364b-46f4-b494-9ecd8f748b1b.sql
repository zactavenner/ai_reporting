
-- Allow anon (internal team-member sessions without Supabase auth) to write billing_targets
DROP POLICY IF EXISTS "billing_targets write authenticated" ON public.billing_targets;
CREATE POLICY "billing_targets write all" ON public.billing_targets
  FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_targets TO anon;

-- Add a manual MRR override so unlinked clients can be tracked without Stripe
ALTER TABLE public.client_settings
  ADD COLUMN IF NOT EXISTS manual_mrr numeric NOT NULL DEFAULT 0;
