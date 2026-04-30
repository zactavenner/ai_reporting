-- Fix get_client_source_metrics RPC:
-- 1. Handle NULL booked_at by falling back to created_at (legacy calls from GHL conversation sync)
-- 2. Handle NULL scheduled_at by falling back to booked_at then created_at
-- 3. Exclude cancelled calls from booked count (they were booked but aren't active appointments)
-- 4. Keep cancelled calls out of showed stats (already excluded by showed=false)

CREATE OR REPLACE FUNCTION public.get_client_source_metrics(
  p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(
  client_id uuid,
  total_leads bigint,
  spam_leads bigint,
  crm_leads bigint,
  total_calls bigint,
  showed_calls bigint,
  reconnect_calls bigint,
  reconnect_showed bigint,
  funded_count bigint,
  funded_dollars numeric,
  commitment_dollars numeric,
  avg_time_to_fund numeric,
  avg_calls_to_fund numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH lead_stats AS (
    SELECT
      l.client_id,
      -- Meta Leads: non-spam with both email and phone (high-quality from ad forms)
      COUNT(*) FILTER (
        WHERE NOT COALESCE(l.is_spam, false)
          AND l.email IS NOT NULL AND l.email != ''
          AND l.phone IS NOT NULL AND l.phone != ''
      ) AS total_leads,
      -- Spam leads
      COUNT(*) FILTER (WHERE COALESCE(l.is_spam, false)) AS spam_leads,
      -- CRM Leads: ALL leads regardless of contact info or spam status
      COUNT(*) AS crm_leads
    FROM public.leads l
    WHERE (p_start_date IS NULL OR l.created_at >= p_start_date::date)
      AND (p_end_date IS NULL OR l.created_at < p_end_date::date + interval '1 day')
    GROUP BY l.client_id
  ),
  -- Calls booked in date range (for total_calls and reconnect_calls)
  -- Use COALESCE(booked_at, created_at) to handle legacy calls without booked_at
  -- Exclude cancelled calls from booked counts
  booked_call_stats AS (
    SELECT
      c.client_id,
      COUNT(*) FILTER (
        WHERE NOT COALESCE(c.is_reconnect, false)
          AND COALESCE(c.outcome, '') NOT IN ('cancelled', 'canceled')
      ) AS total_calls,
      COUNT(*) FILTER (
        WHERE COALESCE(c.is_reconnect, false)
          AND COALESCE(c.outcome, '') NOT IN ('cancelled', 'canceled')
      ) AS reconnect_calls
    FROM public.calls c
    WHERE (p_start_date IS NULL OR COALESCE(c.booked_at, c.created_at) >= p_start_date::date)
      AND (p_end_date IS NULL OR COALESCE(c.booked_at, c.created_at) < p_end_date::date + interval '1 day')
    GROUP BY c.client_id
  ),
  -- Calls scheduled in date range where attendee showed (for showed_calls and reconnect_showed)
  -- Use COALESCE(scheduled_at, booked_at, created_at) to handle calls without scheduled_at
  showed_call_stats AS (
    SELECT
      c.client_id,
      COUNT(*) FILTER (
        WHERE COALESCE(c.showed, false) AND NOT COALESCE(c.is_reconnect, false)
      ) AS showed_calls,
      COUNT(*) FILTER (
        WHERE COALESCE(c.showed, false) AND COALESCE(c.is_reconnect, false)
      ) AS reconnect_showed
    FROM public.calls c
    WHERE (p_start_date IS NULL OR COALESCE(c.scheduled_at, c.booked_at, c.created_at) >= p_start_date::date)
      AND (p_end_date IS NULL OR COALESCE(c.scheduled_at, c.booked_at, c.created_at) < p_end_date::date + interval '1 day')
    GROUP BY c.client_id
  ),
  funded_stats AS (
    SELECT
      f.client_id,
      COUNT(*) AS funded_count,
      COALESCE(SUM(CASE WHEN f.funded_amount > 0 THEN f.funded_amount ELSE COALESCE(f.commitment_amount, 0) END), 0) AS funded_dollars,
      COALESCE(SUM(f.commitment_amount), 0) AS commitment_dollars,
      COALESCE(AVG(f.time_to_fund_days) FILTER (WHERE f.time_to_fund_days IS NOT NULL), 0) AS avg_time_to_fund,
      COALESCE(AVG(f.calls_to_fund), 0) AS avg_calls_to_fund
    FROM public.funded_investors f
    WHERE (p_start_date IS NULL OR f.funded_at >= p_start_date::date)
      AND (p_end_date IS NULL OR f.funded_at < p_end_date::date + interval '1 day')
    GROUP BY f.client_id
  )
  SELECT
    cl.id AS client_id,
    COALESCE(ls.total_leads, 0) AS total_leads,
    COALESCE(ls.spam_leads, 0) AS spam_leads,
    COALESCE(ls.crm_leads, 0) AS crm_leads,
    COALESCE(bcs.total_calls, 0) AS total_calls,
    COALESCE(scs.showed_calls, 0) AS showed_calls,
    COALESCE(bcs.reconnect_calls, 0) AS reconnect_calls,
    COALESCE(scs.reconnect_showed, 0) AS reconnect_showed,
    COALESCE(fs.funded_count, 0) AS funded_count,
    COALESCE(fs.funded_dollars, 0) AS funded_dollars,
    COALESCE(fs.commitment_dollars, 0) AS commitment_dollars,
    COALESCE(fs.avg_time_to_fund, 0) AS avg_time_to_fund,
    COALESCE(fs.avg_calls_to_fund, 0) AS avg_calls_to_fund
  FROM public.clients cl
  LEFT JOIN lead_stats ls ON ls.client_id = cl.id
  LEFT JOIN booked_call_stats bcs ON bcs.client_id = cl.id
  LEFT JOIN showed_call_stats scs ON scs.client_id = cl.id
  LEFT JOIN funded_stats fs ON fs.client_id = cl.id;
$function$;
