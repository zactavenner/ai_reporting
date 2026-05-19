CREATE TABLE IF NOT EXISTS public.onboarding_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('slack', 'email', 'whatsapp', 'sms', 'system')),
  recipient text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'pending')),
  phase text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_notifications_client_created
  ON public.onboarding_notifications (client_id, created_at DESC);

ALTER TABLE public.onboarding_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all reads" ON public.onboarding_notifications;
CREATE POLICY "allow all reads" ON public.onboarding_notifications FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow inserts" ON public.onboarding_notifications;
CREATE POLICY "allow inserts" ON public.onboarding_notifications FOR INSERT WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.onboarding_notifications;