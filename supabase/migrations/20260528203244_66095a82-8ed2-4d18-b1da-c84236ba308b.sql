
CREATE TABLE public.client_team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  email text,
  phone text,
  is_primary_contact boolean NOT NULL DEFAULT false,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX client_team_members_client_id_idx ON public.client_team_members(client_id);

GRANT SELECT ON public.client_team_members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_team_members TO authenticated;
GRANT ALL ON public.client_team_members TO service_role;

ALTER TABLE public.client_team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view client team members"
  ON public.client_team_members FOR SELECT
  USING (true);

CREATE POLICY "Authenticated can insert client team members"
  ON public.client_team_members FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update client team members"
  ON public.client_team_members FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated can delete client team members"
  ON public.client_team_members FOR DELETE
  TO authenticated USING (true);

CREATE TRIGGER update_client_team_members_updated_at
  BEFORE UPDATE ON public.client_team_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
