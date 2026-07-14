import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, Flag, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { yesterdayISO } from '@/hooks/useHuddle';

interface Row {
  client_id: string;
  client_name: string;
  spend: number;
  leads: number;
  cpl: number;      // cost per lead
  cps: number;      // cost per show
  cpbc: number;     // cost per booked call
  booked: number;
  closes: number;
  cpl_avg: number;
  cps_avg: number;
  cpbc_avg: number;
  worst_delta: number; // positive = worse
}

function delta(cur: number, avg: number) {
  if (!avg) return 0;
  return (cur - avg) / avg;
}

function DeltaBadge({ pct }: { pct: number }) {
  if (!isFinite(pct) || Math.abs(pct) < 0.02) return <span className="text-muted-foreground text-xs inline-flex items-center gap-0.5"><Minus className="w-3 h-3" />0%</span>;
  const bad = pct > 0; // higher CPX = worse
  return (
    <span className={`text-xs inline-flex items-center gap-0.5 ${bad ? 'text-destructive' : 'text-emerald-500'}`}>
      {bad ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(pct * 100).toFixed(0)}%
    </span>
  );
}

function MetricTrio({ cpl, cps, cpbc, cplAvg, cpsAvg, cpbcAvg }: {
  cpl: number; cps: number; cpbc: number; cplAvg: number; cpsAvg: number; cpbcAvg: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 min-w-[280px]">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">CPL</div>
        <div className="text-lg font-semibold">${cpl.toFixed(0)}</div>
        <DeltaBadge pct={delta(cpl, cplAvg)} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">CPS</div>
        <div className="text-lg font-semibold">${cps.toFixed(0)}</div>
        <DeltaBadge pct={delta(cps, cpsAvg)} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">CPBC</div>
        <div className="text-lg font-semibold">${cpbc.toFixed(0)}</div>
        <DeltaBadge pct={delta(cpbc, cpbcAvg)} />
      </div>
    </div>
  );
}

export function NumbersSegment({ huddleId }: { huddleId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const y = yesterdayISO();
      const start = new Date(y);
      const weekStart = new Date(y);
      weekStart.setDate(weekStart.getDate() - 6);
      const weekStartISO = weekStart.toISOString().slice(0, 10);

      const [{ data: clients }, { data: metrics }] = await Promise.all([
        supabase.from('clients').select('id,name').eq('status', 'active'),
        supabase.from('daily_metrics').select('client_id,date,ad_spend,leads,calls,showed_calls,commitments').gte('date', weekStartISO).lte('date', y),
      ]);

      const byClient: Record<string, any[]> = {};
      (metrics || []).forEach((m: any) => {
        (byClient[m.client_id] ||= []).push(m);
      });

      const result: Row[] = (clients || []).map((c: any) => {
        const list = byClient[c.id] || [];
        const yRow = list.find((m) => m.date === y) || { ad_spend: 0, leads: 0, calls: 0, showed_calls: 0, commitments: 0 };
        const week = list.filter((m) => m.date !== y);
        const avg = (fn: (m: any) => number) => {
          const vals = week.map(fn).filter((v) => v > 0);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        };
        const cpl = yRow.leads ? yRow.ad_spend / yRow.leads : 0;
        const cps = yRow.showed_calls ? yRow.ad_spend / yRow.showed_calls : 0;
        const cpbc = yRow.calls ? yRow.ad_spend / yRow.calls : 0;
        const cplAvg = avg((m) => (m.leads ? m.ad_spend / m.leads : 0));
        const cpsAvg = avg((m) => (m.showed_calls ? m.ad_spend / m.showed_calls : 0));
        const cpbcAvg = avg((m) => (m.calls ? m.ad_spend / m.calls : 0));
        const worst = Math.max(delta(cpl, cplAvg), delta(cps, cpsAvg), delta(cpbc, cpbcAvg));
        return {
          client_id: c.id,
          client_name: c.name,
          spend: yRow.ad_spend || 0,
          leads: yRow.leads || 0,
          cpl, cps, cpbc,
          booked: yRow.calls || 0,
          closes: yRow.commitments || 0,
          cpl_avg: cplAvg, cps_avg: cpsAvg, cpbc_avg: cpbcAvg,
          worst_delta: isFinite(worst) ? worst : 0,
        };
      });

      result.sort((a, b) => b.worst_delta - a.worst_delta);
      setRows(result.filter((r) => r.spend > 0 || r.leads > 0));
      setLoading(false);
    };
    load();
  }, []);

  const flagIssue = async (row: Row) => {
    await supabase.from('huddle_flags').insert({
      huddle_id: huddleId,
      client_id: row.client_id,
      reason: `Numbers off: CPL $${row.cpl.toFixed(0)} / CPS $${row.cps.toFixed(0)} / CPBC $${row.cpbc.toFixed(0)}`,
    });
    await supabase.from('tasks').insert({
      client_id: row.client_id,
      title: `Investigate yesterday's numbers — ${row.client_name}`,
      status: 'pending',
      priority: 'high',
      stage: 'backlog',
      source: 'huddle',
      huddle_id: huddleId,
      due_date: new Date().toISOString().slice(0, 10),
    } as any);
    toast.success(`Flagged ${row.client_name}`);
  };

  if (loading) return <div className="text-center text-muted-foreground">Loading yesterday's numbers…</div>;
  if (rows.length === 0) return <div className="text-center text-muted-foreground">No spend or leads yesterday.</div>;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-2 max-h-[55vh] overflow-y-auto">
      {rows.map((r) => (
        <Card key={r.client_id} className="p-4 flex items-center gap-4 justify-between">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-lg truncate">{r.client_name}</div>
            <div className="text-xs text-muted-foreground">
              Spend ${r.spend.toFixed(0)} · Leads {r.leads} · Booked {r.booked} · Closes {r.closes}
            </div>
          </div>
          <MetricTrio cpl={r.cpl} cps={r.cps} cpbc={r.cpbc} cplAvg={r.cpl_avg} cpsAvg={r.cps_avg} cpbcAvg={r.cpbc_avg} />
          <Button variant="outline" size="sm" onClick={() => flagIssue(r)}>
            <Flag className="w-4 h-4 mr-1" />Flag
          </Button>
        </Card>
      ))}
    </div>
  );
}