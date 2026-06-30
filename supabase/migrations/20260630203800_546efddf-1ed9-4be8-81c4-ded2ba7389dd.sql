GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_agreements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_invoices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_payments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_actions TO anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billing_agreements'
      AND policyname = 'dashboard can manage billing_agreements'
  ) THEN
    CREATE POLICY "dashboard can manage billing_agreements"
      ON public.billing_agreements
      FOR ALL
      TO anon
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billing_invoices'
      AND policyname = 'dashboard can manage billing_invoices'
  ) THEN
    CREATE POLICY "dashboard can manage billing_invoices"
      ON public.billing_invoices
      FOR ALL
      TO anon
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billing_payments'
      AND policyname = 'dashboard can manage billing_payments'
  ) THEN
    CREATE POLICY "dashboard can manage billing_payments"
      ON public.billing_payments
      FOR ALL
      TO anon
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'billing_actions'
      AND policyname = 'dashboard can manage billing_actions'
  ) THEN
    CREATE POLICY "dashboard can manage billing_actions"
      ON public.billing_actions
      FOR ALL
      TO anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;