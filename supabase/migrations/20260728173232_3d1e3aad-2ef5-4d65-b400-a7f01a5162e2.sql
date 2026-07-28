ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS linked_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes text;
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_linked_client ON public.whatsapp_contacts(linked_client_id);