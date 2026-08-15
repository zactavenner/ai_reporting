CREATE OR REPLACE FUNCTION public.lead_quality_normalize(p_status text, p_disposition text, p_is_spam boolean, p_quality_score numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  -- Single documented normalisation for lead quality. Buckets are mutually
  -- exclusive: bad | qualified | pending. Scores arrive on either a 0-10 or a
  -- 0-100 scale, so the numeric rule is scale-aware and never demotes an
  -- un-reviewed lead to 'bad' on a mid-range score alone.
  SELECT CASE
    WHEN coalesce(p_is_spam, false) THEN 'bad'
    WHEN lower(coalesce(p_disposition,'')) ~ '(spam|invalid|duplicate|dupe|bad|junk|wrong number|do not|unqualified|not qualified)' THEN 'bad'
    WHEN lower(coalesce(p_status,'')) ~ '(spam|invalid|duplicate|dupe|junk|unqualified|disqualif)' THEN 'bad'
    WHEN p_quality_score IS NOT NULL AND p_quality_score > 0 AND p_quality_score <= 10 AND p_quality_score < 4 THEN 'bad'
    WHEN p_quality_score IS NOT NULL AND p_quality_score > 10 AND p_quality_score < 40 THEN 'bad'
    WHEN lower(coalesce(p_disposition,'')) ~ '(qualified|booked|appointment|interested|nurture|contacted|connected|won|funded|committed)' THEN 'qualified'
    WHEN lower(coalesce(p_status,'')) ~ '(qualified|booked|appointment|interested|nurture|contacted|connected|won|funded|committed)' THEN 'qualified'
    WHEN p_quality_score IS NOT NULL AND p_quality_score > 10 AND p_quality_score >= 40 THEN 'qualified'
    WHEN p_quality_score IS NOT NULL AND p_quality_score <= 10 AND p_quality_score >= 7 THEN 'qualified'
    ELSE 'pending'
  END;
$function$;