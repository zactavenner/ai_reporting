REVOKE ALL PRIVILEGES ON TABLE public.reporting_operator_users FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.reporting_operator_users FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.reporting_operator_users FROM authenticated;
GRANT ALL ON TABLE public.reporting_operator_users TO service_role;