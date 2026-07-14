import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SetterQueue } from '@/components/setter/SetterQueue';
import { SetterDetailPanel } from '@/components/setter/SetterDetailPanel';
import { useSetterLeads, fmtDuration, type SetterLead } from '@/hooks/useSetterLeads';
import { Zap, RefreshCw, RotateCw, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useClients } from '@/hooks/useClients';
import { ClientFilterPopover } from '@/components/setter/ClientFilterPopover';
import { SetterRollupBar } from '@/components/setter/SetterRollupBar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const LS_KEY = 'setter.enabledClientIds.v1';

function readStored(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

export default function SetterPage() {
  const { data: allClients = [] } = useClients();
  const activeClients = useMemo(
    () => allClients.filter((c: any) => c.status === 'active').map((c: any) => ({ id: c.id, name: c.name })),
    [allClients]
  );

  const [enabledIds, _setEnabledIds] = useState<string[]>(readStored);
  // Write-through setter: persist synchronously so a fast tab switch/unmount can't drop it.
  const setEnabledIds = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    _setEnabledIds((prev) => {
      const value = typeof next === 'function' ? (next as any)(prev) : next;
      try { localStorage.setItem(LS_KEY, JSON.stringify(value)); } catch {}
      return value;
    });
  }, []);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) _setEnabledIds(readStored());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Prune stale ids once clients are loaded (client removed / paused / renamed away).
  // Only prune when we actually have a client list to compare against, so we don't
  // wipe the user's selection during the first render while clients are still loading.
  const prunedOnce = useRef(false);
  useEffect(() => {
    if (!activeClients.length || prunedOnce.current) return;
    prunedOnce.current = true;
    const valid = new Set(activeClients.map(c => c.id));
    const cleaned = enabledIds.filter(id => id === '__none__' || valid.has(id));
    if (cleaned.length !== enabledIds.length) setEnabledIds(cleaned);
  }, [activeClients, enabledIds, setEnabledIds]);

  // Effective set for rollup (never empty — fall back to all active)
  const rollupClientIds = useMemo(() => {
    if (!enabledIds.length) return activeClients.map(c => c.id);
    if (enabledIds.length === 1 && enabledIds[0] === '__none__') return [];
    return enabledIds.filter(id => id !== '__none__');
  }, [enabledIds, activeClients]);

  const { leads, loading, error, refresh, stats } = useSetterLeads(rollupClientIds);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingConvos, setSyncingConvos] = useState(false);
  const [lastConvoSync, setLastConvoSync] = useState<Date | null>(null);

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

  const syncConversations = async () => {
    if (!rollupClientIds.length) { toast.warning('No clients selected'); return; }
    setSyncingConvos(true);
    try {
      const results = await Promise.allSettled(
        rollupClientIds.map((cid) =>
          supabase.functions.invoke('sync-ghl-contacts', {
            body: { client_id: cid, mode: 'conversations', syncTimeline: true },
          })
        )
      );
      const ok = results.filter((r) => r.status === 'fulfilled' && !(r as any).value?.error).length;
      const failed = results.length - ok;
      setLastConvoSync(new Date());
      await refresh();
      if (failed === 0) toast.success(`Conversations synced across ${ok} client${ok === 1 ? '' : 's'}`);
      else toast.warning(`Synced ${ok}/${results.length} clients — ${failed} failed`);
    } catch (e: any) {
      toast.error(`Conversation sync failed: ${e?.message || e}`);
    } finally { setSyncingConvos(false); }
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
          <Button
            variant="default"
            size="sm"
            onClick={syncConversations}
            disabled={syncingConvos || rollupClientIds.length === 0}
            className="gap-1"
            title={lastConvoSync ? `Last conversation sync: ${lastConvoSync.toLocaleTimeString()}` : 'Sync SMS/Email conversations across selected clients'}
          >
            <MessageSquare className={`w-3.5 h-3.5 ${syncingConvos ? 'animate-pulse' : ''}`} />
            <span className="text-xs">
              {syncingConvos ? 'Syncing convos…' : `Sync conversations (${rollupClientIds.length})`}
            </span>
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