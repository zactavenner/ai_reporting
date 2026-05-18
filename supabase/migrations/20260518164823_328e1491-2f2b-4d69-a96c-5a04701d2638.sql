DO $$
DECLARE
  cid_text text := '055eea03-76b7-4e6b-aa1d-6fbd2719e532';
  r record;
  coltype text;
BEGIN
  FOR r IN
    SELECT c.table_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'client_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('clients','client_settings')
  LOOP
    IF r.data_type = 'uuid' THEN
      EXECUTE format('DELETE FROM public.%I WHERE client_id = $1::uuid', r.table_name) USING cid_text;
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE client_id = $1', r.table_name) USING cid_text;
    END IF;
  END LOOP;
END $$;