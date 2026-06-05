ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS notification_email text,
  ADD COLUMN IF NOT EXISTS notification_phone text;