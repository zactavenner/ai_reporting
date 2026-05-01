-- Add crm_leads column to daily_metrics for tracking total CRM lead count
-- (all leads regardless of spam status or contact info completeness).
-- This complements the existing leads column which counts non-spam leads only.
ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS crm_leads INTEGER DEFAULT 0;
