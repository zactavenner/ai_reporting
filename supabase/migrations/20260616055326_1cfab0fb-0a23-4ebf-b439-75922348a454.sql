
-- 1. Remove old feedback table
DROP TABLE IF EXISTS public.app_feedback CASCADE;

-- 2. Email classification + priority enums
DO $$ BEGIN
  CREATE TYPE public.email_classification AS ENUM (
    'important_human','client','sales','partner_vendor','internal','newsletter','promotional','cold_outreach','spam','unclassified'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.email_priority AS ENUM ('high','medium','low','none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.email_draft_status AS ENUM ('pending','approved','sent','edited','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. gmail_accounts
CREATE TABLE public.gmail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text,
  owner_member_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  refresh_token text NOT NULL,
  access_token text,
  access_token_expires_at timestamptz,
  history_id text,
  last_synced_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_accounts TO authenticated;
GRANT ALL ON public.gmail_accounts TO service_role;
ALTER TABLE public.gmail_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team can read gmail_accounts" ON public.gmail_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "team can update gmail_accounts" ON public.gmail_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team can delete gmail_accounts" ON public.gmail_accounts FOR DELETE TO authenticated USING (true);
-- inserts only via edge function (service role)

-- Safe view for client (hides tokens)
CREATE OR REPLACE VIEW public.v_gmail_accounts AS
  SELECT id, email, display_name, owner_member_id, history_id, last_synced_at, status, created_at, updated_at
  FROM public.gmail_accounts;
GRANT SELECT ON public.v_gmail_accounts TO authenticated;

-- 4. emails
CREATE TABLE public.emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.gmail_accounts(id) ON DELETE CASCADE,
  gmail_id text NOT NULL,
  thread_id text,
  from_email text,
  from_name text,
  to_emails text[],
  cc_emails text[],
  subject text,
  snippet text,
  body_text text,
  body_html text,
  received_at timestamptz,
  labels text[],
  is_unread boolean DEFAULT true,
  is_archived boolean DEFAULT false,
  classification public.email_classification DEFAULT 'unclassified',
  priority public.email_priority DEFAULT 'none',
  requires_response boolean DEFAULT false,
  waiting_on_customer boolean DEFAULT false,
  auto_archived boolean DEFAULT false,
  classified_at timestamptz,
  responded_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, gmail_id)
);
CREATE INDEX idx_emails_account_received ON public.emails(account_id, received_at DESC);
CREATE INDEX idx_emails_classification ON public.emails(classification);
CREATE INDEX idx_emails_priority ON public.emails(priority);
CREATE INDEX idx_emails_archived ON public.emails(is_archived);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emails TO authenticated;
GRANT ALL ON public.emails TO service_role;
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manage emails" ON public.emails FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. email_drafts
CREATE TABLE public.email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  body text NOT NULL,
  confidence numeric,
  urgency public.email_priority DEFAULT 'medium',
  status public.email_draft_status DEFAULT 'pending',
  model text,
  sent_at timestamptz,
  edited_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_drafts_email ON public.email_drafts(email_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_drafts TO authenticated;
GRANT ALL ON public.email_drafts TO service_role;
ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manage drafts" ON public.email_drafts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. email_assignments
CREATE TABLE public.email_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  status text DEFAULT 'open',
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_assignments TO authenticated;
GRANT ALL ON public.email_assignments TO service_role;
ALTER TABLE public.email_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manage assignments" ON public.email_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 7. email_notes
CREATE TABLE public.email_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  body text NOT NULL,
  mentions uuid[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_notes TO authenticated;
GRANT ALL ON public.email_notes TO service_role;
ALTER TABLE public.email_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team manage notes" ON public.email_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 8. email_briefings
CREATE TABLE public.email_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_date date NOT NULL UNIQUE,
  summary text,
  top_emails jsonb DEFAULT '[]',
  pending_replies jsonb DEFAULT '[]',
  urgent_items jsonb DEFAULT '[]',
  follow_ups jsonb DEFAULT '[]',
  metrics jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_briefings TO authenticated;
GRANT ALL ON public.email_briefings TO service_role;
ALTER TABLE public.email_briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team read briefings" ON public.email_briefings FOR SELECT TO authenticated USING (true);

-- 9. email_sync_log
CREATE TABLE public.email_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.gmail_accounts(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  messages_synced int DEFAULT 0,
  messages_classified int DEFAULT 0,
  messages_auto_archived int DEFAULT 0,
  error_message text
);
GRANT SELECT ON public.email_sync_log TO authenticated;
GRANT ALL ON public.email_sync_log TO service_role;
ALTER TABLE public.email_sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team read sync log" ON public.email_sync_log FOR SELECT TO authenticated USING (true);

-- 10. updated_at triggers
CREATE TRIGGER trg_gmail_accounts_updated BEFORE UPDATE ON public.gmail_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_emails_updated BEFORE UPDATE ON public.emails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_email_drafts_updated BEFORE UPDATE ON public.email_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_email_assignments_updated BEFORE UPDATE ON public.email_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 11. realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.emails;
ALTER PUBLICATION supabase_realtime ADD TABLE public.email_drafts;
