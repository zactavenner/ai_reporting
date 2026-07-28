import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, Loader2, RefreshCw, Smartphone, LogOut, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Props {
  session: {
    status: string;
    last_qr: string | null;
    last_qr_at: string | null;
    last_connected_at: string | null;
    last_error: string | null;
    phone_number: string | null;
  } | null;
  bridgeConfigured: boolean | null;
  onRefresh: () => void;
  onLogout: () => void;
  onReset: () => void;
  refreshing: boolean;
}

type StepState = 'done' | 'active' | 'pending';

export function WhatsAppOnboardingWizard({ session, bridgeConfigured, onRefresh, onLogout, onReset, refreshing }: Props) {
  const status = session?.status ?? 'unknown';
  const qrStale = session?.last_qr_at
    ? (Date.now() - new Date(session.last_qr_at).getTime()) > 60_000
    : true;

  const steps = useMemo(() => {
    const s = [
      {
        title: 'Bridge deployed & reachable',
        detail: bridgeConfigured === false
          ? 'Bridge secrets missing. Deploy bridge/ and add WHATSAPP_BRIDGE_URL + token.'
          : 'WhatsApp bridge is configured and answering.',
        state: (bridgeConfigured ? 'done' : bridgeConfigured === false ? 'active' : 'pending') as StepState,
      },
      {
        title: 'Generate a fresh pairing code',
        detail: session?.last_qr && !qrStale
          ? `QR ready — generated ${formatDistanceToNow(new Date(session.last_qr_at!), { addSuffix: true })}.`
          : 'Tap New QR to reset the bridge session and generate a fresh pairing code.',
        state: (status === 'connected' ? 'done'
          : status === 'qr' && session?.last_qr && !qrStale ? 'done'
          : bridgeConfigured ? 'active' : 'pending') as StepState,
      },
      {
        title: 'Scan with your phone',
        detail: 'WhatsApp → Settings → Linked Devices → Link a Device → point camera at the QR below.',
        state: (status === 'connected' ? 'done'
          : status === 'qr' ? 'active' : 'pending') as StepState,
      },
      {
        title: 'Session live',
        detail: status === 'connected'
          ? `Connected as +${session?.phone_number ?? '—'}${session?.last_connected_at ? ` · paired ${formatDistanceToNow(new Date(session.last_connected_at), { addSuffix: true })}` : ''}`
          : 'Bridge will confirm pairing within ~10s of scanning.',
        state: (status === 'connected' ? 'done' : 'pending') as StepState,
      },
    ];
    return s;
  }, [session, bridgeConfigured, status, qrStale]);

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Pair your WhatsApp
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Follow the steps below. The bridge stays paired for ~14 days as long as your phone
            comes online at least once.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
          <Button size="sm" onClick={onReset} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Smartphone className="h-4 w-4 mr-2" />}
            New QR
          </Button>
          {status === 'connected' && (
            <Button size="sm" variant="outline" onClick={onLogout}>
              <LogOut className="h-4 w-4 mr-2" /> Re-pair
            </Button>
          )}
        </div>
      </div>

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            {s.state === 'done' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            ) : s.state === 'active' ? (
              <Loader2 className="h-5 w-5 text-amber-500 animate-spin flex-shrink-0 mt-0.5" />
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            )}
            <div>
              <p className={`text-sm font-medium ${s.state === 'active' ? '' : s.state === 'done' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                {i + 1}. {s.title}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {status === 'qr' && session?.last_qr && (
        <div className="flex flex-col items-center gap-2 pt-2 border-t">
          <img src={session.last_qr} alt="WhatsApp QR" className="w-56 h-56 border rounded-lg" />
          {qrStale && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> QR may be expired — tap New QR.
            </p>
          )}
        </div>
      )}

      {session?.last_error && (
        <div className="text-xs text-red-600 border-t pt-3 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
          <div>
            <div className="font-medium">Last bridge error</div>
            <div className="font-mono opacity-80 break-all">{session.last_error}</div>
          </div>
        </div>
      )}
    </Card>
  );
}