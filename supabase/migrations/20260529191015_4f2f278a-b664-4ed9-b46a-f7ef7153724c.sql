DROP POLICY IF EXISTS "Authenticated can insert client team members" ON public.client_team_members;
DROP POLICY IF EXISTS "Authenticated can update client team members" ON public.client_team_members;
DROP POLICY IF EXISTS "Authenticated can delete client team members" ON public.client_team_members;

CREATE POLICY "Anyone can insert client team members" ON public.client_team_members FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update client team members" ON public.client_team_members FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete client team members" ON public.client_team_members FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_team_members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_team_members TO authenticated;