-- Fix: Reset ad_spend to NULL for recent daily_metrics rows where ad_spend = 0
-- and the Meta sync hasn't actually run yet. This allows the gap detection in
-- sync-meta-ads-daily to correctly identify these dates as needing sync.
--
-- Only affects the last 3 days (where $0 is likely a placeholder from
-- recalculate-daily-metrics, not a genuine $0 spend day).
UPDATE public.daily_metrics
SET ad_spend = NULL
WHERE ad_spend = 0
  AND date >= (CURRENT_DATE - INTERVAL '3 days')
  AND date <= CURRENT_DATE
  AND client_id IN (
    SELECT id FROM public.clients
    WHERE meta_ad_account_id IS NOT NULL
      AND status IN ('active', 'onboarding', 'paused')
  );
