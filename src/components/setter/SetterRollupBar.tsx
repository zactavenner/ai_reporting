import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Win = '1d' | '7d' | '30d';

interface Props {
  clientIds: string[]; // empty = do not query (show 0)
}

const pct = (n: number) => `${n.toFixed(1)}%`;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function SetterRollupBar({ clientIds }: Props) {
  const [win, setWin] = useState<Win>('7d');
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ leads: 0, qualified: 0, bad: 0, booked: 0, spend: 0, calls: 0, showed: 0 });

  useEffect(() => {
    if (!clientIds.length) { setSummary({ leads: 0, qualified: 0, bad: 0, booked: 0, spend: 0, calls: 0, showed: 0 }); return; }
    const days = win === '1d' ? 1 : win === '7d' ? 7 : 30;
    const sinceISO = new Date(Date.now() - days * 86400_000).toISOString();
    const sinceDate = sinceISO.slice(0, 10);
    setLoading(true);
    (async () => {
      try {
        const [dailyRes, dispoRes] = await Promise.all([
          supabase.from('daily_metrics')
            .select('ad_spend, leads, calls, showed_calls, client_id')
            .in('client_id', clientIds)
            .gte('date', sinceDate),
          supabase.from('lead_dispositions')
            .select('disposition, client_id')
            .in('client_id', clientIds)
            .gte('disposed_at', sinceISO),
        ]);
        const dm = dailyRes.data ?? [];
        const dispos = dispoRes.data ?? [];
        const qSet = new Set(['qualified', 'booked', 'showed', 'opportunity', 'funded']);
        const bSet = new Set(['bad_lead', 'bad_contact_info', 'unqualified', 'not_accredited']);
        const bookSet = new Set(['booked', 'showed', 'opportunity', 'funded']);
        setSummary({
          leads: dm.reduce((s: number, r: any) => s + Number(r.leads ?? 0), 0),
          spend: dm.reduce((s: number, r: any) => s + Number(r.ad_spend ?? 0), 0),
          calls: dm.reduce((s: number, r: any) => s + Number(r.calls ?? 0), 0),
          showed: dm.reduce((s: number, r: any) => s + Number(r.showed_calls ?? 0), 0),
          qualified: dispos.filter((d: any) => qSet.has(d.disposition)).length,
          bad: dispos.filter((d: any) => bSet.has(d.disposition)).length,
          booked: dispos.filter((d: any) => bookSet.has(d.disposition)).length,
        });
      } finally { setLoading(false); }
    })();
  }, [clientIds.join(','), win]);

  const cpl = summary.leads > 0 ? summary.spend / summary.leads : 0;
  const cps = summary.showed > 0 ? summary.spend / summary.showed : 0;
  const cpb = summary.booked > 0 ? summary.spend / summary.booked : 0;
  const qRate = summary.leads > 0 ? (summary.qualified / summary.leads) * 100 : 0;
  const bRate = summary.leads > 0 ? (summary.bad / summary.leads) * 100 : 0;
  const bookRate = summary.leads > 0 ? (summary.booked / summary.leads) * 100 : 0;

  const cells: { label: string; value: string; tone?: 'good' | 'bad' | 'default' }[] = [
    { label: `Leads (${win})`, value: String(summary.leads) },
    { label: 'Qualified', value: pct(qRate), tone: 'good' },
    { label: 'Bad', value: pct(bRate), tone: bRate >= 25 ? 'bad' : 'default' },
    { label: 'Booked', value: pct(bookRate) },
    { label: 'CPL', value: money(cpl) },
    { label: 'Cost / Show', value: money(cps) },
    { label: 'Cost / Booked', value: money(cpb) },
  ];

  return (
    <div className="border-b bg-muted/30">
      <div className="px-6 py-2 flex items-center gap-3">
        <UserCheck className="w-4 h-4 text-primary" />
        <div className="text-xs font-semibold uppercase tracking-wider">Lead Quality Rollup</div>
        <span className="text-[10px] text-muted-foreground">
          {clientIds.length ? `${clientIds.length} client${clientIds.length === 1 ? '' : 's'}` : 'no clients selected'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={win} onValueChange={(v) => setWin(v as Win)}>
            <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7d</SelectItem>
              <SelectItem value="30d">Last 30d</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setOpen(o => !o)} className="h-7 w-7 p-0">
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
      {open && (
        <div className="px-6 pb-2 grid grid-cols-4 md:grid-cols-7 gap-2">
          {cells.map(c => (
            <div key={c.label} className="rounded-md border bg-background/70 px-3 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{c.label}</div>
              <div className={`text-sm font-semibold tabular-nums ${c.tone === 'good' ? 'text-emerald-600' : c.tone === 'bad' ? 'text-rose-600' : ''}`}>
                {loading ? '…' : c.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}