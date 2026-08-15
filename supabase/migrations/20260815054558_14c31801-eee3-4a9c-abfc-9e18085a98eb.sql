-- ── 1. Generalize the agency report destinations to WhatsApp + SMS ─────────
ALTER TABLE public.agency_report_destinations
  ALTER COLUMN expected_subject DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS contact_name text;

ALTER TABLE public.agency_report_destinations
  DROP CONSTRAINT IF EXISTS agency_report_destinations_channel_check;
ALTER TABLE public.agency_report_destinations
  ADD CONSTRAINT agency_report_destinations_channel_check
  CHECK (channel IN ('whatsapp', 'sms'));

ALTER TABLE public.agency_report_destinations
  DROP CONSTRAINT IF EXISTS agency_report_destinations_valid_target;
ALTER TABLE public.agency_report_destinations
  ADD CONSTRAINT agency_report_destinations_valid_target CHECK (
    (channel = 'whatsapp' AND expected_subject IS NOT NULL
      AND (whatsapp_jid IS NULL OR whatsapp_jid ~ '@g\.us$'))
    OR
    (channel = 'sms' AND phone_e164 IS NOT NULL AND phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
  );

CREATE UNIQUE INDEX IF NOT EXISTS agency_report_destinations_sms_phone_key
  ON public.agency_report_destinations (channel, phone_e164)
  WHERE channel = 'sms';

-- Active SMS destination for the agency GHL route. The inactive WhatsApp
-- destination row is preserved untouched.
INSERT INTO public.agency_report_destinations
  (name, channel, phone_e164, contact_name, cadences, active, session_label)
VALUES
  ('Zac · Agency GHL SMS', 'sms', '+19167097345', 'Zac', ARRAY['daily'], true, 'default')
ON CONFLICT (channel, phone_e164) WHERE channel = 'sms'
DO UPDATE SET name = EXCLUDED.name, contact_name = EXCLUDED.contact_name,
              cadences = EXCLUDED.cadences, active = true, updated_at = now();

-- ── 2. Coordinator ledgers ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_daily_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','finalizing','completed','degraded','failed','timed_out')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  tick_count integer NOT NULL DEFAULT 0,
  clients_total integer NOT NULL DEFAULT 0,
  clients_valid integer NOT NULL DEFAULT 0,
  clients_unavailable integer NOT NULL DEFAULT 0,
  clients_failed integer NOT NULL DEFAULT 0,
  delivery jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.agency_daily_report_runs TO service_role;
ALTER TABLE public.agency_daily_report_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_daily_report_runs service role only"
  ON public.agency_daily_report_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_agency_daily_report_runs_updated
  BEFORE UPDATE ON public.agency_daily_report_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.agency_daily_report_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_run_id uuid NOT NULL REFERENCES public.agency_daily_report_runs(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name text,
  report_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','dispatched','completed','validation_failed','error','timed_out')),
  attempts integer NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  completed_at timestamptz,
  validation_passed boolean,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_run_id, client_id)
);
GRANT ALL ON public.agency_daily_report_clients TO service_role;
ALTER TABLE public.agency_daily_report_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_daily_report_clients service role only"
  ON public.agency_daily_report_clients FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_agency_daily_report_clients_updated
  BEFORE UPDATE ON public.agency_daily_report_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS agency_daily_report_clients_status_idx
  ON public.agency_daily_report_clients (report_date, status);

-- ── 3. Per-chunk send ledger (partial retries never re-send) ───────────────
CREATE TABLE IF NOT EXISTS public.agency_report_send_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES public.agency_report_sends(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  chunk_count integer NOT NULL DEFAULT 1,
  chars integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (send_id, chunk_index)
);
GRANT ALL ON public.agency_report_send_chunks TO service_role;
ALTER TABLE public.agency_report_send_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_report_send_chunks service role only"
  ON public.agency_report_send_chunks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER trg_agency_report_send_chunks_updated
  BEFORE UPDATE ON public.agency_report_send_chunks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX IF NOT EXISTS agency_report_sends_idempotency_key_uidx
  ON public.agency_report_sends (idempotency_key);

-- ── 4. Scheduler ───────────────────────────────────────────────────────────
SELECT cron.unschedule('daily-kpi-sms-zac')       WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='daily-kpi-sms-zac');
SELECT cron.unschedule('daily-report-run-1300utc') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='daily-report-run-1300utc');
SELECT cron.unschedule('daily-report-run-1400utc') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='daily-report-run-1400utc');
SELECT cron.unschedule('agency-daily-report-coordinator')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='agency-daily-report-coordinator');

SELECT cron.schedule(
  'agency-daily-report-coordinator',
  '*/2 11-13 * * *',
  $$
  SELECT net.http_post(
    url := 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/agency-daily-report-coordinator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', (SELECT secret FROM public.integration_secrets WHERE provider = 'daily_report_run' LIMIT 1)
    ),
    body := jsonb_build_object('source', 'cron')
  );
  $$
);