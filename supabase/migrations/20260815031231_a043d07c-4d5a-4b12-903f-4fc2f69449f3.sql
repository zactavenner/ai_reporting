CREATE OR REPLACE FUNCTION public.repair_client_reporting_rows(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := 'daily_run_' || to_char(now(), 'YYYYMMDD');
  v_false_showed int := 0;
  v_attendance int := 0;
  v_funded_verified int := 0;
  v_funded_unverified int := 0;
  v_committed_unknown int := 0;
BEGIN
  -- 1) Only showed/completed may set showed=true. Preserve every before value.
  WITH bad AS (
    SELECT id, showed, showed_at, attendance_source, appointment_status
    FROM public.calls
    WHERE client_id = p_client_id
      AND showed IS TRUE
      AND NOT public.call_is_showed(appointment_status)
    FOR UPDATE
  ), logged AS (
    INSERT INTO public.reporting_repair_log (repair_key, table_name, row_id, client_id, before_values, after_values)
    SELECT v_key || '_false_showed', 'calls', b.id, p_client_id,
           jsonb_build_object('showed', b.showed, 'showed_at', b.showed_at,
                              'attendance_source', b.attendance_source,
                              'appointment_status', b.appointment_status),
           jsonb_build_object('showed', false, 'showed_at', NULL, 'attendance_source', NULL)
    FROM bad b
    RETURNING row_id
  ), upd AS (
    UPDATE public.calls c
       SET showed = false, showed_at = NULL, attendance_source = NULL
      FROM logged l
     WHERE c.id = l.row_id
    RETURNING c.id
  )
  SELECT count(*) INTO v_false_showed FROM upd;

  -- 2) Label attendance source for genuinely attended appointments.
  WITH tgt AS (
    SELECT id, attendance_source, showed_at
    FROM public.calls
    WHERE client_id = p_client_id
      AND showed IS TRUE
      AND public.call_is_showed(appointment_status)
      AND attendance_source IS NULL
    FOR UPDATE
  ), logged AS (
    INSERT INTO public.reporting_repair_log (repair_key, table_name, row_id, client_id, before_values, after_values)
    SELECT v_key || '_attendance_source', 'calls', t.id, p_client_id,
           jsonb_build_object('attendance_source', t.attendance_source),
           jsonb_build_object('attendance_source', 'crm_status_scheduled_bucket')
    FROM tgt t
    RETURNING row_id
  ), upd AS (
    UPDATE public.calls c
       SET attendance_source = 'crm_status_scheduled_bucket'
      FROM logged l
     WHERE c.id = l.row_id
    RETURNING c.id
  )
  SELECT count(*) INTO v_attendance FROM upd;

  -- 3) Funded verification: only funded_amount > 0 counts. Never delete rows.
  WITH tgt AS (
    SELECT id, is_verified_funded, funded_amount
    FROM public.funded_investors
    WHERE client_id = p_client_id
      AND (is_verified_funded IS DISTINCT FROM (COALESCE(funded_amount, 0) > 0))
    FOR UPDATE
  ), logged AS (
    INSERT INTO public.reporting_repair_log (repair_key, table_name, row_id, client_id, before_values, after_values)
    SELECT v_key || '_funded_verification', 'funded_investors', t.id, p_client_id,
           jsonb_build_object('is_verified_funded', t.is_verified_funded, 'funded_amount', t.funded_amount),
           jsonb_build_object('is_verified_funded', (COALESCE(t.funded_amount, 0) > 0))
    FROM tgt t
    RETURNING row_id
  ), upd AS (
    UPDATE public.funded_investors f
       SET is_verified_funded = (COALESCE(f.funded_amount, 0) > 0)
      FROM logged l
     WHERE f.id = l.row_id
    RETURNING f.id, f.is_verified_funded
  )
  SELECT count(*) FILTER (WHERE is_verified_funded),
         count(*) FILTER (WHERE NOT is_verified_funded)
    INTO v_funded_verified, v_funded_unverified
  FROM upd;

  -- 4) Commitments with no real CRM commitment timestamp are flagged, never inferred.
  WITH tgt AS (
    SELECT id, committed_at_unknown
    FROM public.funded_investors
    WHERE client_id = p_client_id
      AND COALESCE(commitment_amount, 0) > 0
      AND committed_at IS NULL
      AND committed_at_unknown IS NOT TRUE
    FOR UPDATE
  ), logged AS (
    INSERT INTO public.reporting_repair_log (repair_key, table_name, row_id, client_id, before_values, after_values)
    SELECT v_key || '_committed_at_unknown', 'funded_investors', t.id, p_client_id,
           jsonb_build_object('committed_at_unknown', t.committed_at_unknown),
           jsonb_build_object('committed_at_unknown', true)
    FROM tgt t
    RETURNING row_id
  ), upd AS (
    UPDATE public.funded_investors f
       SET committed_at_unknown = true
      FROM logged l
     WHERE f.id = l.row_id
    RETURNING f.id
  )
  SELECT count(*) INTO v_committed_unknown FROM upd;

  RETURN jsonb_build_object(
    'repair_key', v_key,
    'false_showed_cleared', v_false_showed,
    'attendance_source_labeled', v_attendance,
    'funded_marked_verified', v_funded_verified,
    'funded_marked_unverified', v_funded_unverified,
    'committed_at_flagged_unknown', v_committed_unknown
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_client_reporting_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_client_reporting_rows(uuid) TO service_role;