import { useEffect, useState, useCallback } from 'react';
import { whatsappDashboard } from '@/lib/whatsappDashboard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, CheckCircle2, XCircle, Clock, RefreshCw, Loader2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { WhatsAppOnboardingWizard } from './WhatsAppOnboardingWizard';

interface Session {
  id: string; label: string; status: string;
  phone_number: string | null;
  last_qr: string | null; last_qr_at: string | null;
  last_connected_at: string | null; last_error: string | null;
  updated_at?: string;
}
interface QueueRow {
  id: string; jid: string; phone: string | null;
  message: string; source: string; alert_type: string | null;
  status: string; attempts: number; max_attempts: number;
  last_error: string | null; last_attempt_at: string | null;
  next_attempt_at: string; sent_at: string | null; created_at: string;
}

interface Props {
  session: Session | null;
  bridgeConfigured: boolean | null;
  bridgeReachable?: boolean | null;
  bridgeError?: string | null;
  onRefresh: () => void;
  onLogout: () => void;
  onReset: () => void;
  refreshing: boolean;
}

export function WhatsAppHealthTab({ session, bridgeConfigured, bridgeReachable, bridgeError, onRefresh, onLogout, onReset, refreshing }: Props) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [stats, setStats] = useState({ pending: 0, failed: 0, sending: 0, sent: 0, dead: 0 });
  const [draining, setDraining] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<any>(null);

  const diagnoseBridge = async () => {
    setProbing(true);
    try {
      const r = await whatsappDashboard<any>('bridge_probe');
      setProbe(r);
      if (r?.bridgeReachable) toast.success(`Bridge OK (HTTP ${r.bridgeStatus})`);
      else toast.error(r?.bridgeError || 'Bridge unreachable');
    } catch (e: any) { toast.error('Probe failed: ' + e.message); }
    finally { setProbing(false); }
  };

  const loadQueue = useCallback(async () => {
    try {
      const r = await whatsappDashboard<{ queue: QueueRow[]; stats: any }>('queue_list');
      setQueue(r.queue || []);
      setStats({
        pending: r.stats?.pending ?? 0,
        failed: r.stats?.failed ?? 0,
        sending: r.stats?.sending ?? 0,
        sent: r.stats?.sent ?? 0,
        dead: r.stats?.dead ?? 0,
      });
    } catch (e: any) { /* transient */ }
  }, []);

  useEffect(() => {
    loadQueue();
    const id = window.setInterval(loadQueue, 5000);
    return () => window.clearInterval(id);
  }, [loadQueue]);

  const drainNow = async () => {
    setDraining(true);
    try {
      const data = await whatsappDashboard<any>('queue_drain_now');
      if (data?.skipped) toast.warning(`Skipped: ${data.skipped}`);
      else toast.success(`Drained ${data?.drained ?? data?.results?.length ?? 0} (${data?.succeeded ?? 0} sent)`);
      loadQueue();
    } catch (e: any) { toast.error('Drain failed: ' + e.message); }
    finally { setDraining(false); }
  };
  const retryRow = async (id: string) => {
    try { await whatsappDashboard('queue_retry', { id }); toast.success('Requeued'); loadQueue(); }
    catch (e: any) { toast.error(e.message); }
  };
  const cancelRow = async (id: string) => {
    try { await whatsappDashboard('queue_cancel', { id }); loadQueue(); }
    catch (e: any) { toast.error(e.message); }
  };
  const purgeSent = async () => {
    if (!confirm('Delete all sent + dead queue rows?')) return;
    try { await whatsappDashboard('queue_purge'); loadQueue(); }
    catch (e: any) { toast.error(e.message); }
  };

  const statusPill = (s: string) => {
    const map: Record<string, string> = {
      connected: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      qr: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      connecting: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
      disconnected: 'bg-muted text-muted-foreground',
      logged_out: 'bg-red-500/15 text-red-700 dark:text-red-400',
      error: 'bg-red-500/15 text-red-700 dark:text-red-400',
    };
    return <Badge variant="outline" className={map[s] || map.disconnected}>{s}</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* Device health card */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" /> Bridge & Device
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div>
                <div className="text-xs text-muted-foreground">Status</div>
                <div className="mt-1">{statusPill(session?.status ?? 'unknown')}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Bridge</div>
                <div className="mt-1">
                  {bridgeConfigured === false ? (
                    <Badge variant="outline" className="bg-red-500/15 text-red-700 dark:text-red-400">not configured</Badge>
                  ) : bridgeReachable === true ? (
                    <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">reachable</Badge>
                  ) : bridgeReachable === false ? (
                    <Badge variant="outline" className="bg-red-500/15 text-red-700 dark:text-red-400">unreachable</Badge>
                  ) : <Badge variant="outline">unknown</Badge>}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Paired number</div>
                <div className="text-sm mt-1">{session?.phone_number ? `+${session.phone_number}` : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last connected</div>
                <div className="text-sm mt-1">
                  {session?.last_connected_at
                    ? formatDistanceToNow(new Date(session.last_connected_at), { addSuffix: true })
                    : 'never'}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last QR</div>
                <div className="text-sm mt-1">
                  {session?.last_qr_at ? formatDistanceToNow(new Date(session.last_qr_at), { addSuffix: true }) : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last sync</div>
                <div className="text-sm mt-1">
                  {session?.updated_at ? formatDistanceToNow(new Date(session.updated_at), { addSuffix: true }) : '—'}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Last error</div>
                <div className="text-xs mt-1 font-mono break-all text-red-600 dark:text-red-400">
                  {session?.last_error || bridgeError || '—'}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={diagnoseBridge} disabled={probing}>
              {probing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
              Diagnose bridge
            </Button>
          </div>
        </div>
        {probe && (
          <pre className="mt-4 text-[10px] bg-muted/40 rounded p-2 overflow-auto max-h-48">
{JSON.stringify(probe, null, 2)}
          </pre>
        )}
      </Card>

      {/* Onboarding wizard — shown until connected */}
      {session?.status !== 'connected' && (
        <WhatsAppOnboardingWizard
          session={session}
          bridgeConfigured={bridgeConfigured}
          onRefresh={onRefresh}
          onLogout={onLogout}
          onReset={onReset}
          refreshing={refreshing}
        />
      )}

      {/* Send queue */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Send queue</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Failed and unpaired sends are held here and auto-retried every 2 minutes once the bridge is connected.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={purgeSent}>
              <Trash2 className="h-4 w-4 mr-1" /> Purge sent/dead
            </Button>
            <Button size="sm" onClick={drainNow} disabled={draining}>
              {draining ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Drain now
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatCard label="Pending" value={stats.pending} tone="amber" />
          <StatCard label="Failed (retrying)" value={stats.failed} tone="red" />
          <StatCard label="Sent" value={stats.sent} tone="emerald" />
          <StatCard label="Dead" value={stats.dead} tone="zinc" />
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">To</th>
                <th className="text-left px-3 py-2">Source</th>
                <th className="text-left px-3 py-2">Message</th>
                <th className="text-left px-3 py-2">Attempts</th>
                <th className="text-left px-3 py-2">Next / Sent</th>
                <th className="text-left px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-xs">Queue is empty.</td></tr>
              )}
              {queue.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">
                    {r.status === 'sent' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />sent</span>
                    ) : r.status === 'dead' ? (
                      <span className="inline-flex items-center gap-1 text-red-600"><XCircle className="h-3.5 w-3.5" />dead</span>
                    ) : r.status === 'failed' ? (
                      <span className="inline-flex items-center gap-1 text-red-500"><Clock className="h-3.5 w-3.5" />retrying</span>
                    ) : r.status === 'sending' ? (
                      <span className="inline-flex items-center gap-1 text-blue-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />sending</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600"><Clock className="h-3.5 w-3.5" />pending</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.phone || r.jid.split('@')[0]}</td>
                  <td className="px-3 py-2 text-xs">
                    <Badge variant="outline" className="text-xs">{r.source}{r.alert_type ? `/${r.alert_type}` : ''}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs max-w-xs truncate" title={r.message}>{r.message}</td>
                  <td className="px-3 py-2 text-xs">{r.attempts}/{r.max_attempts}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.status === 'sent' && r.sent_at
                      ? `sent ${formatDistanceToNow(new Date(r.sent_at), { addSuffix: true })}`
                      : r.status === 'dead'
                      ? 'gave up'
                      : `retry ${formatDistanceToNow(new Date(r.next_attempt_at), { addSuffix: true })}`}
                    {r.last_error && (
                      <div className="text-[10px] text-red-500 font-mono truncate max-w-xs" title={r.last_error}>{r.last_error}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status !== 'sent' && r.status !== 'sending' && (
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="outline" onClick={() => retryRow(r.id)}>Retry now</Button>
                        {r.status !== 'dead' && (
                          <Button size="sm" variant="ghost" onClick={() => cancelRow(r.id)}>Cancel</Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'red' | 'emerald' | 'zinc' }) {
  const map = {
    amber: 'border-amber-500/20 bg-amber-500/5',
    red: 'border-red-500/20 bg-red-500/5',
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
    zinc: 'border-muted bg-muted/30',
  };
  return (
    <div className={`rounded-lg border p-3 ${map[tone]}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}