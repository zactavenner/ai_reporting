
-- ============ whatsapp_sessions ============
CREATE TABLE public.whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL DEFAULT 'default',
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected', -- disconnected | qr | connecting | connected | logged_out | error
  last_qr text,
  last_qr_at timestamptz,
  last_connected_at timestamptz,
  last_error text,
  bridge_meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_sessions TO authenticated;
GRANT ALL ON public.whatsapp_sessions TO service_role;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage whatsapp_sessions"
  ON public.whatsapp_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_whatsapp_sessions_updated
  BEFORE UPDATE ON public.whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed one default session row
INSERT INTO public.whatsapp_sessions (label) VALUES ('default');

-- ============ whatsapp_contacts ============
CREATE TABLE public.whatsapp_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
  jid text NOT NULL,             -- e.g. 14155551234@s.whatsapp.net or @g.us
  is_group boolean NOT NULL DEFAULT false,
  phone text,
  display_name text,
  push_name text,
  avatar_url text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, jid)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_contacts TO authenticated;
GRANT ALL ON public.whatsapp_contacts TO service_role;
ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage whatsapp_contacts"
  ON public.whatsapp_contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_wa_contacts_session ON public.whatsapp_contacts(session_id, last_message_at DESC);

CREATE TRIGGER trg_whatsapp_contacts_updated
  BEFORE UPDATE ON public.whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ whatsapp_messages ============
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.whatsapp_sessions(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.whatsapp_contacts(id) ON DELETE SET NULL,
  jid text NOT NULL,
  wa_message_id text,            -- WhatsApp's own id (for dedupe)
  direction text NOT NULL,       -- 'inbound' | 'outbound'
  body text,
  media_url text,
  media_mime text,
  message_type text NOT NULL DEFAULT 'text', -- text | image | video | audio | document | other
  sender_jid text,               -- who sent it (for group context)
  sender_name text,
  team_member_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received', -- received | queued | sent | delivered | read | failed
  error text,
  wa_timestamp timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, wa_message_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can manage whatsapp_messages"
  ON public.whatsapp_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_wa_messages_thread ON public.whatsapp_messages(session_id, jid, wa_timestamp DESC);
CREATE INDEX idx_wa_messages_contact ON public.whatsapp_messages(contact_id, wa_timestamp DESC);
