
CREATE TABLE IF NOT EXISTS public.client_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.client_folders(id) ON DELETE CASCADE,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_folders_client ON public.client_folders(client_id);
CREATE INDEX IF NOT EXISTS idx_client_folders_parent ON public.client_folders(parent_id);

ALTER TABLE public.client_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view folders" ON public.client_folders FOR SELECT USING (true);
CREATE POLICY "Anyone can create folders" ON public.client_folders FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update folders" ON public.client_folders FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete folders" ON public.client_folders FOR DELETE USING (true);

CREATE TRIGGER trg_client_folders_updated_at
BEFORE UPDATE ON public.client_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.client_file_uploads
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.client_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_file_uploads_folder ON public.client_file_uploads(folder_id);
