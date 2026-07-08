import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShieldCheck, AlertTriangle, XCircle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

type Cadence = 'all' | 'daily' | 'weekly' | 'monthly' | 'manual';

function sevBadge(sev: string) {
  const map: Record<string, string> = {
    pass: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
    info: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
    warning: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
    failure: 'bg-red-500/10 text-red-500 border-red-500/30',
  };
  return map[sev] || map.info;
}

export function AuditReportsTab() {
  const [cadence, setCadence] = useState<Cadence>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const { data: reports, isLoading, refetch } = useQuery({
    queryKey: ['audit-reports', cadence],
    queryFn: async () => {
      let q = supabase
        .from('client_audit_reports')
        .select('*, clients(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (cadence !== 'all') q = q.eq('cadence', cadence);
      const { data, error } = await q;
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 30_000,
  });

  const { data: findings } = useQuery({
    queryKey: ['audit-findings', expanded],
    enabled: !!expanded,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_audit_findings')
        .select('*')
        .eq('report_id', expanded)
        .order('severity', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  async function runAll(kind: 'daily' | 'weekly' | 'monthly') {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('audit-client-accuracy', {
        body: { cadence: kind, auto_remediate: true },
      });
      if (error) throw new Error(error.message);
      toast.success(`${kind} audit: ${data?.results?.length || 0} clients processed`);
      refetch();
    } catch (e: any) {
      toast.error(`Audit failed: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Accuracy Audit Reports
          </h2>
          <p className="text-sm text-muted-foreground">
            Daily / weekly / monthly reconciliation of Meta + GHL against our database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
            <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cadences</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={running} onClick={() => runAll('daily')}>Run daily</Button>
          <Button size="sm" variant="outline" disabled={running} onClick={() => runAll('weekly')}>Run weekly</Button>
          <Button size="sm" disabled={running} onClick={() => runAll('monthly')}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Run monthly'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : !reports?.length ? (
        <div className="p-8 text-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          No audits run yet. Click "Run weekly" to start.
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map((r: any) => {
            const isOpen = expanded === r.id;
            return (
              <div key={r.id} className="border border-border rounded-lg bg-card">
                <button
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-accent/40 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : r.id)}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{r.clients?.name || 'Unknown client'}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{r.cadence}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {r.window_start} → {r.window_end}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })} · {r.total_checks} checks
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> {r.passed}
                    </Badge>
                    <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/30 gap-1">
                      <AlertTriangle className="h-3 w-3" /> {r.warnings}
                    </Badge>
                    <Badge className="bg-red-500/10 text-red-500 border-red-500/30 gap-1">
                      <XCircle className="h-3 w-3" /> {r.failures}
                    </Badge>
                  </div>
                </button>
                {isOpen && findings && (
                  <div className="border-t border-border p-3 space-y-1.5">
                    {findings.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No findings recorded.</div>
                    ) : findings.map((f: any) => (
                      <div key={f.id} className="flex items-center gap-3 text-xs p-2 rounded border border-border/60">
                        <Badge variant="outline" className={`text-[10px] ${sevBadge(f.severity)}`}>{f.severity}</Badge>
                        <span className="text-muted-foreground uppercase text-[10px] w-24 shrink-0">{f.category}</span>
                        <span className="font-medium w-48 truncate">{f.metric}</span>
                        <span className="flex-1 flex gap-3 text-muted-foreground flex-wrap">
                          {f.expected !== null && <span>expected <b className="text-foreground">{Number(f.expected).toLocaleString()}</b></span>}
                          {f.actual !== null && <span>actual <b className="text-foreground">{Number(f.actual).toLocaleString()}</b></span>}
                          {f.variance_pct !== null && <span>Δ <b className="text-foreground">{f.variance_pct}%</b></span>}
                          {f.remediation_action && <span className="text-primary">→ {f.remediation_action}</span>}
                          {f.message && <span className="italic">{f.message}</span>}
                        </span>
                      </div>
                    ))}
                    {r.summary?.dispatched?.length > 0 && (
                      <div className="text-[11px] text-muted-foreground pt-2 border-t border-border">
                        Auto-remediation dispatched: {r.summary.dispatched.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}