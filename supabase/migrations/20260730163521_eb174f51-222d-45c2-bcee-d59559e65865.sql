ALTER TABLE public.client_settings
  ADD COLUMN IF NOT EXISTS call_workflow_webhook_url text,
  ADD COLUMN IF NOT EXISTS outbound_caller_number text;

CREATE UNIQUE INDEX IF NOT EXISTS contact_timeline_events_ghl_msg_uniq
  ON public.contact_timeline_events (client_id, (metadata->>'ghl_message_id'))
  WHERE metadata->>'ghl_message_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS contact_timeline_events_lead_at_idx
  ON public.contact_timeline_events (lead_id, event_at DESC);