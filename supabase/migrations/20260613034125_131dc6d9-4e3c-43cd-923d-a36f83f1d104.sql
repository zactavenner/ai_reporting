ALTER TABLE public.agency_settings 
  ADD COLUMN IF NOT EXISTS whatsapp_owner_number TEXT DEFAULT '+19167097345',
  ADD COLUMN IF NOT EXISTS eod_send_to_hermes BOOLEAN DEFAULT TRUE;

UPDATE public.agency_settings SET whatsapp_owner_number = COALESCE(whatsapp_owner_number, '+19167097345') WHERE whatsapp_owner_number IS NULL;