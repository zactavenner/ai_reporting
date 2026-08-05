CREATE OR REPLACE FUNCTION public.get_client_spend_days(p_client_id uuid, p_from date, p_to date)
RETURNS TABLE(date date, spend numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.date, SUM(COALESCE(d.spend, 0))::numeric AS spend
  FROM public.ad_spend_daily d
  WHERE d.client_id = p_client_id
    AND d.date >= p_from
    AND d.date <= p_to
  GROUP BY d.date
  ORDER BY d.date;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_spend_days(uuid, date, date) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_client_spend_freshness(p_client_id uuid)
RETURNS TABLE(sync_date date, finished_at timestamptz, status text, sheet_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.sync_date, r.finished_at, r.status, r.sheet_status
  FROM public.ad_spend_sync_runs r
  WHERE r.client_id = p_client_id
  ORDER BY r.finished_at DESC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_spend_freshness(uuid) TO anon, authenticated, service_role;