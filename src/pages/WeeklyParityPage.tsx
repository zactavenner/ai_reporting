import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { fetchAllRows } from '@/lib/fetchAllRows';

const WINDOWS = [7, 15, 30, 90] as const;
type WindowN = typeof WINDOWS[number];

const ALL = '__all__';

type Client = { id: string; name: string; status: string };

type DailyRow = {
  client_id: string;
  date: string;
  ad_spend: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  calls: number | null;
  showed_calls: number | null;
};

type OppRow = {
  client_id: string;
  stage_name: string;
  monetary_value: number | null;
  effective_at: string;
};

function fmtUSD(n: number) {
  if (!isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString();
}
function fmtInt(n: number) {
  return Math.round(n).toLocaleString();
}
function fmtPct(n: number | null) {
  if (n === null || !isFinite(n)) return '—';
  return n.toFixed(1) + '%';
}

function daysAgo(dateStr: string): number {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dd = new Date(d);
  dd.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - dd.getTime()) / 86400000);
}

function inWindow(dateStr: string, n: number, offset = 0) {
  const diff = daysAgo(dateStr);
  return diff >= offset && diff < offset + n;
}

function classifyStage(name: string): 'funded' | 'committed' | null {
  const s = name.toLowerCase();
  if (s.includes('fund')) return 'funded';
  if (s.includes('commit')) return 'committed';
  return null;
}

