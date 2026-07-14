import { useEffect, useMemo, useState } from 'react';
import { SetterQueue } from '@/components/setter/SetterQueue';
import { SetterDetailPanel } from '@/components/setter/SetterDetailPanel';
import { useSetterLeads, fmtDuration, type SetterLead } from '@/hooks/useSetterLeads';
import { Zap, RefreshCw, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useClients } from '@/hooks/useClients';
import { ClientFilterPopover } from '@/components/setter/ClientFilterPopover';
import { SetterRollupBar } from '@/components/setter/SetterRollupBar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const LS_KEY = 'setter.enabledClientIds.v1';

export default function SetterPage() {
  const { data: allClients = [] } = useClients();
  const activeClients = useMemo(
    () => allClients.filter((c: any) => c.status === 'active').map((c: any) => ({ id: c.id, name: c.name })),
    [allClients]
  );

  const [enabledIds, setEnabledIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw) as string[];
    } catch {}
    return []; // empty = all
  });
  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(enabledIds));
  }, [enabledIds]);

  // Effective set for rollup (never empty — fall back to all active)
  const rollupClientIds = useMemo(() => {
    if (!enabledIds.length) return activeClients.map(c => c.id);
    if (enabledIds.length === 1 && enabledIds[0] === '__none__') return [];
    return enabledIds.filter(id => id !== '__none__');
  }, [enabledIds, activeClients]);

  const { leads, loading, error, refresh, stats } = useSetterLeads(rollupClientIds);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const selected: SetterLead | null = useMemo(
    () => leads.find(l => l.id === selectedId) || null,
    [leads, selectedId]
  );

  const runManualSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('daily-master-sync', { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Sync kicked off — refreshing…');
      await refresh();
    } catch (e: any) {
      toast.error(`Sync failed: ${e?.message || e}`);
    } finally { setSyncing(false); }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="border-b px-6 py-3 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Setter</h1>
          <span className="text-xs text-muted-foreground ml-2">Speed-to-lead · rolling 24h</span>
        </div>
        <div className="flex items-center gap-5 ml-auto text-sm">
          <Stat label="Leads" value={String(stats.total)} />
          <Stat label="Uncontacted" value={String(stats.uncontacted)} tone={stats.uncontacted > 0 ? 'warn' : 'ok'} />
          <Stat label="Avg speed" value={stats.avgTtftSec > 0 ? fmtDuration(stats.avgTtftSec) : '—'} />
          <Stat
            label="Oldest waiting"
            value={stats.oldestUncontactedS > 0 ? fmtDuration(stats.oldestUncontactedS) : '—'}
            tone={stats.oldestUncontactedS >= 900 ? 'bad' : stats.oldestUncontactedS >= 300 ? 'warn' : 'ok'}
          />
          <ClientFilterPopover clients={activeClients} selectedIds={enabledIds} onChange={setEnabledIds} />
          <Button variant="outline" size="sm" onClick={runManualSync} disabled={syncing} className="gap-1">
            <RotateCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span className="text-xs">{syncing ? 'Syncing…' : 'Sync now'}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh} title="Refresh view">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <SetterRollupBar clientIds={rollupClientIds} />

      {error && (
        <div className="p-3 text-sm text-destructive border-b bg-destructive/5">Error: {error}</div>
      )}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[360px_1fr] min-h-0">
        <aside className="border-r min-h-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading leads…</div>
          ) : (
            <SetterQueue leads={leads} selectedId={selectedId} onSelect={(l) => setSelectedId(l.id)} />
          )}
        </aside>
        <section className="min-h-0">
          <SetterDetailPanel lead={selected} onChanged={refresh} />
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'ok' | 'warn' | 'bad' }) {
  const color =
    tone === 'bad' ? 'text-destructive' :
    tone === 'warn' ? 'text-amber-500' :
    tone === 'ok' ? 'text-emerald-500' : 'text-foreground';
  return (
    <div className="text-right">
      <div className={`font-mono tabular-nums font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}