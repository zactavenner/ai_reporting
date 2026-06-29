
ALTER TABLE public.client_settings
  ADD COLUMN IF NOT EXISTS stripe_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_status text,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_error text,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_payments_count integer,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_subscriptions_count integer,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_total_paid numeric,
  ADD COLUMN IF NOT EXISTS stripe_last_sync_mrr numeric;
