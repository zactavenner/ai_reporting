import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { AlertCircle, Plus, ChevronRight, ChevronLeft, ExternalLink } from 'lucide-react';

interface Row {
  id: string;
  name: string;
  status: string;
  meta_ad_account_id?: string | null;
  // yesterday
  cpl?: number;
  spend?: number;
  leads?: number;
  // 7-day
  cpl7?: number;
  spend7?: number;
  leads7?: number;
  // 30-day
  cpl30?: number;
  spend30?: number;
  leads30?: number;
  cplAvg?: number; // legacy alias = cpl7
  health?: 'green' | 'yellow' | 'red';
}

// Derive health from yesterday's CPL vs 7-day baseline (simple heuristic).
function deriveHealth(cpl: number, cplAvg: number, spend: number): 'green' | 'yellow' | 'red' {
  if (!spend) return 'green';
  if (!cplAvg) return 'green';
  const ratio = cpl / cplAvg;
  if (ratio >= 1.5) return 'red';
  if (ratio >= 1.2) return 'yellow';
  return 'green';
}

export function ClientHealthSegment({ huddleId }: { huddleId: string }) {
  const [flagged, setFlagged] = useState<Row[]>([]);
  const [greenCount, setGreenCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  const PER_CLIENT_S = 45;
  const [remaining, setRemaining] = useState(PER_CLIENT_S);
  const startedRef = useRef<number>(Date.now());

  useEffect(() => {
    const load = async () => {
      const today = new Date();
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      const yISO = y.toISOString().slice(0, 10);
      const weekStart = new Date(y);
      weekStart.setDate(weekStart.getDate() - 6);
      const weekStartISO = weekStart.toISOString().slice(0, 10);
      const monthStart = new Date(y);
      monthStart.setDate(monthStart.getDate() - 29);
      const monthStartISO = monthStart.toISOString().slice(0, 10);
      const [{ data: clients }, { data: metrics }] = await Promise.all([
        supabase.from('clients').select('id,name,meta_ad_account_id').in('status', ['active', 'onboarding']),
        supabase.from('daily_metrics').select('client_id,date,ad_spend,leads').gte('date', monthStartISO).lte('date', yISO),
      ]);
      const map: Record<string, any[]> = {};
      (metrics || []).forEach((m: any) => { (map[m.client_id] ||= []).push(m); });
      const rows: (Row & { health: string })[] = (clients || []).map((c: any) => {
        const list = map[c.id] || [];
        const yr = list.find(m => m.date === yISO);
        const week = list.filter(m => m.date >= weekStartISO && m.date <= yISO);
        const month = list;
        const sum = (arr: any[], k: string) => arr.reduce((a, b) => a + (Number(b[k]) || 0), 0);
        const spend = Number(yr?.ad_spend) || 0;
        const leads = Number(yr?.leads) || 0;
        const cpl = leads ? spend / leads : 0;
        const spend7 = sum(week, 'ad_spend');
        const leads7 = sum(week, 'leads');
        const cpl7 = leads7 ? spend7 / leads7 : 0;
        const spend30 = sum(month, 'ad_spend');
        const leads30 = sum(month, 'leads');
        const cpl30 = leads30 ? spend30 / leads30 : 0;
        const health = deriveHealth(cpl, cpl7, spend);
        return {
          id: c.id, name: c.name, status: c.status, health,
          meta_ad_account_id: c.meta_ad_account_id,
          cpl, spend, leads,
          cpl7, spend7, leads7, cplAvg: cpl7,
          cpl30, spend30, leads30,
        };
      });
      setTotal(rows.length);
      setGreenCount(rows.filter(r => r.health === 'green').length);
      // Red first, then yellow
      const flaggedRows = [
        ...rows.filter(r => r.health === 'red'),
        ...rows.filter(r => r.health === 'yellow'),
      ].map(r => ({ ...r }));
      setFlagged(flaggedRows);
      setIdx(0);
      startedRef.current = Date.now();
      setRemaining(PER_CLIENT_S);
    };
    load();
  }, []);

  // Per-client countdown
  useEffect(() => {
    startedRef.current = Date.now();
    setRemaining(PER_CLIENT_S);
  }, [idx]);

  useEffect(() => {
    if (flagged.length === 0) return;
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedRef.current) / 1000);
      const rem = PER_CLIENT_S - elapsed;
      setRemaining(rem);
      if (rem <= 0) {
        setIdx((i) => Math.min(i + 1, flagged.length - 1));
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [flagged.length, idx]);

  const createTask = async (row: Row) => {
    const reason = reasons[row.id] || '';
    await supabase.from('huddle_flags').insert({ huddle_id: huddleId, client_id: row.id, reason });
    await supabase.from('tasks').insert({
      client_id: row.id,
      title: `Address client health: ${row.name}${reason ? ` — ${reason}` : ''}`,
      status: 'pending',
      priority: 'high',
      stage: 'backlog',
      source: 'huddle',
      huddle_id: huddleId,
      due_date: new Date().toISOString().slice(0, 10),
    } as any);
    toast.success(`Task created for ${row.name}`);
  };

  const current = flagged[idx];
  const isRed = current?.health === 'red';

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm flex items-center justify-between">
        <span>{greenCount} of {total} Green — skipped</span>
        {flagged.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Client {idx + 1} of {flagged.length}
          </span>
        )}
      </div>
      {flagged.length === 0 && <div className="text-center text-muted-foreground py-10">All clients green today.</div>}
      {current && (
        <Card className={`p-6 border-l-4 ${isRed ? 'border-l-destructive' : 'border-l-amber-500'}`}>
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className={`w-6 h-6 ${isRed ? 'text-destructive' : 'text-amber-500'}`} />
            <div className="text-2xl md:text-3xl font-bold flex-1">{current.name}</div>
            <span className={`text-xs px-2 py-1 rounded font-semibold ${isRed ? 'bg-destructive/20 text-destructive' : 'bg-amber-500/20 text-amber-600'}`}>
              {isRed ? 'RED' : 'YELLOW'}
            </span>
            <div className={`font-mono tabular-nums text-lg ${remaining <= 10 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {String(Math.max(0, remaining)).padStart(2, '0')}s
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Yesterday', cpl: current.cpl, spend: current.spend, leads: current.leads },
              { label: 'Last 7 days', cpl: current.cpl7, spend: current.spend7, leads: current.leads7 },
              { label: 'Last 30 days', cpl: current.cpl30, spend: current.spend30, leads: current.leads30 },
            ].map((w) => (
              <div key={w.label} className="p-3 rounded bg-muted/50 text-center">
                <div className="text-xs text-muted-foreground mb-1">{w.label}</div>
                <div className="text-lg font-semibold">${(w.cpl || 0).toFixed(2)}<span className="text-xs text-muted-foreground font-normal"> CPL</span></div>
                <div className="text-xs text-muted-foreground mt-1">
                  ${Math.round(w.spend || 0).toLocaleString()} spend · {w.leads || 0} leads
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="outline" size="sm" asChild>
              <a href={`/clients/${current.id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1" />Client dashboard
              </a>
            </Button>
            {current.meta_ad_account_id && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${String(current.meta_ad_account_id).replace(/^act_/, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />Ads Manager
                </a>
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={reasons[current.id] || ''}
              onChange={(e) => setReasons(p => ({ ...p, [current.id]: e.target.value }))}
              placeholder="One-line reason & next step…"
            />
            <Button size="sm" onClick={() => createTask(current)}>
              <Plus className="w-4 h-4 mr-1" />Task
            </Button>
          </div>
          <div className="flex justify-between mt-4 pt-4 border-t">
            <Button variant="ghost" size="sm" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>
              <ChevronLeft className="w-4 h-4 mr-1" />Prev client
            </Button>
            <Button variant="default" size="sm" onClick={() => setIdx(Math.min(flagged.length - 1, idx + 1))} disabled={idx >= flagged.length - 1}>
              Next client<ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}