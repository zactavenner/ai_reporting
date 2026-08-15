-- ============ PHASE 2: audited, idempotent data repair ============
-- Every changed calls row keeps its exact before values in reporting_repair_log
-- so showed / showed_at / attendance_source can be restored row-by-row.

-- 2a. Un-set fabricated shows: status is not a real show, or appointment is still in the future.
WITH target AS (
  SELECT id, client_id, showed, showed_at, attendance_source, appointment_status, scheduled_at
    FROM public.calls
   WHERE showed = true
     AND ( NOT public.call_is_showed(appointment_status) OR scheduled_at > now() )
), upd AS (
  UPDATE public.calls c
     SET showed = false,
         showed_at = NULL,
         attendance_source = 'repair_status_normalization'
    FROM target t
   WHERE c.id = t.id
  RETURNING c.id
)
INSERT INTO public.reporting_repair_log (repair_key, table_name, row_id, client_id, before_values, after_values)
SELECT 'phase2a_false_showed', 'calls', t.id, t.client_id,
       jsonb_build_object('showed', t.showed, 'showed_at', t.showed_at,
                          'attendance_source', t.attendance_source,
                          'appointment_status', t.appointment_status,
                          'scheduled_at', t.scheduled_at),
       jsonb_build_object('showed', false, 'showed_at', NULL,
                          'attendance_source', 'repair_status_normalization')
FROM target t
WHERE EXISTS (SELECT 1 FROM upd u WHERE u.id = t.id);

-- 2b. Real shows whose attendance timestamp was copied from the schedule:
--     keep scheduled_at as the attendance bucket, label the source honestly.
WITH target AS (
  SELECT id, client_id, showed, showed_at, attendance_source, scheduled_at
    FROM public.calls
   WHERE showed = true
     AND public.call_is_showed(appointment_status)
     AND showed_at IS NOT NULL
     AND showed_at = scheduled_at
     AND attendance_source IS NULL
), upd AS (
  UPDATE public.calls c
     SET attendance_source = 'crm_status_scheduled_bucket'
    FROM target t
   WHERE c.id = t.id
  RETURNING c.id
)
INSERT INTO public.reporting_repair_log (repair_key, table_name, row_id, client_id, before_values, after_values)
SELECT 'phase2b_attendance_source', 'calls', t.id, t.client_id,
       jsonb_build_object('attendance_source', t.attendance_source, 'showed_at', t.showed_at, 'scheduled_at', t.scheduled_at),
       jsonb_build_object('attendance_source', 'crm_status_scheduled_bucket')
FROM target t
WHERE EXISTS (SELECT 1 FROM upd u WHERE u.id = t.id);

-- 2c. Verified-funded flag. Zero-dollar rows are NEVER deleted, only marked unverified.
WITH target AS (
  SELECT id, client_id, funded_amount, source, is_verified_funded, verification_source, flags
    FROM public.funded_investors
   WHERE is_verified_funded IS DISTINCT FROM (coalesce(funded_amount,0) > 0)
), upd AS (
  UPDATE public.funded_investors f
     SET is_verified_funded = (coalesce(f.funded_amount,0) > 0),
         verification_source = CASE WHEN coalesce(f.funded_amount,0) > 0 THEN f.source ELSE NULL END,
         flags = CASE WHEN coalesce(f.funded_amount,0) > 0
                      THEN f.flags - 'zero_dollar_source'
                      ELSE f.flags || jsonb_build_object('zero_dollar_source', coalesce(f.source,'unknown')) END
    FROM target t
   WHERE f.id = t.id
  RETURNING f.id, f.is_verified_funded, f.verification_source, f.flags
)
INSERT INTO public.reporting_repair_log (repair_key, table_name, row_id, client_id, before_values, after_values)
SELECT 'phase2c_funded_verification', 'funded_investors', t.id, t.client_id,
       jsonb_build_object('is_verified_funded', t.is_verified_funded, 'verification_source', t.verification_source,
                          'flags', t.flags, 'funded_amount', t.funded_amount, 'source', t.source),
       jsonb_build_object('is_verified_funded', u.is_verified_funded, 'verification_source', u.verification_source, 'flags', u.flags)
FROM target t JOIN upd u ON u.id = t.id;

-- 2d. Commitments: committed_at is NEVER inferred from funded_at.
--     Without a real CRM commitment-stage transition timestamp, leave NULL and flag it.
WITH target AS (
  SELECT id, client_id, flags
    FROM public.funded_investors
   WHERE coalesce(commitment_amount,0) > 0
     AND committed_at IS NULL
     AND NOT (flags ? 'committed_at_unknown')
), upd AS (
  UPDATE public.funded_investors f
     SET flags = f.flags || jsonb_build_object('committed_at_unknown', true)
    FROM target t
   WHERE f.id = t.id
  RETURNING f.id, f.flags
)
INSERT INTO public.reporting_repair_log (repair_key, table_name, row_id, client_id, before_values, after_values)
SELECT 'phase2d_committed_at_unknown', 'funded_investors', t.id, t.client_id,
       jsonb_build_object('flags', t.flags, 'committed_at', NULL),
       jsonb_build_object('flags', u.flags, 'committed_at', NULL)
FROM target t JOIN upd u ON u.id = t.id;

-- Rollback helper: restores calls rows for a given repair_key from the log.
CREATE OR REPLACE FUNCTION public.rollback_reporting_repair(p_repair_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer := 0;
BEGIN
  WITH r AS (
    UPDATE public.calls c
       SET showed = coalesce((l.before_values->>'showed')::boolean, c.showed),
           showed_at = (l.before_values->>'showed_at')::timestamptz,
           attendance_source = l.before_values->>'attendance_source'
      FROM public.reporting_repair_log l
     WHERE l.repair_key = p_repair_key AND l.table_name = 'calls' AND c.id = l.row_id
    RETURNING c.id
  ) SELECT count(*) INTO n FROM r;

  UPDATE public.funded_investors f
     SET is_verified_funded = coalesce((l.before_values->>'is_verified_funded')::boolean, f.is_verified_funded),
         verification_source = l.before_values->>'verification_source',
         flags = coalesce(l.before_values->'flags', f.flags)
    FROM public.reporting_repair_log l
   WHERE l.repair_key = p_repair_key AND l.table_name = 'funded_investors' AND f.id = l.row_id;

  RETURN n;
END $$;