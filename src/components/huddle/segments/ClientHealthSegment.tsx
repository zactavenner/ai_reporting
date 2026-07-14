import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Plus, ExternalLink, TrendingUp, AlertTriangle, WifiOff } from 'lucide-react';

interface Row {
  id: string;
  name: string;
  status: string;
  meta_ad_account_id?: string | null;
  hasMetaAccount: boolean;
  lastMetricDate?: string | null;
  staleDays?: number | null;
  dataStatus: 'ok' | 'stale' | 'never_synced' | 'no_account';
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
  // health per window
  healthY?: 'green' | 'yellow' | 'red';
  health7?: 'green' | 'yellow' | 'red';
  health30?: 'green' | 'yellow' | 'red';
}

function deriveHealth(cpl: number, baseline: number, spend: number): 'green' | 'yellow' | 'red' {
  if (!spend) return 'green';
  if (!baseline) return 'green';
  const ratio = cpl / baseline;
  if (ratio >= 1.5) return 'red';
  if (ratio >= 1.2) return 'yellow';
  return 'green';
}

function pillClass(h?: 'green' | 'yellow' | 'red') {
  if (h === 'red') return 'bg-destructive/15 text-destructive border-destructive/30';
  if (h === 'yellow') return 'bg-amber-500/15 text-amber-600 border-amber-500/30';
  return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30';
}

export function ClientHealthSegment({ huddleId }: { huddleId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'flagged'>('flagged');

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
      const built: Row[] = (clients || []).map((c: any) => {
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
        const hasMetaAccount = !!c.meta_ad_account_id;
        const lastDate = list.map((m: any) => m.date).sort().pop() || null;
        let staleDays: number | null = null;
        if (lastDate) staleDays = Math.floor((Date.parse(yISO) - Date.parse(lastDate)) / 86400000);
        let dataStatus: Row['dataStatus'] = 'ok';
        if (!hasMetaAccount) dataStatus = 'no_account';
        else if (!lastDate) dataStatus = 'never_synced';
        else if (staleDays !== null && staleDays >= 2) dataStatus = 'stale';
        return {
          id: c.id, name: c.name, status: c.status,
          meta_ad_account_id: c.meta_ad_account_id,
          hasMetaAccount, lastMetricDate: lastDate, staleDays, dataStatus,
          cpl, spend, leads,
          cpl7, spend7, leads7,
          cpl30, spend30, leads30,
          healthY: deriveHealth(cpl, cpl30 || cpl7, spend),
          health7: deriveHealth(cpl7, cpl30, spend7),
          health30: deriveHealth(cpl30, cpl30, spend30),
        };
      });
      const rank = { red: 0, yellow: 1, green: 2 } as const;
      const dataRank: Record<Row['dataStatus'], number> = { stale: 0, never_synced: 0, no_account: 1, ok: 2 };
      built.sort((a, b) =>
        (dataRank[a.dataStatus] - dataRank[b.dataStatus]) ||
        (rank[a.healthY!] - rank[b.healthY!]) ||
        a.name.localeCompare(b.name)
      );
      setRows(built);
    };
    load();
  }, []);

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
    setReasons(p => ({ ...p, [row.id]: '' }));
    toast.success(`Task created for ${row.name}`);
  };

  const totals = useMemo(() => ({
    total: rows.length,
    red: rows.filter(r => r.healthY === 'red').length,
    yellow: rows.filter(r => r.healthY === 'yellow').length,
    green: rows.filter(r => r.healthY === 'green').length,
  }), [rows]);

  const visible = filter === 'flagged'
    ? rows.filter(r => r.healthY !== 'green')
    : rows;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 text-sm">
          <span className={`px-2.5 py-1 rounded-full border ${pillClass('red')}`}>{totals.red} Red</span>
          <span className={`px-2.5 py-1 rounded-full border ${pillClass('yellow')}`}>{totals.yellow} Yellow</span>
          <span className={`px-2.5 py-1 rounded-full border ${pillClass('green')}`}>{totals.green} Green</span>
          <span className="px-2.5 py-1 rounded-full border bg-muted text-muted-foreground">{totals.total} Total</span>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Button size="sm" variant={filter === 'flagged' ? 'default' : 'outline'} onClick={() => setFilter('flagged')}>Flagged only</Button>
          <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>Show all</Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[minmax(160px,1.4fr)_repeat(3,minmax(120px,1fr))_minmax(240px,1.6fr)] text-xs font-medium text-muted-foreground bg-muted/40 px-3 py-2">
          <div>Client</div>
          <div className="text-center">Yesterday</div>
          <div className="text-center">Last 7d</div>
          <div className="text-center">Last 30d</div>
          <div className="text-right">Actions</div>
        </div>
        <div className="divide-y max-h-[52vh] overflow-y-auto">
          {visible.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">All clients green today.</div>
          )}
          {visible.map((r) => (
            <div key={r.id} className="grid grid-cols-[minmax(160px,1.4fr)_repeat(3,minmax(120px,1fr))_minmax(240px,1.6fr)] items-center gap-2 px-3 py-2.5 hover:bg-muted/30">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{r.name}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{r.status}</div>
              </div>
              {[
                { h: r.healthY, cpl: r.cpl, spend: r.spend, leads: r.leads },
                { h: r.health7, cpl: r.cpl7, spend: r.spend7, leads: r.leads7 },
                { h: r.health30, cpl: r.cpl30, spend: r.spend30, leads: r.leads30 },
              ].map((w, i) => (
                <div key={i} className="text-center">
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold ${pillClass(w.h)}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${w.h === 'red' ? 'bg-destructive' : w.h === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    ${(w.cpl || 0).toFixed(0)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    ${Math.round(w.spend || 0).toLocaleString()} · {w.leads || 0}L
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-1.5 justify-end flex-wrap">
                {r.healthY !== 'green' && (
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-8 text-xs w-40"
                      placeholder="Reason / next step…"
                      value={reasons[r.id] || ''}
                      onChange={(e) => setReasons(p => ({ ...p, [r.id]: e.target.value }))}
                    />
                    <Button size="sm" className="h-8" onClick={() => createTask(r)}>
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
                <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                  <a href={`/clients/${r.id}`} target="_blank" rel="noreferrer" title="Client dashboard">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </a>
                </Button>
                {r.meta_ad_account_id && (
                  <Button variant="ghost" size="sm" className="h-8 px-2" asChild>
                    <a
                      href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${String(r.meta_ad_account_id).replace(/^act_/, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Ads Manager"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}