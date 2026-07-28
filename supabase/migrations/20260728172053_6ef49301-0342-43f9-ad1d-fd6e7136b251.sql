CREATE TABLE public.whatsapp_send_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.whatsapp_sessions(id) ON DELETE SET NULL,
  jid TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  alert_type TEXT,
  client_id UUID,
  task_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_send_queue_status_check CHECK (status IN ('pending','sent','failed','dead','sending'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_send_queue TO authenticated;
GRANT ALL ON public.whatsapp_send_queue TO service_role;

ALTER TABLE public.whatsapp_send_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read queue"
  ON public.whatsapp_send_queue FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert queue"
  ON public.whatsapp_send_queue FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated update queue"
  ON public.whatsapp_send_queue FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX whatsapp_send_queue_due_idx
  ON public.whatsapp_send_queue (status, next_attempt_at)
  WHERE status IN ('pending','failed');

CREATE INDEX whatsapp_send_queue_session_idx
  ON public.whatsapp_send_queue (session_id, status);

CREATE TRIGGER trg_whatsapp_send_queue_updated_at
  BEFORE UPDATE ON public.whatsapp_send_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();