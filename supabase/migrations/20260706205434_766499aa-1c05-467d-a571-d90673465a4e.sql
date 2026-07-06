
-- Trigger to notify Slack for high-priority (1 or 2) new approval_queue rows
CREATE OR REPLACE FUNCTION public.notify_high_priority_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_supabase_url text;
  v_service_key text;
BEGIN
  IF NEW.priority IS NULL OR NEW.priority > 2 THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;
  v_supabase_url := current_setting('app.settings.supabase_url', true);
  v_service_key := current_setting('app.settings.service_role_key', true);

  -- Best-effort async HTTP call; ignore failures
  BEGIN
    PERFORM net.http_post(
      url := 'https://jgwwmtuvjlmzapwqiabu.supabase.co/functions/v1/approval-notify',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object(
        'approval_id', NEW.id,
        'title', NEW.title,
        'client_name', COALESCE(v_client_name, 'Unknown'),
        'priority', NEW.priority,
        'queue_type', NEW.queue_type
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_queue_slack_notify ON public.approval_queue;
CREATE TRIGGER trg_approval_queue_slack_notify
AFTER INSERT ON public.approval_queue
FOR EACH ROW
EXECUTE FUNCTION public.notify_high_priority_approval();
