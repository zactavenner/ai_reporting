
-- ============ client_weekly_calls ============
CREATE TABLE public.client_weekly_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_of date NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  planned_duration_s integer NOT NULL DEFAULT 1800,
  actual_duration_s integer,
  facilitator_id uuid,
  summary_text text,
  avg_rating numeric,
  agenda jsonb NOT NULL DEFAULT '[]'::jsonb,
  timer_state jsonb NOT NULL DEFAULT '{"segment_index":0,"segment_started_at":null,"paused_at":null,"paused_elapsed_s":0,"auto_advance":false,"running":false,"finished":false,"extra_s":0}'::jsonb,
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, week_of)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_weekly_calls TO authenticated, anon;
GRANT ALL ON public.client_weekly_calls TO service_role;
ALTER TABLE public.client_weekly_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read client_weekly_calls" ON public.client_weekly_calls FOR SELECT USING (true);
CREATE POLICY "Public write client_weekly_calls" ON public.client_weekly_calls FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_client_weekly_calls_updated
  BEFORE UPDATE ON public.client_weekly_calls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_client_weekly_calls_client_week ON public.client_weekly_calls (client_id, week_of DESC);

-- ============ client_weekly_call_items ============
CREATE TABLE public.client_weekly_call_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.client_weekly_calls(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL,
  member_id uuid,
  member_name text,
  text text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_weekly_call_items TO authenticated, anon;
GRANT ALL ON public.client_weekly_call_items TO service_role;
ALTER TABLE public.client_weekly_call_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read client_weekly_call_items" ON public.client_weekly_call_items FOR SELECT USING (true);
CREATE POLICY "Public write client_weekly_call_items" ON public.client_weekly_call_items FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_cwci_call ON public.client_weekly_call_items (call_id, kind);

-- ============ client_weekly_call_tasks ============
CREATE TABLE public.client_weekly_call_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.client_weekly_calls(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  action text NOT NULL DEFAULT 'reviewed',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_weekly_call_tasks TO authenticated, anon;
GRANT ALL ON public.client_weekly_call_tasks TO service_role;
ALTER TABLE public.client_weekly_call_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read client_weekly_call_tasks" ON public.client_weekly_call_tasks FOR SELECT USING (true);
CREATE POLICY "Public write client_weekly_call_tasks" ON public.client_weekly_call_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_cwct_call ON public.client_weekly_call_tasks (call_id);

-- ============ client_weekly_call_ratings ============
CREATE TABLE public.client_weekly_call_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.client_weekly_calls(id) ON DELETE CASCADE,
  member_id uuid,
  member_name text,
  rating integer NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_weekly_call_ratings TO authenticated, anon;
GRANT ALL ON public.client_weekly_call_ratings TO service_role;
ALTER TABLE public.client_weekly_call_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read client_weekly_call_ratings" ON public.client_weekly_call_ratings FOR SELECT USING (true);
CREATE POLICY "Public write client_weekly_call_ratings" ON public.client_weekly_call_ratings FOR ALL USING (true) WITH CHECK (true);

-- ============ client_weekly_call_attendance ============
CREATE TABLE public.client_weekly_call_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.client_weekly_calls(id) ON DELETE CASCADE,
  member_id uuid,
  member_name text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_weekly_call_attendance TO authenticated, anon;
GRANT ALL ON public.client_weekly_call_attendance TO service_role;
ALTER TABLE public.client_weekly_call_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read client_weekly_call_attendance" ON public.client_weekly_call_attendance FOR SELECT USING (true);
CREATE POLICY "Public write client_weekly_call_attendance" ON public.client_weekly_call_attendance FOR ALL USING (true) WITH CHECK (true);

-- ============ client_weekly_call_settings ============
CREATE TABLE public.client_weekly_call_settings (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  agenda jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_weekly_call_settings TO authenticated, anon;
GRANT ALL ON public.client_weekly_call_settings TO service_role;
ALTER TABLE public.client_weekly_call_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read client_weekly_call_settings" ON public.client_weekly_call_settings FOR SELECT USING (true);
CREATE POLICY "Public write client_weekly_call_settings" ON public.client_weekly_call_settings FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_client_weekly_call_settings_updated
  BEFORE UPDATE ON public.client_weekly_call_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_weekly_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_weekly_call_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_weekly_call_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_weekly_call_ratings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_weekly_call_attendance;
