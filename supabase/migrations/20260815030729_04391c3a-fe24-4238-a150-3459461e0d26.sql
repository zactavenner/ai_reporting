-- ============ PHASE 1: normalization contract, columns, views, run tables ============

CREATE OR REPLACE FUNCTION public.normalize_appointment_status(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(btrim(coalesce(p_status, '')))
    WHEN 'showed' THEN 'showed'
    WHEN 'completed' THEN 'showed'
    WHEN 'complete' THEN 'showed'
    WHEN 'attended' THEN 'showed'
    WHEN 'noshow' THEN 'noshow'
    WHEN 'no-show' THEN 'noshow'
    WHEN 'no_show' THEN 'noshow'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'canceled' THEN 'cancelled'
    WHEN 'rescheduled' THEN 'rescheduled'
    WHEN 'confirmed' THEN 'pending'
    WHEN 'booked' THEN 'pending'
    WHEN 'new' THEN 'pending'
    WHEN 'pending' THEN 'pending'
    WHEN 'invalid' THEN 'invalid'
    WHEN '' THEN 'pending'
    ELSE 'pending'
  END;
$$;

COMMENT ON FUNCTION public.normalize_appointment_status(text) IS
'Single documented normalizer for CRM appointment status. Only showed/completed/complete/attended normalize to showed. confirmed/booked/new/pending/empty => pending (never a show).';

CREATE OR REPLACE FUNCTION public.call_is_showed(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT public.normalize_appointment_status(p_status) = 'showed'; $$;

CREATE OR REPLACE FUNCTION public.call_is_eligible(p_status text, p_scheduled_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_scheduled_at IS NOT NULL
     AND p_scheduled_at < now()
     AND public.normalize_appointment_status(p_status) NOT IN ('cancelled','rescheduled','invalid');
$$;

COMMENT ON FUNCTION public.call_is_eligible(text, timestamptz) IS
'Eligible appointment for show-rate denominator: scheduled in the past and not cancelled/rescheduled/invalid.';

CREATE OR REPLACE FUNCTION public.lead_quality_normalize(
  p_status text, p_disposition text, p_is_spam boolean, p_quality_score numeric
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(p_is_spam, false) THEN 'bad'
    WHEN lower(coalesce(p_disposition,'')) ~ '(spam|invalid|duplicate|dupe|bad|junk|wrong number|do not|unqualified|not qualified)' THEN 'bad'
    WHEN lower(coalesce(p_status,'')) ~ '(spam|invalid|duplicate|dupe|junk|unqualified|disqualif)' THEN 'bad'
    WHEN p_quality_score IS NOT NULL AND p_quality_score > 0 AND p_quality_score < 40 THEN 'bad'
    WHEN lower(coalesce(p_disposition,'')) ~ '(qualified|booked|appointment|interested|nurture|contacted|connected|won|funded|committed)' THEN 'qualified'
    WHEN lower(coalesce(p_status,'')) ~ '(qualified|booked|appointment|interested|nurture|contacted|connected|won|funded|committed|open)' THEN 'qualified'
    WHEN p_quality_score IS NOT NULL AND p_quality_score >= 40 THEN 'qualified'
    ELSE 'pending'
  END;
$$;

COMMENT ON FUNCTION public.lead_quality_normalize(text, text, boolean, numeric) IS
'Single lead-quality normalizer returning exactly one of qualified | bad | pending. Precedence: is_spam > disposition > status > quality_score.';

-- ---- additive columns ----
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS attendance_source text,
  ADD COLUMN IF NOT EXISTS booked_at_missing boolean NOT NULL DEFAULT false;

ALTER TABLE public.funded_investors
  ADD COLUMN IF NOT EXISTS committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_verified_funded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_source text,
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_calls_client_booked_at ON public.calls (client_id, booked_at);
CREATE INDEX IF NOT EXISTS idx_calls_client_scheduled_at ON public.calls (client_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_funded_client_committed_at ON public.funded_investors (client_id, committed_at);
CREATE INDEX IF NOT EXISTS idx_funded_client_funded_at ON public.funded_investors (client_id, funded_at);

-- ---- repair log (per-row before values) ----
CREATE TABLE IF NOT EXISTS public.reporting_repair_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_key text NOT NULL,
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  client_id uuid,
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reporting_repair_log_key ON public.reporting_repair_log (repair_key, table_name);
GRANT ALL ON public.reporting_repair_log TO service_role;
ALTER TABLE public.reporting_repair_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages reporting_repair_log" ON public.reporting_repair_log;
CREATE POLICY "Service role manages reporting_repair_log" ON public.reporting_repair_log FOR ALL USING (true) WITH CHECK (true);

-- ---- daily run ledger ----
CREATE TABLE IF NOT EXISTS public.daily_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  status text NOT NULL DEFAULT 'running',
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb,
  anomalies jsonb NOT NULL DEFAULT '[]'::jsonb,
  freshness jsonb,
  reconciliation jsonb,
  report_json jsonb,
  narrative text,
  validation_passed boolean,
  delivered_at timestamptz,
  delivery_channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  dry_run boolean NOT NULL DEFAULT false,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_runs_client_date_key UNIQUE (client_id, report_date)
);
GRANT SELECT ON public.daily_report_runs TO authenticated;
GRANT ALL ON public.daily_report_runs TO service_role;
ALTER TABLE public.daily_report_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages daily_report_runs" ON public.daily_report_runs;
CREATE POLICY "Service role manages daily_report_runs" ON public.daily_report_runs FOR ALL USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_daily_report_runs_updated_at ON public.daily_report_runs;
CREATE TRIGGER trg_daily_report_runs_updated_at BEFORE UPDATE ON public.daily_report_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---- daily funnel view (deterministic source of truth) ----
CREATE OR REPLACE VIEW public.v_daily_funnel_day AS
WITH d AS (
  SELECT client_id, date FROM public.ad_spend_daily
  UNION SELECT client_id, (created_at AT TIME ZONE 'America/Los_Angeles')::date FROM public.leads
  UNION SELECT client_id, (booked_at AT TIME ZONE 'America/Los_Angeles')::date FROM public.calls WHERE booked_at IS NOT NULL
  UNION SELECT client_id, (scheduled_at AT TIME ZONE 'America/Los_Angeles')::date FROM public.calls WHERE scheduled_at IS NOT NULL
  UNION SELECT client_id, (funded_at AT TIME ZONE 'America/Los_Angeles')::date FROM public.funded_investors WHERE funded_at IS NOT NULL
  UNION SELECT client_id, (committed_at AT TIME ZONE 'America/Los_Angeles')::date FROM public.funded_investors WHERE committed_at IS NOT NULL
),
spend AS (
  SELECT client_id, date,
         sum(coalesce(spend,0))::numeric AS spend,
         sum(coalesce(impressions,0))::bigint AS impressions,
         sum(coalesce(clicks,0))::bigint AS clicks,
         sum(coalesce(leads,0))::bigint AS meta_leads,
         max(synced_at) AS spend_synced_at,
         count(*)::bigint AS spend_rows
  FROM public.ad_spend_daily GROUP BY 1,2
),
lead_rollup AS (
  SELECT client_id, (created_at AT TIME ZONE 'America/Los_Angeles')::date AS date,
         count(*)::bigint AS leads_total,
         count(*) FILTER (WHERE public.lead_quality_normalize(status, current_disposition, is_spam, quality_score) = 'qualified')::bigint AS leads_qualified,
         count(*) FILTER (WHERE public.lead_quality_normalize(status, current_disposition, is_spam, quality_score) = 'bad')::bigint AS leads_bad,
         count(*) FILTER (WHERE public.lead_quality_normalize(status, current_disposition, is_spam, quality_score) = 'pending')::bigint AS leads_pending
  FROM public.leads GROUP BY 1,2
),
booked AS (
  SELECT client_id, (booked_at AT TIME ZONE 'America/Los_Angeles')::date AS date,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = false)::bigint AS discovery_booked,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = true)::bigint AS reconnect_booked,
         count(*) FILTER (WHERE booked_at_missing)::bigint AS booked_at_missing_count
  FROM public.calls WHERE booked_at IS NOT NULL GROUP BY 1,2
),
attend AS (
  SELECT client_id, (scheduled_at AT TIME ZONE 'America/Los_Angeles')::date AS date,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = false AND public.call_is_eligible(appointment_status, scheduled_at))::bigint AS discovery_eligible,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = false AND public.call_is_showed(appointment_status))::bigint AS discovery_showed,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = false AND public.normalize_appointment_status(appointment_status) = 'noshow')::bigint AS discovery_noshow,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = false AND public.normalize_appointment_status(appointment_status) = 'pending' AND scheduled_at < now())::bigint AS discovery_unclassified,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = true AND public.call_is_eligible(appointment_status, scheduled_at))::bigint AS reconnect_eligible,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = true AND public.call_is_showed(appointment_status))::bigint AS reconnect_showed,
         count(*) FILTER (WHERE coalesce(is_reconnect,false) = true AND public.normalize_appointment_status(appointment_status) = 'noshow')::bigint AS reconnect_noshow
  FROM public.calls WHERE scheduled_at IS NOT NULL GROUP BY 1,2
),
commits AS (
  SELECT client_id, (committed_at AT TIME ZONE 'America/Los_Angeles')::date AS date,
         count(*)::bigint AS commitments,
         sum(coalesce(commitment_amount,0))::numeric AS commitment_dollars
  FROM public.funded_investors
  WHERE committed_at IS NOT NULL AND coalesce(commitment_amount,0) > 0
  GROUP BY 1,2
),
funded AS (
  SELECT client_id, (funded_at AT TIME ZONE 'America/Los_Angeles')::date AS date,
         count(*)::bigint AS funded_count,
         sum(coalesce(funded_amount,0))::numeric AS funded_dollars
  FROM public.funded_investors
  WHERE funded_at IS NOT NULL AND is_verified_funded = true AND coalesce(funded_amount,0) > 0
  GROUP BY 1,2
)
SELECT
  d.client_id,
  d.date,
  coalesce(s.spend, 0)::numeric AS spend,
  coalesce(s.impressions, 0)::bigint AS impressions,
  coalesce(s.clicks, 0)::bigint AS clicks,
  CASE WHEN coalesce(s.impressions,0) > 0 THEN round((s.clicks::numeric / s.impressions::numeric) * 100, 4) ELSE 0 END AS ctr,
  coalesce(s.meta_leads, 0)::bigint AS meta_leads,
  coalesce(s.spend_rows, 0)::bigint AS spend_rows,
  s.spend_synced_at,
  coalesce(l.leads_total, 0)::bigint AS leads_total,
  coalesce(l.leads_qualified, 0)::bigint AS leads_qualified,
  coalesce(l.leads_bad, 0)::bigint AS leads_bad,
  coalesce(l.leads_pending, 0)::bigint AS leads_pending,
  CASE WHEN coalesce(l.leads_total,0) > 0 THEN round(coalesce(s.spend,0) / l.leads_total, 2) ELSE 0 END AS cost_per_lead,
  coalesce(b.discovery_booked, 0)::bigint AS discovery_booked,
  coalesce(b.reconnect_booked, 0)::bigint AS reconnect_booked,
  coalesce(b.booked_at_missing_count, 0)::bigint AS booked_at_missing_count,
  coalesce(a.discovery_eligible, 0)::bigint AS discovery_eligible,
  coalesce(a.discovery_showed, 0)::bigint AS discovery_showed,
  coalesce(a.discovery_noshow, 0)::bigint AS discovery_noshow,
  coalesce(a.discovery_unclassified, 0)::bigint AS discovery_unclassified,
  CASE WHEN coalesce(a.discovery_eligible,0) > 0 THEN round((a.discovery_showed::numeric / a.discovery_eligible::numeric) * 100, 2) ELSE NULL END AS discovery_show_rate,
  coalesce(a.reconnect_eligible, 0)::bigint AS reconnect_eligible,
  coalesce(a.reconnect_showed, 0)::bigint AS reconnect_showed,
  coalesce(a.reconnect_noshow, 0)::bigint AS reconnect_noshow,
  CASE WHEN coalesce(a.reconnect_eligible,0) > 0 THEN round((a.reconnect_showed::numeric / a.reconnect_eligible::numeric) * 100, 2) ELSE NULL END AS reconnect_show_rate,
  coalesce(c.commitments, 0)::bigint AS commitments,
  coalesce(c.commitment_dollars, 0)::numeric AS commitment_dollars,
  coalesce(f.funded_count, 0)::bigint AS funded_count,
  coalesce(f.funded_dollars, 0)::numeric AS funded_dollars,
  CASE WHEN coalesce(a.discovery_showed,0) > 0 THEN round(coalesce(s.spend,0) / a.discovery_showed, 2) ELSE 0 END AS cost_per_showed,
  CASE WHEN coalesce(f.funded_count,0) > 0 THEN round(coalesce(s.spend,0) / f.funded_count, 2) ELSE 0 END AS cost_per_funded
