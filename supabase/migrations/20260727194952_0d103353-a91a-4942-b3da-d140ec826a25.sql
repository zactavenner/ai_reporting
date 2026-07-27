CREATE TABLE public.task_notification_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  member_id UUID REFERENCES public.agency_members(id) ON DELETE SET NULL,
  notification_id UUID REFERENCES public.task_notifications(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms','email','slack','in_app','whatsapp')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  provider TEXT,
  recipient TEXT,
  subject TEXT,
  message TEXT,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  kind TEXT,
  triggered_by TEXT,
  provider_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tnd_task ON public.task_notification_deliveries(task_id, created_at DESC);
CREATE INDEX idx_tnd_member ON public.task_notification_deliveries(member_id, created_at DESC);
CREATE INDEX idx_tnd_status ON public.task_notification_deliveries(status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.task_notification_deliveries TO authenticated;
GRANT ALL ON public.task_notification_deliveries TO service_role;

ALTER TABLE public.task_notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read deliveries"
  ON public.task_notification_deliveries FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authenticated can insert deliveries"
  ON public.task_notification_deliveries FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated can update deliveries"
  ON public.task_notification_deliveries FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_tnd_updated_at
  BEFORE UPDATE ON public.task_notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();