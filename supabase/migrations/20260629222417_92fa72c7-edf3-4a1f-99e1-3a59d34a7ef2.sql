GRANT SELECT ON public.agency_agents TO anon;
DROP POLICY IF EXISTS "Public can read agency agents" ON public.agency_agents;
CREATE POLICY "Public can read agency agents" ON public.agency_agents FOR SELECT TO anon USING (true);

GRANT SELECT ON public.agency_agent_files TO anon;
DROP POLICY IF EXISTS "Public can read agent files metadata" ON public.agency_agent_files;
CREATE POLICY "Public can read agent files metadata" ON public.agency_agent_files FOR SELECT TO anon USING (client_id IS NULL);