CREATE POLICY "agent_files_read_auth"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'agent-files');
CREATE POLICY "agent_files_insert_auth"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'agent-files');
CREATE POLICY "agent_files_update_auth"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'agent-files') WITH CHECK (bucket_id = 'agent-files');
CREATE POLICY "agent_files_delete_auth"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'agent-files');