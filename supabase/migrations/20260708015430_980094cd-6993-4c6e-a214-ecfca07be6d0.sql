
CREATE TABLE public.client_audit_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily','weekly','monthly','manual')),
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('running','completed','failed')),
  total_checks INT NOT NULL DEFAULT 0,
  passed INT NOT NULL DEFAULT 0,
  warnings INT NOT NULL DEFAULT 0,
  failures INT NOT NULL DEFAULT 0,
  summary JSONB DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.client_audit_reports TO authenticated;
GRANT ALL ON public.client_audit_reports TO service_role;
ALTER TABLE public.client_audit_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit reports readable by authenticated" ON public.client_audit_reports FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_audit_reports_client_created ON public.client_audit_reports(client_id, created_at DESC);

CREATE TABLE public.client_audit_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES public.client_audit_reports(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  metric TEXT NOT NULL,
  expected NUMERIC,
  actual NUMERIC,
  variance_pct NUMERIC,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('pass','info','warning','failure')),
  message TEXT,
  remediation_action TEXT,
  remediated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.client_audit_findings TO authenticated;
GRANT ALL ON public.client_audit_findings TO service_role;
ALTER TABLE public.client_audit_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit findings readable by authenticated" ON public.client_audit_findings FOR SELECT TO authenticated USING (true);
CREATE INDEX idx_audit_findings_report ON public.client_audit_findings(report_id);
CREATE INDEX idx_audit_findings_client_severity ON public.client_audit_findings(client_id, severity);
