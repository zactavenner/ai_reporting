CREATE TABLE public.jarvis_goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  goal text not null,
  client_id uuid references public.clients(id) on delete set null,
  created_by uuid,
  status text not null default 'queued',
  iteration integer not null default 0,
  max_iterations integer not null default 200,
  state jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  report_md text,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE TABLE public.jarvis_goal_events (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.jarvis_goals(id) on delete cascade,
  kind text not null,
  title text,
  content text,
  data jsonb,
  created_at timestamptz not null default now()
);

CREATE INDEX idx_jarvis_goals_status ON public.jarvis_goals(status, last_heartbeat_at);
CREATE INDEX idx_jarvis_goal_events_goal ON public.jarvis_goal_events(goal_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_goals TO authenticated;
GRANT ALL ON public.jarvis_goals TO service_role;
GRANT SELECT, INSERT ON public.jarvis_goal_events TO authenticated;
GRANT ALL ON public.jarvis_goal_events TO service_role;

ALTER TABLE public.jarvis_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_goal_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team can manage jarvis goals" ON public.jarvis_goals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team can read jarvis goal events" ON public.jarvis_goal_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "team can add jarvis goal events" ON public.jarvis_goal_events FOR INSERT TO authenticated WITH CHECK (true);

CREATE TRIGGER trg_jarvis_goals_updated BEFORE UPDATE ON public.jarvis_goals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.jarvis_goal_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.jarvis_goals;