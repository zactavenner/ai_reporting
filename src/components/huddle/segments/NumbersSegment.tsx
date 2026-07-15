import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, Flag, Minus, FileText, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { yesterdayISO } from '@/hooks/useHuddle';

interface PeriodStats {
  spend: number;
  leads: number;
  booked: number;
  showed: number;
  closes: number;
  cpl: number;
  cpbc: number;
  cps: number;
}

interface Row {
  client_id: string;
  client_name: string;
  doc_url: string | null;
  sheet_url: string | null;
  y: PeriodStats;
  w: PeriodStats;
  m: PeriodStats;
  worst_delta: number;
}

function delta(cur: number, avg: number) {
  if (!avg) return 0;
  return (cur - avg) / avg;
}

function DeltaBadge({ pct }: { pct: number }) {
  if (!isFinite(pct) || Math.abs(pct) < 0.02) return <span className="text-muted-foreground text-xs inline-flex items-center gap-0.5"><Minus className="w-3 h-3" />0%</span>;
  const bad = pct > 0; // higher CP$ = worse
  return (
    <span className={`text-xs inline-flex items-center gap-0.5 ${bad ? 'text-destructive' : 'text-emerald-500'}`}>
      {bad ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      {Math.abs(pct * 100).toFixed(0)}%
    </span>
  );
}

function money(n: number) {
  if (!isFinite(n) || n <= 0) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

function aggregate(list: any[]): PeriodStats {
  const spend = list.reduce((a, m) => a + (Number(m.ad_spend) || 0), 0);
  const leads = list.reduce((a, m) => a + (Number(m.leads) || 0), 0);
  const booked = list.reduce((a, m) => a + (Number(m.calls) || 0), 0);
  const showed = list.reduce((a, m) => a + (Number(m.showed_calls) || 0), 0);
  const closes = list.reduce((a, m) => a + (Number(m.commitments) || 0), 0);
  return {
    spend, leads, booked, showed, closes,
    cpl: leads ? spend / leads : 0,
    cpbc: booked ? spend / booked : 0,
    cps: showed ? spend / showed : 0,
  };
}

function MetricBreakdown({ row }: { row: Row }) {
  const cell = (v: number) => (
    <td className="px-2 py-1 text-right font-semibold text-sm tabular-nums">{money(v)}</td>
  );
  const deltaRow = (cur: number, avg: number) => (
    <div className="text-[10px]"><DeltaBadge pct={delta(cur, avg)} /></div>
  );
  return (
    <table className="text-xs min-w-[340px]">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
          <th className="text-left font-normal pr-2"></th>
          <th className="text-right font-normal px-2">Yesterday</th>
          <th className="text-right font-normal px-2">7d</th>
          <th className="text-right font-normal px-2">30d</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="pr-2 text-muted-foreground">CPL</td>
          {cell(row.y.cpl)}{cell(row.w.cpl)}{cell(row.m.cpl)}
        </tr>
        <tr>
          <td className="pr-2 text-muted-foreground">Cost / Call</td>
          {cell(row.y.cpbc)}{cell(row.w.cpbc)}{cell(row.m.cpbc)}
        </tr>
        <tr>
          <td className="pr-2 text-muted-foreground">Cost / Showed</td>
          {cell(row.y.cps)}{cell(row.w.cps)}{cell(row.m.cps)}
        </tr>
        <tr>
          <td></td>
          <td className="px-2 text-right">{deltaRow(row.y.cpl, row.m.cpl)}</td>
          <td className="px-2 text-right">{deltaRow(row.w.cpl, row.m.cpl)}</td>
          <td className="px-2 text-right text-muted-foreground text-[10px]">baseline</td>
        </tr>
      </tbody>
    </table>
  );
}

export function NumbersSegment({ huddleId }: { huddleId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const y = yesterdayISO();
      const weekStart = new Date(y);
      weekStart.setDate(weekStart.getDate() - 6);
      const weekStartISO = weekStart.toISOString().slice(0, 10);
      const monthStart = new Date(y);
      monthStart.setDate(monthStart.getDate() - 29);
      const monthStartISO = monthStart.toISOString().slice(0, 10);

      const [{ data: clients }, { data: metrics }, { data: settings }] = await Promise.all([
        supabase.from('clients').select('id,name,google_doc_url').in('status', ['active', 'onboarding']),
        supabase.from('daily_metrics').select('client_id,date,ad_spend,leads,calls,showed_calls,commitments').gte('date', monthStartISO).lte('date', y),
        supabase.from('client_settings').select('client_id,kpi_google_doc_url,kpi_google_sheet_url'),
      ]);

      const settingsByClient: Record<string, any> = {};
      (settings || []).forEach((s: any) => {
        settingsByClient[s.client_id] = s;
      });

      const byClient: Record<string, any[]> = {};
      (metrics || []).forEach((m: any) => {
        (byClient[m.client_id] ||= []).push(m);
      });

      const result: Row[] = (clients || []).map((c: any) => {
        const list = byClient[c.id] || [];
        const yList = list.filter((m) => m.date === y);
        const wList = list.filter((m) => m.date >= weekStartISO && m.date <= y);
        const mList = list;
        const yStats = aggregate(yList);
        const wStats = aggregate(wList);
        const mStats = aggregate(mList);
        const worst = Math.max(
          delta(yStats.cpl, mStats.cpl),
          delta(yStats.cpbc, mStats.cpbc),
          delta(yStats.cps, mStats.cps),
        );
        return {
          client_id: c.id,
          client_name: c.name,
          y: yStats,
          w: wStats,
          m: mStats,
          worst_delta: isFinite(worst) ? worst : 0,
        };
      });

      result.sort((a, b) => b.worst_delta - a.worst_delta);
      setRows(result.filter((r) => r.m.spend > 0 || r.m.leads > 0));
      setLoading(false);
    };
    load();
  }, []);

  const flagIssue = async (row: Row) => {
    await supabase.from('huddle_flags').insert({
      huddle_id: huddleId,
      client_id: row.client_id,
      reason: `Numbers off: CPL ${money(row.y.cpl)} · Cost/Call ${money(row.y.cpbc)} · Cost/Showed ${money(row.y.cps)} (yday) vs 30d ${money(row.m.cpl)}/${money(row.m.cpbc)}/${money(row.m.cps)}`,
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
  if (rows.length === 0) return <div className="text-center text-muted-foreground">No spend or leads in the last 30 days.</div>;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-2 max-h-[60vh] overflow-y-auto">
      {rows.map((r) => (
        <Card key={r.client_id} className="p-4 flex items-start gap-4 justify-between flex-wrap md:flex-nowrap">
          <div className="flex-1 min-w-[220px]">
            <div className="font-semibold text-lg truncate">{r.client_name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Yday: Spend ${r.y.spend.toFixed(0)} · Leads {r.y.leads} · Booked {r.y.booked} · Showed {r.y.showed} · Closes {r.y.closes}
            </div>
            <div className="text-[11px] text-muted-foreground/80 mt-0.5">
              30d: Spend ${r.m.spend.toFixed(0)} · Leads {r.m.leads} · Booked {r.m.booked} · Showed {r.m.showed}
            </div>
          </div>
          <MetricBreakdown row={r} />
          <Button variant="outline" size="sm" onClick={() => flagIssue(r)}>
            <Flag className="w-4 h-4 mr-1" />Flag
          </Button>
        </Card>
      ))}
    </div>
  );
}