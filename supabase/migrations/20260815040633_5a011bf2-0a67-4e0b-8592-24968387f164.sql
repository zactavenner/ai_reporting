-- Authoritative WhatsApp group subjects synced from the bridge (server truth).
CREATE TABLE IF NOT EXISTS public.whatsapp_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
  session_label text NOT NULL DEFAULT 'default',
  jid text NOT NULL,
  subject text NOT NULL,
  participant_count integer,
  is_announce boolean DEFAULT false,
  subject_set_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_label, jid)
);
GRANT ALL ON public.whatsapp_groups TO service_role;
ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;

-- Agency-level digest destinations (not per-client recipients).
CREATE TABLE IF NOT EXISTS public.agency_digest_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp_group',
  destination text NOT NULL,
  session_label text NOT NULL DEFAULT 'default',
  enabled boolean NOT NULL DEFAULT false,
  cadences text[] NOT NULL DEFAULT ARRAY['daily'],
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, destination, session_label)
);
GRANT ALL ON public.agency_digest_targets TO service_role;
ALTER TABLE public.agency_digest_targets ENABLE ROW LEVEL SECURITY;

-- Delivery audit trail with idempotency per agency+date+destination+cadence.
CREATE TABLE IF NOT EXISTS public.agency_digest_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid REFERENCES public.agency_digest_targets(id) ON DELETE CASCADE,
  cadence text NOT NULL DEFAULT 'daily',
  digest_date date NOT NULL,
  kind text NOT NULL DEFAULT 'daily_digest',
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  chunk_count integer NOT NULL DEFAULT 0,
  wa_message_ids text[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  queued_ids uuid[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.agency_digest_sends TO service_role;
ALTER TABLE public.agency_digest_sends ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS agency_digest_sends_date_idx ON public.agency_digest_sends (digest_date DESC);

DROP TRIGGER IF EXISTS agency_digest_targets_touch ON public.agency_digest_targets;
CREATE TRIGGER agency_digest_targets_touch BEFORE UPDATE ON public.agency_digest_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS agency_digest_sends_touch ON public.agency_digest_sends;
CREATE TRIGGER agency_digest_sends_touch BEFORE UPDATE ON public.agency_digest_sends
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();