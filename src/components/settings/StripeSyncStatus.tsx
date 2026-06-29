import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useUpdateClientSettings, type ClientSettings } from '@/hooks/useClientSettings';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  clientId: string;
  settings: ClientSettings | null | undefined;
}

export function StripeSyncStatus({ clientId, settings }: Props) {
  const [syncing, setSyncing] = useState(false);
  const update = useUpdateClientSettings();

  const email = settings?.stripe_email;
  const customerId = settings?.stripe_customer_id;
  const linked = Boolean(email || customerId);

  const lastAt = settings?.stripe_last_sync_at;
  const status = settings?.stripe_last_sync_status;
  const error = settings?.stripe_last_sync_error;

  const runSync = async () => {
    if (!linked) {
      toast.error('Add a Stripe email or customer ID first');
      return;
    }
    setSyncing(true);
    try {
      const body: any = { action: 'get-customer-payments' };
      if (customerId) body.customerId = customerId;
      else body.email = email;

      const { data, error: fnError } = await supabase.functions.invoke('stripe-payments', { body });
      if (fnError) throw fnError;

      const found = Boolean(data?.customer);
      const patch: Partial<ClientSettings> & { client_id: string } = {
        client_id: clientId,
        stripe_last_sync_at: new Date().toISOString(),
        stripe_last_sync_status: found ? 'success' : 'not_found',
        stripe_last_sync_error: found ? null : 'No matching Stripe customer found',
        stripe_last_sync_payments_count: data?.payments?.length ?? 0,
        stripe_last_sync_subscriptions_count: data?.subscriptions?.length ?? 0,
        stripe_last_sync_customer_id: data?.customer?.id ?? null,
        stripe_last_sync_total_paid: data?.totalPaid ?? 0,
        stripe_last_sync_mrr: data?.mrr ?? 0,
      };
      await update.mutateAsync(patch);
      toast.success(found ? 'Stripe sync completed' : 'No Stripe customer matched');
    } catch (e: any) {
      await update.mutateAsync({
        client_id: clientId,
        stripe_last_sync_at: new Date().toISOString(),
        stripe_last_sync_status: 'error',
        stripe_last_sync_error: e?.message ?? 'Sync failed',
      } as any);
      toast.error(`Stripe sync failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };

  const statusConfig = (() => {
    if (!lastAt) return { icon: Clock, label: 'Never synced', tone: 'text-muted-foreground', bg: 'bg-muted/30 border-border' };
    if (status === 'success') return { icon: CheckCircle2, label: 'Synced', tone: 'text-chart-2', bg: 'bg-chart-2/10 border-chart-2/30' };
    if (status === 'not_found') return { icon: XCircle, label: 'No customer found', tone: 'text-yellow-600 dark:text-yellow-500', bg: 'bg-yellow-500/10 border-yellow-500/30' };
    return { icon: XCircle, label: 'Sync error', tone: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30' };
  })();
  const Icon = statusConfig.icon;

  return (
    <div className={cn('mt-4 border-2 rounded p-3 space-y-2', statusConfig.bg)}>
      <div className="flex items-center justify-between gap-2">
        <div className={cn('flex items-center gap-2 text-sm font-medium', statusConfig.tone)}>
          <Icon className="h-4 w-4" />
          <span>{statusConfig.label}</span>
          {lastAt && (
            <span className="text-xs text-muted-foreground font-normal">
              · {formatDistanceToNow(new Date(lastAt), { addSuffix: true })}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={runSync} disabled={syncing || !linked}>
          {syncing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>

      {status === 'success' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Stat label="Payments" value={settings?.stripe_last_sync_payments_count ?? 0} />
          <Stat label="Subscriptions" value={settings?.stripe_last_sync_subscriptions_count ?? 0} />
          <Stat label="Total paid" value={`$${Number(settings?.stripe_last_sync_total_paid ?? 0).toLocaleString()}`} />
          <Stat label="MRR" value={`$${Number(settings?.stripe_last_sync_mrr ?? 0).toLocaleString()}`} />
        </div>
      )}

      {settings?.stripe_last_sync_customer_id && (
        <p className="text-[11px] text-muted-foreground font-mono break-all">
          Customer: {settings.stripe_last_sync_customer_id}
        </p>
      )}

      {error && status !== 'success' && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {!linked && (
        <p className="text-xs text-muted-foreground">Add an email or customer ID above to enable syncing.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background/60 border border-border rounded px-2 py-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}