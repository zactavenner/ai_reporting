import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserCheck, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

type Win = '1d' | '7d' | '30d';

interface Props {
  clientIds: string[]; // empty = do not query (show 0)
  win?: Win;
  onWinChange?: (w: Win) => void;
}

const pct = (n: number) => `${n.toFixed(1)}%`;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function SetterRollupBar({ clientIds, win: winProp, onWinChange }: Props) {
  const [winLocal, setWinLocal] = useState<Win>('7d');
  const win = winProp ?? winLocal;
  const setWin = (w: Win) => { if (onWinChange) onWinChange(w); else setWinLocal(w); };
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ leads: 0, qualified: 0, bad: 0, booked: 0, spend: 0, calls: 0, showed: 0 });
  const [live, setLive] = useState({
    liveLeads: 0,
    contacted: 0,      // leads with >=1 outbound touch
    connected: 0,      // calls whose outcome indicates a live conversation
    dials: 0,          // total outbound calls
    slaBuckets: { under5m: 0, under15m: 0, under1h: 0, over1h: 0, never: 0 },
  });

  useEffect(() => {
    if (!clientIds.length) {
      setSummary({ leads: 0, qualified: 0, bad: 0, booked: 0, spend: 0, calls: 0, showed: 0 });
      setLive({ liveLeads: 0, contacted: 0, connected: 0, dials: 0, slaBuckets: { under5m: 0, under15m: 0, under1h: 0, over1h: 0, never: 0 } });
      return;
    }
    const days = win === '1d' ? 1 : win === '7d' ? 7 : 30;
    const sinceISO = new Date(Date.now() - days * 86400_000).toISOString();
    const sinceDate = sinceISO.slice(0, 10);
    setLoading(true);
    (async () => {
      try {
        const [dailyRes, dispoRes, leadsRes, callsRes, timelineRes] = await Promise.all([
          supabase.from('daily_metrics')
            .select('ad_spend, leads, calls, showed_calls, client_id')
            .in('client_id', clientIds)
            .gte('date', sinceDate),
          supabase.from('lead_dispositions')
            .select('disposition, client_id')
            .in('client_id', clientIds)
            .gte('disposed_at', sinceISO),
          supabase.from('leads')
            .select('id, created_at, is_spam')
            .in('client_id', clientIds)
            .gte('created_at', sinceISO)
            .limit(5000),
          supabase.from('calls')
            .select('lead_id, direction, outcome, created_at')
            .in('client_id', clientIds)
            .gte('created_at', sinceISO)
            .limit(10000),
          supabase.from('contact_timeline_events')
            .select('lead_id, event_type, event_subtype, event_at')
            .in('client_id', clientIds)
            .gte('event_at', sinceISO)
            .limit(10000),
        ]);
        if (dailyRes.error) throw dailyRes.error;
        if (dispoRes.error) throw dispoRes.error;
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

        // Live KPIs from raw tables (setter-relevant, not daily_metrics)
        const validLeads = (leadsRes.data as any[] || []).filter((l) => !l.is_spam);
        const leadIds = new Set(validLeads.map((l) => l.id));
        const calls = (callsRes.data as any[] || []).filter((c) => leadIds.has(c.lead_id));
        const tl = (timelineRes.data as any[] || []).filter((e) => leadIds.has(e.lead_id));

        const outboundCalls = calls.filter((c) => c.direction === 'outbound');
        const connectOutcomes = new Set(['connected', 'answered', 'contact_made', 'live', 'talk', 'talked', 'conversation']);
        const connectedCalls = outboundCalls.filter((c) =>
          typeof c.outcome === 'string' && connectOutcomes.has(String(c.outcome).toLowerCase())
        );

        // First-touch per lead = earliest outbound call OR outbound timeline event
        const firstTouchByLead: Record<string, number> = {};
        const push = (id: string, ts: string) => {
          const t = new Date(ts).getTime();
          if (!firstTouchByLead[id] || t < firstTouchByLead[id]) firstTouchByLead[id] = t;
        };
        outboundCalls.forEach((c) => push(c.lead_id, c.created_at));
        tl.forEach((e) => {
          if (e.event_subtype === 'outbound' || e.event_type === 'appointment') push(e.lead_id, e.event_at);
        });

        const buckets = { under5m: 0, under15m: 0, under1h: 0, over1h: 0, never: 0 };
        let contacted = 0;
        validLeads.forEach((l) => {
          const first = firstTouchByLead[l.id];
          if (!first) { buckets.never += 1; return; }
          contacted += 1;
          const ttft = (first - new Date(l.created_at).getTime()) / 1000;
          if (ttft < 5 * 60) buckets.under5m += 1;
          else if (ttft < 15 * 60) buckets.under15m += 1;
          else if (ttft < 60 * 60) buckets.under1h += 1;
          else buckets.over1h += 1;
        });

        setLive({
          liveLeads: validLeads.length,
          contacted,
          connected: connectedCalls.length,
          dials: outboundCalls.length,
          slaBuckets: buckets,
        });
      } catch (e: any) {
        console.error('[SetterRollupBar] load failed:', e);
      } finally { setLoading(false); }
    })();
  }, [clientIds.join(','), win]);

  const cpl = summary.leads > 0 ? summary.spend / summary.leads : 0;
  const cps = summary.showed > 0 ? summary.spend / summary.showed : 0;
  const cpb = summary.booked > 0 ? summary.spend / summary.booked : 0;
  const qRate = summary.leads > 0 ? (summary.qualified / summary.leads) * 100 : 0;
  const bRate = summary.leads > 0 ? (summary.bad / summary.leads) * 100 : 0;
  const bookRate = summary.leads > 0 ? (summary.booked / summary.leads) * 100 : 0;

  // Setter-focused live KPIs
  const contactRate = live.liveLeads > 0 ? (live.contacted / live.liveLeads) * 100 : 0;
  const connectRate = live.dials > 0 ? (live.connected / live.dials) * 100 : 0;
  const dialsToContact = live.connected > 0 ? live.dials / live.connected : 0;
  const slaTotal = live.slaBuckets.under5m + live.slaBuckets.under15m + live.slaBuckets.under1h + live.slaBuckets.over1h;
  const under5Pct = slaTotal > 0 ? (live.slaBuckets.under5m / slaTotal) * 100 : 0;

  const cells: { label: string; value: string; tone?: 'good' | 'bad' | 'default'; hint?: string }[] = [
    { label: `Leads (${win})`, value: String(summary.leads) },
    { label: 'Qualified', value: pct(qRate), tone: 'good' },
    { label: 'Bad', value: pct(bRate), tone: bRate >= 25 ? 'bad' : 'default' },
    { label: 'Booked', value: pct(bookRate) },
    { label: 'CPL', value: money(cpl) },
    { label: 'Cost / Show', value: money(cps) },
    { label: 'Cost / Booked', value: money(cpb) },
  ];
  const setterCells: { label: string; value: string; tone?: 'good' | 'bad' | 'default'; hint?: string }[] = [
    { label: 'Contact rate', value: pct(contactRate), tone: contactRate >= 80 ? 'good' : contactRate < 50 ? 'bad' : 'default', hint: `${live.contacted}/${live.liveLeads} leads reached` },
    { label: 'Connect rate', value: pct(connectRate), tone: connectRate >= 25 ? 'good' : 'default', hint: `${live.connected} live conversations on ${live.dials} dials` },
    { label: 'Dials / contact', value: live.connected > 0 ? dialsToContact.toFixed(1) : '—', hint: 'Lower is better' },
    { label: 'SLA <5m', value: pct(under5Pct), tone: under5Pct >= 60 ? 'good' : under5Pct < 30 ? 'bad' : 'default', hint: `${live.slaBuckets.under5m} of ${slaTotal} contacted in <5m` },
  ];

  return (
    <TooltipProvider><div className="border-b bg-muted/30">
      <div className="px-6 py-2 flex items-center gap-3">
        <UserCheck className="w-4 h-4 text-primary" />
        <div className="text-xs font-semibold uppercase tracking-wider">Lead Quality Rollup</div>
        <span className="text-[10px] text-muted-foreground">
          {clientIds.length ? `${clientIds.length} client${clientIds.length === 1 ? '' : 's'}` : 'no clients selected'}
        </span>
        <Tooltip>
          <TooltipTrigger asChild><Info className="w-3 h-3 text-muted-foreground cursor-help" /></TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            <div className="font-semibold mb-1">Two data sources on this page:</div>
            <div className="mb-1"><b>Header stats</b> = live query on <code>leads</code> (queue-accurate, may hit 2k cap).</div>
            <div className="mb-1"><b>Left rollup cells</b> = <code>daily_metrics</code> aggregate (day-granular; may lag real-time ingest by up to 3h).</div>
            <div><b>Right rollup cells (setter KPIs)</b> = live query on <code>calls</code> + <code>contact_timeline_events</code> for the window.</div>
          </TooltipContent>
        </Tooltip>
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
        <div className="px-6 pb-2 space-y-2">
          <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
            {cells.map(c => (
              <div key={c.label} className="rounded-md border bg-background/70 px-3 py-1.5" title={c.hint || undefined}>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{c.label}</div>
                <div className={`text-sm font-semibold tabular-nums ${c.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : c.tone === 'bad' ? 'text-destructive' : ''}`}>
                  {loading ? '…' : c.value}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {setterCells.map(c => (
              <Tooltip key={c.label}>
                <TooltipTrigger asChild>
                  <div className="rounded-md border border-primary/20 bg-primary/[0.03] px-3 py-1.5 cursor-help">
                    <div className="text-[9px] uppercase tracking-wider text-primary/80 truncate">SETTER · {c.label}</div>
                    <div className={`text-sm font-semibold tabular-nums ${c.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : c.tone === 'bad' ? 'text-destructive' : ''}`}>
                      {loading ? '…' : c.value}
                    </div>
                  </div>
                </TooltipTrigger>
                {c.hint && <TooltipContent className="text-xs">{c.hint}</TooltipContent>}
              </Tooltip>
            ))}
          </div>
          {slaTotal > 0 && (
            <div className="flex items-center gap-1 h-2 rounded-full overflow-hidden bg-muted" title={`SLA distribution: <5m ${live.slaBuckets.under5m} · <15m ${live.slaBuckets.under15m} · <1h ${live.slaBuckets.under1h} · >1h ${live.slaBuckets.over1h}`}>
              <div className="h-full bg-emerald-500" style={{ width: `${(live.slaBuckets.under5m / slaTotal) * 100}%` }} />
              <div className="h-full bg-emerald-400/70" style={{ width: `${(live.slaBuckets.under15m / slaTotal) * 100}%` }} />
              <div className="h-full bg-amber-500" style={{ width: `${(live.slaBuckets.under1h / slaTotal) * 100}%` }} />
              <div className="h-full bg-destructive" style={{ width: `${(live.slaBuckets.over1h / slaTotal) * 100}%` }} />
            </div>
          )}
        </div>
      )}
    </div></TooltipProvider>
  );
}