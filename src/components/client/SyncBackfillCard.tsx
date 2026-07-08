import { useState } from 'react';
import { subDays, format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DateRangePresetPicker } from '@/components/shared/DateRangePresetPicker';
import { Loader2, RefreshCw, Database, Phone, DollarSign, Sparkles, Tag, GitBranch, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  clientId: string;
  clientName?: string;
}

type SyncKey = 'leads' | 'calls' | 'ads' | 'enrichment' | 'dispositions' | 'pipelines' | 'audit';

const SYNCS: { key: SyncKey; label: string; icon: any; fn: string; extra?: Record<string, unknown>; describe: string }[] = [
  { key: 'leads', label: 'Leads (GHL contacts)', icon: Database, fn: 'sync-ghl-contacts', extra: { mode: 'master_sync' }, describe: 'Pulls contacts + UTMs from GHL' },
  { key: 'calls', label: 'Calls (calendar)', icon: Phone, fn: 'sync-calendar-appointments', describe: 'Reconciles booked calls & showed status' },
  { key: 'ads', label: 'Meta ad insights', icon: DollarSign, fn: 'sync-meta-ad-daily-insights', describe: 'Daily spend / impressions / clicks / leads' },
  { key: 'enrichment', label: 'Lead enrichment', icon: Sparkles, fn: 'bulk-enrich-account', describe: 'Enriches unenriched leads via RetargetIQ' },
  { key: 'dispositions', label: 'Lead dispositions', icon: Tag, fn: 'sync-lead-dispositions', describe: 'Pulls disposition custom fields' },
  { key: 'pipelines', label: 'Pipelines (committed/funded)', icon: GitBranch, fn: 'sync-ghl-pipelines', extra: { sync_contacts: true }, describe: 'Committed + funded pipeline totals' },
];

export function SyncBackfillCard({ clientId, clientName }: Props) {
  const [range, setRange] = useState<{ from: Date; to: Date }>(() => {
    const to = subDays(new Date(), 1);
    return { from: subDays(to, 6), to };
  });
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [lastResult, setLastResult] = useState<Record<string, string>>({});

  async function runSync(key: SyncKey, fn: string, extra?: Record<string, unknown>, backfill = false) {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const body: Record<string, unknown> = {
        client_id: clientId,
        clientId,
        ...(extra || {}),
      };
      if (backfill) {
        body.start_date = format(range.from, 'yyyy-MM-dd');
        body.end_date = format(range.to, 'yyyy-MM-dd');
      }
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw new Error(error.message);
      const summary = data?.summary || data?.message || (data?.results?.length ? `${data.results.length} rows` : 'ok');
      setLastResult((r) => ({ ...r, [key]: String(summary).slice(0, 80) }));
      toast.success(`${key}: ${backfill ? 'backfill' : 'sync'} triggered`);
    } catch (e: any) {
      toast.error(`${key} failed: ${e.message}`);
      setLastResult((r) => ({ ...r, [key]: `error: ${e.message}`.slice(0, 80) }));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  async function runAudit() {
    setBusy((b) => ({ ...b, audit: true }));
    try {
      const { data, error } = await supabase.functions.invoke('audit-client-accuracy', {
        body: {
          client_id: clientId,
          cadence: 'manual',
          start_date: format(range.from, 'yyyy-MM-dd'),
          end_date: format(range.to, 'yyyy-MM-dd'),
          auto_remediate: true,
        },
      });
      if (error) throw new Error(error.message);
      const r = data?.results?.[0];
      toast.success(`Audit complete: ${r?.passed || 0} pass, ${r?.warnings || 0} warn, ${r?.failures || 0} fail`);
      setLastResult((rr) => ({ ...rr, audit: `${r?.total || 0} checks · ${r?.dispatched?.length || 0} fixes queued` }));
    } catch (e: any) {
      toast.error(`Audit failed: ${e.message}`);
    } finally {
      setBusy((b) => ({ ...b, audit: false }));
    }
  }

  return (
    <div className="border-2 border-border rounded-lg p-4 space-y-4 bg-card">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            Sync &amp; Backfill{clientName ? ` — ${clientName}` : ''}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Run any sync now, or backfill a date range to repair missed UTMs / stats.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Backfill window:</span>
          <DateRangePresetPicker value={range} onChange={setRange} />
        </div>
      </div>

      <div className="grid gap-2">
        {SYNCS.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-3 border border-border rounded-md p-2.5 bg-muted/20">
            <div className="flex items-center gap-3 min-w-0">
              <s.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{s.label}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {lastResult[s.key] || s.describe}
                </div>
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button size="sm" variant="outline" disabled={!!busy[s.key]} onClick={() => runSync(s.key, s.fn, s.extra, false)}>
                {busy[s.key] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Run now'}
              </Button>
              <Button size="sm" variant="secondary" disabled={!!busy[s.key]} onClick={() => runSync(s.key, s.fn, s.extra, true)}>
                Backfill
              </Button>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between gap-3 border-2 border-primary/40 rounded-md p-2.5 bg-primary/5 mt-2">
          <div className="flex items-center gap-3 min-w-0">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium">Run accuracy audit</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {lastResult.audit || 'Compares Meta + GHL vs DB, auto-fixes variances >5%'}
              </div>
            </div>
          </div>
          <Button size="sm" disabled={!!busy.audit} onClick={runAudit}>
            {busy.audit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Audit now'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border">
        <Badge variant="outline" className="text-[10px]">Auto</Badge>
        Daily audit 04:00 UTC · Weekly Mon 05:00 · Monthly 1st 05:30 (auto-remediates when variance {'>'} 5%).
      </div>
    </div>
  );
}