export default function WeeklyParityPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [opps, setOpps] = useState<OppRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date();
      since.setDate(since.getDate() - 91);
      const sinceStr = since.toISOString().slice(0, 10);

      const { data: clientRows } = await supabase
        .from('clients')
        .select('id, name, status')
        .in('status', ['active', 'onboarding'])
        .order('name');

      const activeClients = (clientRows || []) as Client[];
      setClients(activeClients);

      // Daily metrics for all active clients in last 91 days
      const dm = await fetchAllRows<DailyRow>((sb) =>
        sb
          .from('daily_metrics')
          .select('client_id, date, ad_spend, impressions, clicks, leads, calls, showed_calls')
          .in('client_id', activeClients.map(c => c.id))
          .gte('date', sinceStr)
      );
      setDaily(dm);

      // Pipelines + stages + opps
      const { data: pipelines } = await supabase
        .from('client_pipelines')
        .select('id, client_id')
        .in('client_id', activeClients.map(c => c.id));
      const pipeToClient = new Map<string, string>();
      (pipelines || []).forEach((p: any) => pipeToClient.set(p.id, p.client_id));

      const { data: stages } = await supabase
        .from('pipeline_stages')
        .select('id, name, pipeline_id')
        .in('pipeline_id', Array.from(pipeToClient.keys()));
      const stageMap = new Map<string, { name: string; pipeline_id: string }>();
      (stages || []).forEach((s: any) => stageMap.set(s.id, { name: s.name, pipeline_id: s.pipeline_id }));

      const oppsRaw = await fetchAllRows<any>((sb) =>
        sb
          .from('pipeline_opportunities')
          .select('stage_id, pipeline_id, monetary_value, last_stage_change_at, updated_at')
          .in('pipeline_id', Array.from(pipeToClient.keys()))
      );
      const oppRows: OppRow[] = [];
      for (const o of oppsRaw) {
        const st = stageMap.get(o.stage_id);
        if (!st) continue;
        const cid = pipeToClient.get(o.pipeline_id);
        if (!cid) continue;
        oppRows.push({
          client_id: cid,
          stage_name: st.name,
          monetary_value: Number(o.monetary_value) || 0,
          effective_at: o.last_stage_change_at || o.updated_at,
        });
      }
      setOpps(oppRows);

      // Default selection = highest-spend client (last 30 days)
      const spendByClient = new Map<string, number>();
      for (const r of dm) {
        if (daysAgo(r.date) < 30) {
          spendByClient.set(r.client_id, (spendByClient.get(r.client_id) || 0) + Number(r.ad_spend || 0));
        }
      }
      let topClient = '';
      let topSpend = -1;
      spendByClient.forEach((v, k) => {
        if (v > topSpend) { topSpend = v; topClient = k; }
      });
      setSelected(topClient || activeClients[0]?.id || ALL);
      setLoading(false);
    })();
  }, []);

  const filteredDaily = useMemo(
    () => selected === ALL ? daily : daily.filter(d => d.client_id === selected),
    [daily, selected]
  );
  const filteredOpps = useMemo(
    () => selected === ALL ? opps : opps.filter(o => o.client_id === selected),
    [opps, selected]
  );

  const windowStats = useMemo(() => {
    const out: Record<WindowN, any> = {} as any;
    for (const n of WINDOWS) {
      const dm = filteredDaily.filter(d => inWindow(d.date, n));
      const totals = dm.reduce((a, r) => ({
        spend: a.spend + Number(r.ad_spend || 0),
        impressions: a.impressions + Number(r.impressions || 0),
        clicks: a.clicks + Number(r.clicks || 0),
        leads: a.leads + Number(r.leads || 0),
        calls: a.calls + Number(r.calls || 0),
        showed: a.showed + Number(r.showed_calls || 0),
      }), { spend: 0, impressions: 0, clicks: 0, leads: 0, calls: 0, showed: 0 });

      let committed$ = 0, funded$ = 0, fundedCount = 0;
      for (const o of filteredOpps) {
        if (!o.effective_at || !inWindow(o.effective_at, n)) continue;
        const kind = classifyStage(o.stage_name);
        if (kind === 'funded') { funded$ += o.monetary_value || 0; fundedCount++; }
        else if (kind === 'committed') { committed$ += o.monetary_value || 0; }
      }
      out[n] = { ...totals, committed$, funded$, fundedCount };
    }
    return out;
  }, [filteredDaily, filteredOpps]);

  const wow = useMemo(() => {
    const cur = filteredDaily.filter(d => inWindow(d.date, 7, 0));
    const prev = filteredDaily.filter(d => inWindow(d.date, 7, 7));
    const sum = (rows: DailyRow[], k: keyof DailyRow) =>
      rows.reduce((a, r) => a + Number((r[k] as number) || 0), 0);
    const spendCur = sum(cur, 'ad_spend');
    const spendPrev = sum(prev, 'ad_spend');
    const leadsCur = sum(cur, 'leads');
    const leadsPrev = sum(prev, 'leads');
    const callsCur = sum(cur, 'calls');
    const callsPrev = sum(prev, 'calls');
    const showedCur = sum(cur, 'showed_calls');
    const delta = (c: number, p: number) => p === 0 ? null : ((c - p) / p) * 100;
    return {
      leadToCall: leadsCur > 0 ? (callsCur / leadsCur) * 100 : null,
      callToShow: callsCur > 0 ? (showedCur / callsCur) * 100 : null,
      cpBookedCall: callsCur > 0 ? spendCur / callsCur : null,
      dSpend: delta(spendCur, spendPrev),
      dLeads: delta(leadsCur, leadsPrev),
      dCalls: delta(callsCur, callsPrev),
    };
  }, [filteredDaily]);

  const rows = useMemo(() => {
    const cell = (fn: (w: WindowN) => string) => WINDOWS.map(fn);
    const s = windowStats;
    return [
      { label: 'Ad Spend', values: cell(w => fmtUSD(s[w].spend)) },
      { label: 'Impressions', values: cell(w => fmtInt(s[w].impressions)) },
      { label: 'Clicks', values: cell(w => fmtInt(s[w].clicks)) },
      { label: 'CTR', values: cell(w => s[w].impressions > 0 ? fmtPct((s[w].clicks / s[w].impressions) * 100) : '—') },
      { label: 'Leads', values: cell(w => fmtInt(s[w].leads)) },
      { label: 'Cost / Lead', values: cell(w => s[w].leads > 0 ? fmtUSD(s[w].spend / s[w].leads) : '—') },
      { label: 'Calls Booked', values: cell(w => fmtInt(s[w].calls)) },
      { label: 'Cost / Call', values: cell(w => s[w].calls > 0 ? fmtUSD(s[w].spend / s[w].calls) : '—') },
      { label: 'Showed', values: cell(w => fmtInt(s[w].showed)) },
      { label: 'Cost / Show', values: cell(w => s[w].showed > 0 ? fmtUSD(s[w].spend / s[w].showed) : '—') },
      { label: 'Committed $', values: cell(w => fmtUSD(s[w].committed$)) },
      { label: 'Funded #', values: cell(w => fmtInt(s[w].fundedCount)) },
      { label: 'Funded $', values: cell(w => fmtUSD(s[w].funded$)) },
      { label: 'Cost / Funded', values: cell(w => s[w].fundedCount > 0 ? fmtUSD(s[w].spend / s[w].fundedCount) : '—') },
      { label: 'Cost of Capital', values: cell(w => s[w].funded$ > 0 ? fmtPct((s[w].spend / s[w].funded$) * 100) : '—') },
      { label: 'Capital Deployed', values: WINDOWS.map(() => '—'), note: 'pending GHL field sync' },
    ];
  }, [windowStats]);

  const fmtDelta = (d: number | null) => d === null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(1) + '%';

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Weekly Report (Parity)</h1>
            <p className="text-sm text-muted-foreground">Cross-check numbers against external weekly PDF reports.</p>
          </div>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Clients (totals)</SelectItem>
              {clients.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Performance by window</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-2 font-medium">Metric</th>
                        {WINDOWS.map(w => (
                          <th key={w} className="text-right px-4 py-2 font-medium">Last {w}d</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.label} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2 font-medium">
                            {r.label}
                            {r.note && <span className="ml-2 text-xs text-muted-foreground">({r.note})</span>}
                          </td>
                          {r.values.map((v, i) => (
                            <td key={i} className="px-4 py-2 text-right tabular-nums">{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funnel & Week-over-Week (last 7 days)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
                  <div><div className="text-muted-foreground text-xs">Lead → Call</div><div className="font-semibold text-lg tabular-nums">{fmtPct(wow.leadToCall)}</div></div>
                  <div><div className="text-muted-foreground text-xs">Call → Showed</div><div className="font-semibold text-lg tabular-nums">{fmtPct(wow.callToShow)}</div></div>
                  <div><div className="text-muted-foreground text-xs">Cost / Booked Call</div><div className="font-semibold text-lg tabular-nums">{wow.cpBookedCall === null ? '—' : fmtUSD(wow.cpBookedCall)}</div></div>
                  <div><div className="text-muted-foreground text-xs">Δ Spend WoW</div><div className="font-semibold text-lg tabular-nums">{fmtDelta(wow.dSpend)}</div></div>
                  <div><div className="text-muted-foreground text-xs">Δ Leads WoW</div><div className="font-semibold text-lg tabular-nums">{fmtDelta(wow.dLeads)}</div></div>
                  <div><div className="text-muted-foreground text-xs">Δ Calls WoW</div><div className="font-semibold text-lg tabular-nums">{fmtDelta(wow.dCalls)}</div></div>
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              Committed, Funded & Funded # from GHL pipeline stages; Cost of Capital = ad spend ÷ dollars funded; Capital Deployed and Lead-by-State pending GHL field sync.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}