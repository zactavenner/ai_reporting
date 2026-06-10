
-- Allow anon (team-member dashboard token context) to manage GLOBAL references (client_id IS NULL).
-- The app currently runs without a Supabase auth session for team members, so anon is the runtime role.

CREATE POLICY "Anon can read global image references"
ON public.ai_studio_reference_images
FOR SELECT TO anon
USING (client_id IS NULL);

CREATE POLICY "Anon can insert global image references"
ON public.ai_studio_reference_images
FOR INSERT TO anon
WITH CHECK (client_id IS NULL AND created_by IS NULL);

CREATE POLICY "Anon can delete global image references"
ON public.ai_studio_reference_images
FOR DELETE TO anon
USING (client_id IS NULL AND created_by IS NULL);

CREATE POLICY "Anon can read global video references"
ON public.ai_studio_reference_videos
FOR SELECT TO anon
USING (client_id IS NULL);

CREATE POLICY "Anon can insert global video references"
ON public.ai_studio_reference_videos
FOR INSERT TO anon
WITH CHECK (client_id IS NULL AND created_by IS NULL);

CREATE POLICY "Anon can delete global video references"
ON public.ai_studio_reference_videos
FOR DELETE TO anon
USING (client_id IS NULL AND created_by IS NULL);
