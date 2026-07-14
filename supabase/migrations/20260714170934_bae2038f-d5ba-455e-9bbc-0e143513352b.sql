
-- Daily Huddle tables
CREATE TABLE public.huddles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  started_at timestamptz,
  ended_at timestamptz,
  planned_duration_s integer NOT NULL DEFAULT 900,
  actual_duration_s integer,
  facilitator_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  summary_text text,
  avg_rating numeric,
  agenda jsonb NOT NULL DEFAULT '[]'::jsonb,
  timer_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddles TO authenticated;
GRANT ALL ON public.huddles TO service_role;
ALTER TABLE public.huddles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read huddles" ON public.huddles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write huddles" ON public.huddles FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.huddle_wins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  member_name text,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_wins TO authenticated;
GRANT ALL ON public.huddle_wins TO service_role;
ALTER TABLE public.huddle_wins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read huddle_wins" ON public.huddle_wins FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write huddle_wins" ON public.huddle_wins FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.huddle_blockers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  member_name text,
  description text NOT NULL,
  unblocker_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  unblocker_name text,
  task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_blockers TO authenticated;
GRANT ALL ON public.huddle_blockers TO service_role;
ALTER TABLE public.huddle_blockers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read huddle_blockers" ON public.huddle_blockers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write huddle_blockers" ON public.huddle_blockers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.huddle_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  member_name text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  UNIQUE(huddle_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_attendance TO authenticated;
GRANT ALL ON public.huddle_attendance TO service_role;
ALTER TABLE public.huddle_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read huddle_attendance" ON public.huddle_attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write huddle_attendance" ON public.huddle_attendance FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.huddle_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.agency_members(id) ON DELETE SET NULL,
  member_name text,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 10),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(huddle_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_ratings TO authenticated;
GRANT ALL ON public.huddle_ratings TO service_role;
ALTER TABLE public.huddle_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read huddle_ratings" ON public.huddle_ratings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write huddle_ratings" ON public.huddle_ratings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.huddle_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  agenda jsonb NOT NULL DEFAULT '[
    {"key":"wins","name":"Wins","duration_s":120},
    {"key":"numbers","name":"Yesterday''s Numbers","duration_s":180},
    {"key":"health","name":"Client Health","duration_s":180},
    {"key":"accountability","name":"Accountability","duration_s":240},
    {"key":"blockers","name":"Blockers","duration_s":120},
    {"key":"close","name":"Close & Cascade","duration_s":60}
  ]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_settings TO authenticated;
GRANT ALL ON public.huddle_settings TO service_role;
ALTER TABLE public.huddle_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read huddle_settings" ON public.huddle_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write huddle_settings" ON public.huddle_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.huddle_settings (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE public.huddle_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  reason text,
  task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_flags TO authenticated;
GRANT ALL ON public.huddle_flags TO service_role;
ALTER TABLE public.huddle_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read huddle_flags" ON public.huddle_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write huddle_flags" ON public.huddle_flags FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Extend tasks
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS huddle_id uuid REFERENCES public.huddles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_huddle_id ON public.tasks(huddle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source_due ON public.tasks(source, due_date);

-- updated_at trigger
CREATE TRIGGER trg_huddles_updated_at BEFORE UPDATE ON public.huddles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER TABLE public.huddles REPLICA IDENTITY FULL;
ALTER TABLE public.huddle_wins REPLICA IDENTITY FULL;
ALTER TABLE public.huddle_blockers REPLICA IDENTITY FULL;
ALTER TABLE public.huddle_attendance REPLICA IDENTITY FULL;
ALTER TABLE public.huddle_ratings REPLICA IDENTITY FULL;
ALTER TABLE public.huddle_flags REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.huddles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.huddle_wins;
ALTER PUBLICATION supabase_realtime ADD TABLE public.huddle_blockers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.huddle_attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE public.huddle_ratings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.huddle_flags;
