
-- =========================================================
-- Phase 1: AI Studio Agents — 3-layer knowledge model
-- =========================================================

-- 1. agency_agents (shared workforce)
CREATE TABLE public.agency_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL,
  icon text DEFAULT '🤖',
  default_model text NOT NULL DEFAULT 'nvidia/nemotron-3-ultra-550b-a55b:free',
  system_prompt text NOT NULL DEFAULT '',
  allowed_creative_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_agents TO authenticated;
GRANT ALL ON public.agency_agents TO service_role;
ALTER TABLE public.agency_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read agency agents"
  ON public.agency_agents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can manage agency agents"
  ON public.agency_agents FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER agency_agents_set_updated_at
  BEFORE UPDATE ON public.agency_agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 2. agency_agent_training (global training per agent)
CREATE TABLE public.agency_agent_training (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agency_agents(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('doc','url','note','example')),
  title text NOT NULL,
  body text,
  file_url text,
  weight integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agency_agent_training_agent_idx ON public.agency_agent_training(agent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_agent_training TO authenticated;
GRANT ALL ON public.agency_agent_training TO service_role;
ALTER TABLE public.agency_agent_training ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read agency agent training"
  ON public.agency_agent_training FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can manage agency agent training"
  ON public.agency_agent_training FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER agency_agent_training_set_updated_at
  BEFORE UPDATE ON public.agency_agent_training
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 3. client_brain (per-client shared memory)
CREATE TABLE public.client_brain (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  voice text,
  icp text,
  brand_guidelines text,
  do_not_say text,
  learnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_brain TO authenticated;
GRANT ALL ON public.client_brain TO service_role;
ALTER TABLE public.client_brain ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read client brain"
  ON public.client_brain FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can manage client brain"
  ON public.client_brain FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER client_brain_set_updated_at
  BEFORE UPDATE ON public.client_brain
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 4. client_offer_training (per-offer training, typed by creative kind)
CREATE TABLE public.client_offer_training (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.client_offers(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  creative_type text NOT NULL CHECK (creative_type IN ('static','video','copy','reporting','media_buying')),
  title text NOT NULL,
  body text,
  asset_url text,
  source_canvas_item_id uuid,
  weight integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_offer_training_offer_idx ON public.client_offer_training(offer_id);
CREATE INDEX client_offer_training_client_idx ON public.client_offer_training(client_id);
CREATE INDEX client_offer_training_type_idx ON public.client_offer_training(creative_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_offer_training TO authenticated;
GRANT ALL ON public.client_offer_training TO service_role;
ALTER TABLE public.client_offer_training ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read offer training"
  ON public.client_offer_training FOR SELECT TO authenticated USING (true);
CREATE POLICY "Team can manage offer training"
  ON public.client_offer_training FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER client_offer_training_set_updated_at
  BEFORE UPDATE ON public.client_offer_training
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =========================================================
-- Seed: 5 default agency agents (Nemotron 3 Ultra as default model)
-- =========================================================
INSERT INTO public.agency_agents (slug, name, role, icon, default_model, system_prompt, allowed_creative_types, sort_order) VALUES
  ('media_buyer', 'Media Buyer', 'Plans, launches, and optimizes paid media across Meta. Owns budget, targeting, scaling, and kill decisions.', '📈', 'nvidia/nemotron-3-ultra-550b-a55b:free',
   'You are the agency Media Buyer. You optimize spend, CPL, CPA, and ROAS across Meta. Use the Client Brain for voice/ICP and the Offer context for funnel + target CPA. Be specific, numeric, and decisive.',
   ARRAY['media_buying','reporting'], 10),
  ('reporting', 'Reporting Analyst', 'Pulls metrics, explains trends, and writes weekly/monthly performance reports.', '📊', 'nvidia/nemotron-3-ultra-550b-a55b:free',
   'You are the agency Reporting Analyst. You read live metrics from the database and explain what changed, why, and what to do next. Always cite numbers and date ranges.',
   ARRAY['reporting'], 20),
  ('static_ads', 'Static Ads Specialist', 'Designs and iterates static image ads — hooks, headlines, layouts, formats.', '🖼️', 'nvidia/nemotron-3-ultra-550b-a55b:free',
   'You are the agency Static Ads Specialist. Use the Client Brain and Offer context to produce on-brand static creative concepts and direction. Reference past winning statics from training when available.',
   ARRAY['static','copy'], 30),
  ('video_ads', 'Video Ads Specialist', 'Writes scripts, storyboards, and directs short-form video ads (Reels, UGC, VSLs).', '🎬', 'nvidia/nemotron-3-ultra-550b-a55b:free',
   'You are the agency Video Ads Specialist. Produce scripts and shot direction tuned to the offer. Reference past winning video ads from training. Default to 15s vertical unless told otherwise.',
   ARRAY['video','copy'], 40),
  ('copywriter', 'Copywriter', 'Writes ad copy, hooks, headlines, captions, and long-form sales copy.', '✍️', 'nvidia/nemotron-3-ultra-550b-a55b:free',
   'You are the agency Copywriter. Write in the Client Brain voice. Match the Offer''s positioning, CTAs, and compliance rules. Never use the word "guaranteed" for investment offers.',
   ARRAY['copy','static','video'], 50);
