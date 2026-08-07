CREATE TABLE IF NOT EXISTS public.client_drive_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  folder_id text NOT NULL,
  folder_name text,
  enabled boolean NOT NULL DEFAULT true,
  statuses text[] NOT NULL DEFAULT ARRAY['approved']::text[],
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, folder_id)
);

CREATE TABLE IF NOT EXISTS public.creative_drive_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES public.creatives(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  folder_id text NOT NULL,
  drive_file_id text,
  drive_file_name text,
  drive_web_link text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creative_id, folder_id)
);

CREATE INDEX IF NOT EXISTS creative_drive_uploads_client_idx ON public.creative_drive_uploads (client_id, status);

GRANT ALL ON public.client_drive_folders TO service_role;
GRANT ALL ON public.creative_drive_uploads TO service_role;
GRANT SELECT ON public.client_drive_folders TO authenticated;
GRANT SELECT ON public.creative_drive_uploads TO authenticated;

ALTER TABLE public.client_drive_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creative_drive_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view client drive folders"
  ON public.client_drive_folders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reporting_operator_users r WHERE r.user_id = auth.uid()));

CREATE POLICY "Operators can view creative drive uploads"
  ON public.creative_drive_uploads FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reporting_operator_users r WHERE r.user_id = auth.uid()));

INSERT INTO public.client_drive_folders (client_id, folder_id, folder_name, enabled, statuses)
VALUES ('a6212f58-0f1d-4d6a-9c1a-0e67163bb6a8', '1pKebZ4LZTBw025BP0uK4Sl6d7IEjVsMh', 'IPC Video Ads', true, ARRAY['approved']::text[])
ON CONFLICT (client_id, folder_id) DO UPDATE SET enabled = true, folder_name = EXCLUDED.folder_name, statuses = EXCLUDED.statuses, updated_at = now();