
-- ============ Billing Agreements ============
CREATE TABLE IF NOT EXISTS public.billing_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  billing_type text NOT NULL DEFAULT 'retainer',
  base_fee numeric(12,2) DEFAULT 0,
  setup_fee numeric(12,2) DEFAULT 0,
  remaining_setup_fee numeric(12,2) DEFAULT 0,
  included_ad_spend numeric(12,2) DEFAULT 0,
  variable_fee_percentage numeric(6,3) DEFAULT 0,
  performance_fee_percentage numeric(6,3) DEFAULT 0,
  billing_frequency text DEFAULT 'monthly',
  billing_day int DEFAULT 1,
  auto_charge boolean DEFAULT true,
  approval_required boolean DEFAULT false,
  contract_start_date date,
  contract_end_date date,
  notes text,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_agreements TO authenticated;
GRANT ALL ON public.billing_agreements TO service_role;
ALTER TABLE public.billing_agreements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can manage billing_agreements" ON public.billing_agreements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_billing_agreements_client ON public.billing_agreements(client_id);

-- ============ Billing Invoices ============
CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_number text,
  billing_period_start date,
  billing_period_end date,
  issue_date date,
  due_date date,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  amount_outstanding numeric(12,2) GENERATED ALWAYS AS (amount - amount_paid) STORED,
  status text NOT NULL DEFAULT 'draft',
  paid_date date,
  stripe_invoice_id text,
  hosted_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_invoices TO authenticated;
GRANT ALL ON public.billing_invoices TO service_role;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can manage billing_invoices" ON public.billing_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_stripe ON public.billing_invoices(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_invoices_client ON public.billing_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_status ON public.billing_invoices(status);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_due ON public.billing_invoices(due_date);

-- ============ Billing Line Items ============
CREATE TABLE IF NOT EXISTS public.billing_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  type text NOT NULL,
  description text,
  quantity numeric(12,3) DEFAULT 1,
  rate numeric(12,2) DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  calculation_source jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_line_items TO authenticated;
GRANT ALL ON public.billing_line_items TO service_role;
ALTER TABLE public.billing_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can manage billing_line_items" ON public.billing_line_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_billing_line_items_invoice ON public.billing_line_items(invoice_id);

-- ============ Billing Payments ============
CREATE TABLE IF NOT EXISTS public.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES public.billing_invoices(id) ON DELETE SET NULL,
  payment_date timestamptz,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text,
  status text NOT NULL DEFAULT 'pending',
  failure_reason text,
  next_retry_date timestamptz,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_payments TO authenticated;
GRANT ALL ON public.billing_payments TO service_role;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can manage billing_payments" ON public.billing_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_pi ON public.billing_payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_charge ON public.billing_payments(stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_payments_client ON public.billing_payments(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_status ON public.billing_payments(status);

-- ============ Billing Actions Queue ============
CREATE TABLE IF NOT EXISTS public.billing_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  priority int NOT NULL DEFAULT 3,
  amount numeric(12,2),
  due_date date,
  assigned_to uuid,
  status text NOT NULL DEFAULT 'open',
  notes text,
  related_invoice_id uuid REFERENCES public.billing_invoices(id) ON DELETE SET NULL,
  related_payment_id uuid REFERENCES public.billing_payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_actions TO authenticated;
GRANT ALL ON public.billing_actions TO service_role;
ALTER TABLE public.billing_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can manage billing_actions" ON public.billing_actions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_billing_actions_status ON public.billing_actions(status, priority, due_date);
CREATE INDEX IF NOT EXISTS idx_billing_actions_client ON public.billing_actions(client_id);

-- ============ Billing Notifications (internal AM alerts) ============
CREATE TABLE IF NOT EXISTS public.billing_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  account_manager_id uuid,
  payment_id uuid REFERENCES public.billing_payments(id) ON DELETE SET NULL,
  notification_type text NOT NULL,
  channel text NOT NULL,
  recipient text,
  subject text,
  body text,
  delivery_status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error_message text,
  stripe_event_id text,
  deduplication_key text NOT NULL,
  retry_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_notifications TO authenticated;
GRANT ALL ON public.billing_notifications TO service_role;
ALTER TABLE public.billing_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can manage billing_notifications" ON public.billing_notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_notifications_dedup ON public.billing_notifications(deduplication_key, channel);
CREATE INDEX IF NOT EXISTS idx_billing_notifications_client ON public.billing_notifications(client_id);

-- ============ Stripe Webhook Events ============
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  object_id text,
  payload jsonb,
  processing_status text NOT NULL DEFAULT 'received',
  processed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stripe_webhook_events TO authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can read stripe_webhook_events" ON public.stripe_webhook_events FOR SELECT TO authenticated USING (true);

-- ============ Billing Audit Log ============
CREATE TABLE IF NOT EXISTS public.billing_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  client_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_audit_log TO authenticated;
GRANT ALL ON public.billing_audit_log TO service_role;
ALTER TABLE public.billing_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can read billing_audit_log" ON public.billing_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "service can write billing_audit_log" ON public.billing_audit_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_billing_audit_client ON public.billing_audit_log(client_id, created_at DESC);

-- ============ updated_at triggers ============
DROP TRIGGER IF EXISTS trg_billing_agreements_updated ON public.billing_agreements;
CREATE TRIGGER trg_billing_agreements_updated BEFORE UPDATE ON public.billing_agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_billing_invoices_updated ON public.billing_invoices;
CREATE TRIGGER trg_billing_invoices_updated BEFORE UPDATE ON public.billing_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_billing_payments_updated ON public.billing_payments;
CREATE TRIGGER trg_billing_payments_updated BEFORE UPDATE ON public.billing_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_billing_actions_updated ON public.billing_actions;
CREATE TRIGGER trg_billing_actions_updated BEFORE UPDATE ON public.billing_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