FROM d
LEFT JOIN spend s ON s.client_id = d.client_id AND s.date = d.date
LEFT JOIN lead_rollup l ON l.client_id = d.client_id AND l.date = d.date
LEFT JOIN booked b ON b.client_id = d.client_id AND b.date = d.date
LEFT JOIN attend a ON a.client_id = d.client_id AND a.date = d.date
LEFT JOIN commits c ON c.client_id = d.client_id AND c.date = d.date
LEFT JOIN funded f ON f.client_id = d.client_id AND f.date = d.date
WHERE d.date IS NOT NULL;

COMMENT ON VIEW public.v_daily_funnel_day IS
'Deterministic daily funnel per client in America/Los_Angeles buckets. Booked by booked_at; attendance/eligibility by scheduled_at; commitments by committed_at; funded requires is_verified_funded and funded_amount > 0; Meta metrics from ad_spend_daily.';

CREATE OR REPLACE VIEW public.v_daily_funnel_freshness AS
SELECT
  c.id AS client_id,
  c.name AS client_name,
  (SELECT max(synced_at) FROM public.ad_spend_daily a WHERE a.client_id = c.id) AS meta_last_synced_at,
  (SELECT max(date) FROM public.ad_spend_daily a WHERE a.client_id = c.id) AS meta_last_date,
  (SELECT count(*) FROM public.ad_spend_daily a WHERE a.client_id = c.id
     AND a.date = ((now() AT TIME ZONE 'America/Los_Angeles')::date - 1)) AS meta_rows_yesterday,
  c.last_ghl_sync_at AS ghl_last_synced_at,
  (SELECT max(ghl_synced_at) FROM public.calls k WHERE k.client_id = c.id) AS calls_last_synced_at,
  (SELECT max(created_at) FROM public.leads l WHERE l.client_id = c.id) AS leads_last_created_at,
  (SELECT count(*) FROM public.calls k WHERE k.client_id = c.id AND k.booked_at_missing) AS calls_missing_booked_at,
  (SELECT count(*) FROM public.calls k WHERE k.client_id = c.id AND k.showed = true
     AND NOT public.call_is_showed(k.appointment_status)) AS calls_false_showed,
  (SELECT count(*) FROM public.funded_investors f WHERE f.client_id = c.id
     AND f.is_verified_funded = false) AS funded_unverified,
  (SELECT count(*) FROM public.funded_investors f WHERE f.client_id = c.id
     AND coalesce(f.commitment_amount,0) > 0 AND f.committed_at IS NULL) AS commitments_missing_committed_at
FROM public.clients c;

GRANT SELECT ON public.v_daily_funnel_day TO authenticated, service_role;
GRANT SELECT ON public.v_daily_funnel_freshness TO authenticated, service_role;

-- ---- RPC used by the runner / UI (deterministic numbers only) ----
CREATE OR REPLACE FUNCTION public.get_daily_funnel(p_client_id uuid, p_start date, p_end date)
RETURNS SETOF public.v_daily_funnel_day
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.v_daily_funnel_day
   WHERE client_id = p_client_id AND date >= p_start AND date <= p_end
   ORDER BY date;
$$;