import { useMemo, useState } from 'react';
import { SetterQueue } from '@/components/setter/SetterQueue';
import { SetterDetailPanel } from '@/components/setter/SetterDetailPanel';
import { useSetterLeads, fmtDuration, type SetterLead } from '@/hooks/useSetterLeads';
import { Zap, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function SetterPage() {
  const { leads, loading, error, refresh, stats } = useSetterLeads();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected: SetterLead | null = useMemo(
    () => leads.find(l => l.id === selectedId) || null,
    [leads, selectedId]
  );

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
          <Button variant="ghost" size="sm" onClick={refresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </header>

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