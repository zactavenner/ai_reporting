
-- 1) Cascade client pause/unpause to agents
CREATE OR REPLACE FUNCTION public.cascade_client_status_to_agents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'paused' THEN
      UPDATE public.agents SET enabled = false WHERE client_id = NEW.id;
      UPDATE public.client_agents SET enabled = false WHERE client_id = NEW.id;
    ELSIF OLD.status = 'paused' AND NEW.status = 'active' THEN
      -- Re-enable previously-core agents on resume; leave manual-off agents alone
      UPDATE public.agents SET enabled = true WHERE client_id = NEW.id AND COALESCE(is_core, false) = true;
      UPDATE public.client_agents SET enabled = true WHERE client_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_client_status_to_agents ON public.clients;
CREATE TRIGGER trg_cascade_client_status_to_agents
AFTER UPDATE OF status ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.cascade_client_status_to_agents();

-- 2) Auto-create an agent channel on agent insert so the UI never hangs on "Loading channel..."
CREATE OR REPLACE FUNCTION public.auto_create_agent_channel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.agent_channels (scope, client_id, agent_id, kind, name)
  VALUES (
    CASE WHEN NEW.client_id IS NULL THEN 'agency' ELSE 'client' END,
    NEW.client_id,
    NEW.id,
    'agent',
    '#agent-' || substr(NEW.id::text, 1, 6)
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_agent_channel ON public.agents;
CREATE TRIGGER trg_auto_create_agent_channel
AFTER INSERT ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_agent_channel();

-- Backfill missing channels for existing agents
INSERT INTO public.agent_channels (scope, client_id, agent_id, kind, name)
SELECT
  CASE WHEN a.client_id IS NULL THEN 'agency' ELSE 'client' END,
  a.client_id,
  a.id,
  'agent',
  '#agent-' || substr(a.id::text, 1, 6)
FROM public.agents a
WHERE NOT EXISTS (
  SELECT 1 FROM public.agent_channels c
  WHERE c.agent_id = a.id AND c.kind = 'agent'
);
