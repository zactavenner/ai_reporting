CREATE TABLE public.reporting_operator_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.reporting_operator_users TO service_role;

ALTER TABLE public.reporting_operator_users ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_reporting_operator_users_updated_at
BEFORE UPDATE ON public.reporting_operator_users
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();