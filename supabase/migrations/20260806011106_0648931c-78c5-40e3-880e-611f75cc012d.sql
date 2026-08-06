CREATE TYPE public.h3_workflow_state AS ENUM (
  'draft','claim_review','submitted','rendering','downloaded','qa','ready_for_review','approved','meta_ready'
);

CREATE TYPE public.h3_rejection_category AS ENUM (
  'claim_violation','off_script','audio_issue','caption_issue','disclosure_missing',
  'avatar_continuity','visual_artifact','duration_mismatch','resolution_mismatch','other'
);

CREATE TABLE public.h3_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  campaign_ref text,
  notes text,
  requires_counsel_review boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.h3_runs TO authenticated;
GRANT ALL ON public.h3_runs TO service_role;
ALTER TABLE public.h3_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage h3 runs" ON public.h3_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.h3_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.h3_runs(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  campaign_ref text,
  concept text NOT NULL,
  provider text NOT NULL DEFAULT 'OpenRouter / MiniMax Hailuo 3',
  model text NOT NULL DEFAULT 'minimax/hailuo-3',
  external_job_id text,
  internal_generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  polling_ref text,
  first_frame_asset_url text,
  prompt text,
  approved_script text,
  approved_script_version integer,
  provider_status text NOT NULL DEFAULT 'pending',
  workflow_state public.h3_workflow_state NOT NULL DEFAULT 'draft',
  provider_error text,
  cost_amount numeric,
  cost_currency text,
  source_asset_url text,
  final_asset_url text,
  aspect_ratio text NOT NULL DEFAULT '9:16',
  duration_seconds integer NOT NULL DEFAULT 15,
  source_resolution text NOT NULL DEFAULT '2K',
  final_resolution text NOT NULL DEFAULT '720x1280',
  audio_expected boolean NOT NULL DEFAULT true,
  transcript text,
  captions_embedded boolean NOT NULL DEFAULT false,
  disclosures_embedded boolean NOT NULL DEFAULT false,
  automated_qa jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_qa_status text,
  rejection_category public.h3_rejection_category,
  rejection_reason text,
  submitted_by uuid,
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  counsel_signoff_by uuid,
  counsel_signoff_at timestamptz,
  counsel_review_required boolean NOT NULL DEFAULT true,
  meta_ad_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_job_id)
);

CREATE INDEX idx_h3_creatives_run ON public.h3_creatives(run_id);
CREATE INDEX idx_h3_creatives_state ON public.h3_creatives(workflow_state);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.h3_creatives TO authenticated;
GRANT ALL ON public.h3_creatives TO service_role;
ALTER TABLE public.h3_creatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage h3 creatives" ON public.h3_creatives FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.h3_script_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES public.h3_creatives(id) ON DELETE CASCADE,
  version integer NOT NULL,
  script text NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creative_id, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.h3_script_revisions TO authenticated;
GRANT ALL ON public.h3_script_revisions TO service_role;
ALTER TABLE public.h3_script_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage h3 script revisions" ON public.h3_script_revisions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.h3_creative_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES public.h3_creatives(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_state public.h3_workflow_state,
  to_state public.h3_workflow_state,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_h3_events_creative ON public.h3_creative_events(creative_id, created_at DESC);

GRANT SELECT, INSERT ON public.h3_creative_events TO authenticated;
GRANT ALL ON public.h3_creative_events TO service_role;
ALTER TABLE public.h3_creative_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read h3 events" ON public.h3_creative_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff add h3 events" ON public.h3_creative_events FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.h3_enforce_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ord text[] := ARRAY['draft','claim_review','submitted','rendering','downloaded','qa','ready_for_review','approved','meta_ready'];
  old_i int;
  new_i int;
BEGIN
  IF NEW.workflow_state = OLD.workflow_state THEN
    RETURN NEW;
  END IF;
  old_i := array_position(ord, OLD.workflow_state::text);
  new_i := array_position(ord, NEW.workflow_state::text);

  IF new_i < old_i THEN
    IF NEW.workflow_state <> 'draft' THEN
      RAISE EXCEPTION 'H3 rejection may only return a creative to draft';
    END IF;
    IF NEW.rejection_category IS NULL OR NEW.rejection_reason IS NULL OR length(trim(NEW.rejection_reason)) = 0 THEN
      RAISE EXCEPTION 'H3 rejection requires a categorized reason';
    END IF;
    RETURN NEW;
  END IF;

  IF new_i <> old_i + 1 THEN
    RAISE EXCEPTION 'H3 workflow cannot skip states (% -> %)', OLD.workflow_state, NEW.workflow_state;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_h3_enforce_state_machine
  BEFORE UPDATE ON public.h3_creatives
  FOR EACH ROW EXECUTE FUNCTION public.h3_enforce_state_machine();

CREATE TRIGGER trg_h3_runs_updated_at BEFORE UPDATE ON public.h3_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_h3_creatives_updated_at BEFORE UPDATE ON public.h3_creatives
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();