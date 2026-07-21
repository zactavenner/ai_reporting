
-- Huddle 2.0: commitments + per-client reviews + huddles metadata

CREATE TABLE IF NOT EXISTS public.huddle_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  member_id uuid,
  member_name text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  commitment text NOT NULL,
  for_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_commitments TO authenticated;
GRANT ALL ON public.huddle_commitments TO service_role;
ALTER TABLE public.huddle_commitments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth rw huddle_commitments" ON public.huddle_commitments;
CREATE POLICY "auth rw huddle_commitments" ON public.huddle_commitments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS huddle_commitments_huddle_idx ON public.huddle_commitments(huddle_id);
CREATE INDEX IF NOT EXISTS huddle_commitments_for_date_idx ON public.huddle_commitments(for_date);
CREATE INDEX IF NOT EXISTS huddle_commitments_member_idx ON public.huddle_commitments(member_id);

DROP TRIGGER IF EXISTS trg_huddle_commitments_updated ON public.huddle_commitments;
CREATE TRIGGER trg_huddle_commitments_updated
  BEFORE UPDATE ON public.huddle_commitments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE IF NOT EXISTS public.huddle_client_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huddle_id uuid NOT NULL REFERENCES public.huddles(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending | reviewed | skipped
  duration_s int,
  notes text,
  ai_summary text,
  ai_action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(huddle_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.huddle_client_reviews TO authenticated;
GRANT ALL ON public.huddle_client_reviews TO service_role;
ALTER TABLE public.huddle_client_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth rw huddle_client_reviews" ON public.huddle_client_reviews;
CREATE POLICY "auth rw huddle_client_reviews" ON public.huddle_client_reviews
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS huddle_client_reviews_huddle_idx ON public.huddle_client_reviews(huddle_id);
CREATE INDEX IF NOT EXISTS huddle_client_reviews_client_idx ON public.huddle_client_reviews(client_id);

DROP TRIGGER IF EXISTS trg_huddle_client_reviews_updated ON public.huddle_client_reviews;
CREATE TRIGGER trg_huddle_client_reviews_updated
  BEFORE UPDATE ON public.huddle_client_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Extend huddles with recording / transcript / AI title metadata
ALTER TABLE public.huddles
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS finalize_status text,
  ADD COLUMN IF NOT EXISTS proposed_tasks jsonb NOT NULL DEFAULT '[]'::jsonb;
