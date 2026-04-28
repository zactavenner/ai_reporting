import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShieldCheck, ShieldAlert, RefreshCw, Plug, ChevronDown, ChevronUp, Loader2, Clock, KeyRound } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Severity = 'ok' | 'stale' | 'error' | 'expired' | 'missing';

interface Row {
  clientId: string;
  clientName: string;
  integration: 'meta_ads' | 'google_ads';
  isConnected: boolean;
  lastSyncAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  errorCount: number;
  tokenExpiresAt: string | null;
  hasToken: boolean;
  hasAccountId: boolean;
  severity: Severity;
  severityLabel: string;
}

const STALE_HOURS = 24;

function classify(input: Omit<Row, 'severity' | 'severityLabel'>): { severity: Severity; severityLabel: string } {
  if (!input.hasToken || !input.hasAccountId) {
    return { severity: 'missing', severityLabel: 'Not configured' };
  }
  if (input.tokenExpiresAt && new Date(input.tokenExpiresAt) < new Date()) {
    return { severity: 'expired', severityLabel: 'Token expired' };
  }
  if (input.lastStatus && /error|fail/i.test(input.lastStatus)) {
    return { severity: 'error', severityLabel: 'Last sync failed' };
  }
  if (input.lastSyncAt) {
    const ageH = (Date.now() - new Date(input.lastSyncAt).getTime()) / 36e5;
    if (ageH > STALE_HOURS) return { severity: 'stale', severityLabel: `Stale (${Math.round(ageH)}h)` };
  } else {
    return { severity: 'stale', severityLabel: 'Never synced' };
  }
  return { severity: 'ok', severityLabel: 'Healthy' };
}

const sevStyles: Record<Severity, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  stale: 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
  error: 'border-destructive/40 bg-destructive/5 text-destructive',
  expired: 'border-destructive/40 bg-destructive/5 text-destructive',
  missing: 'border-muted-foreground/20 bg-muted/30 text-muted-foreground',
};

interface Props {
  /** Optional restriction to one client (per-client view). When omitted, shows all clients. */
  clientId?: string;
}

export function AdsConnectionHealthPanel({ clientId }: Props) {
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [showHealthy, setShowHealthy] = useState(false);
  const [reconnectRow, setReconnectRow] = useState<Row | null>(null);
  const [newToken, setNewToken] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['ads-connection-health', clientId || 'all'],
    queryFn: async (): Promise<Row[]> => {
      const clientsQ = supabase
        .from('clients')
        .select('id, name, status, meta_ad_account_id, meta_access_token')
        .in('status', ['active', 'onboarding', 'paused']);
      const integ = supabase
        .from('integration_status')
        .select('client_id, integration_name, is_connected, last_sync_at, last_sync_status, last_error_message, error_count, token_expires_at')
        .in('integration_name', ['meta_ads', 'google_ads']);

      const [{ data: clients, error: e1 }, { data: integs, error: e2 }] = await Promise.all([clientsQ, integ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const integByKey = new Map<string, any>();
      (integs || []).forEach((i: any) => integByKey.set(`${i.client_id}:${i.integration_name}`, i));

      const rows: Row[] = [];
      (clients || []).forEach((c: any) => {
        if (clientId && c.id !== clientId) return;
        (['meta_ads'] as const).forEach((integration) => {
          const i = integByKey.get(`${c.id}:${integration}`) || {};
          const base = {
            clientId: c.id,
            clientName: c.name,
            integration,
            isConnected: Boolean(i.is_connected),
            lastSyncAt: i.last_sync_at || null,
            lastStatus: i.last_sync_status || null,
            lastError: i.last_error_message || null,
            errorCount: i.error_count || 0,
            tokenExpiresAt: i.token_expires_at || null,
            hasToken: Boolean(c.meta_access_token),
            hasAccountId: Boolean(c.meta_ad_account_id),
          };
          rows.push({ ...base, ...classify(base) });
        });
      });
      // Sort: worst first
      const order: Record<Severity, number> = { expired: 0, error: 1, missing: 2, stale: 3, ok: 4 };
      return rows.sort((a, b) => order[a.severity] - order[b.severity] || a.clientName.localeCompare(b.clientName));
    },
    refetchInterval: 60_000,
  });

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { ok: 0, stale: 0, error: 0, expired: 0, missing: 0 };
    (data || []).forEach((r) => { c[r.severity]++; });
    return c;
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    return showHealthy ? data : data.filter((r) => r.severity !== 'ok');
  }, [data, showHealthy]);

  const issuesTotal = (data?.length || 0) - counts.ok;

  const retryMut = useMutation({
    mutationFn: async (row: Row) => {
      const fn = row.integration === 'meta_ads' ? 'sync-meta-ads' : 'sync-google-ads';
      const { error } = await supabase.functions.invoke(fn, { body: { clientId: row.clientId } });
      if (error) throw new Error(error.message);
    },
    onMutate: (row) => setRetrying((s) => ({ ...s, [row.clientId + row.integration]: true })),
    onSettled: (_d, _e, row) => setRetrying((s) => {
      const n = { ...s }; delete n[row.clientId + row.integration]; return n;
    }),
    onSuccess: () => {
      toast.success('Sync triggered');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['ads-connection-health'] }), 1500);
    },
    onError: (e: any) => toast.error(e?.message || 'Sync failed'),
  });

  const reconnectMut = useMutation({
    mutationFn: async () => {
      if (!reconnectRow) throw new Error('No client selected');
      const updates: Record<string, any> = {};
      if (newToken.trim()) updates.meta_access_token = newToken.trim();
      if (newAccountId.trim()) updates.meta_ad_account_id = newAccountId.trim().replace(/^act_/, '');
      if (!Object.keys(updates).length) throw new Error('Provide a new access token or ad account ID');
      const { error } = await supabase.from('clients').update(updates).eq('id', reconnectRow.clientId);
      if (error) throw error;
      // Reset error counters and trigger a fresh sync
      await supabase
        .from('integration_status')
        .update({ last_sync_status: 'pending', last_error_message: null, error_count: 0 })
        .eq('client_id', reconnectRow.clientId)
        .eq('integration_name', reconnectRow.integration);
      const { error: syncErr } = await supabase.functions.invoke('sync-meta-ads', { body: { clientId: reconnectRow.clientId } });
      if (syncErr) throw new Error(syncErr.message);
    },
    onSuccess: () => {
      toast.success('Reconnected — sync started');
      setReconnectRow(null);
      setNewToken('');
      setNewAccountId('');
      qc.invalidateQueries({ queryKey: ['ads-connection-health'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Reconnect failed'),
  });

  const allHealthy = !isLoading && issuesTotal === 0 && (data?.length || 0) > 0;

  return (
    <Card className={cn(
      'overflow-hidden border',
      issuesTotal > 0
        ? 'border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-background to-background'
        : 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-background to-background',
    )}>
      <div className="flex items-center justify-between gap-3 p-3 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'h-7 w-7 rounded-md grid place-items-center shrink-0',
            issuesTotal > 0 ? 'bg-amber-500/10' : 'bg-emerald-500/10',
          )}>
            {issuesTotal > 0
              ? <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              : <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2 flex-wrap">
              Ads Connection Health
              {isLoading ? (
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">Loading…</Badge>
              ) : issuesTotal > 0 ? (
                <Badge variant="destructive" className="text-[10px] h-4 px-1.5">{issuesTotal} need attention</Badge>
              ) : allHealthy ? (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0">All healthy</Badge>
              ) : null}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {data
                ? `${counts.ok} healthy · ${counts.stale} stale · ${counts.error} failed · ${counts.expired} expired · ${counts.missing} unconfigured`
                : 'Checking ad account sync status…'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!clientId && (
            <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setShowHealthy((v) => !v)}>
              {showHealthy ? 'Hide healthy' : 'Show all'}
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => qc.invalidateQueries({ queryKey: ['ads-connection-health'] })}
            title="Refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-1.5">
          {visible.length === 0 && !isLoading && (
            <div className="text-xs text-muted-foreground text-center py-3">
              {issuesTotal === 0 ? 'All ad account syncs are running normally.' : 'No issues match the current filter.'}
            </div>
          )}
          {visible.map((row) => {
            const key = row.clientId + row.integration;
            const isRetrying = retrying[key];
            const needsReconnect = row.severity === 'expired' || row.severity === 'missing'
              || (row.severity === 'error' && /token|auth|oauth|401|permission/i.test(row.lastError || ''));
            return (
              <div
                key={key}
                className={cn('rounded-md border p-2.5 flex items-center gap-3 flex-wrap', sevStyles[row.severity])}
              >
                <div className="flex-1 min-w-[180px]">
                  <div className="text-sm font-medium text-foreground flex items-center gap-2">
                    {row.clientName}
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 uppercase border-current/30">
                      {row.integration === 'meta_ads' ? 'Meta' : 'Google'}
                    </Badge>
                  </div>
                  <div className="text-[11px] mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{row.severityLabel}</span>
                    {row.lastSyncAt && (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(row.lastSyncAt), { addSuffix: true })}
                      </span>
                    )}
                    {row.errorCount > 0 && (
                      <span className="text-muted-foreground">· {row.errorCount} consecutive error{row.errorCount === 1 ? '' : 's'}</span>
                    )}
                  </div>
                  {row.lastError && row.severity !== 'ok' && (
                    <div className="text-[10px] text-muted-foreground mt-1 truncate max-w-xl" title={row.lastError}>
                      {row.lastError}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {row.severity !== 'missing' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      disabled={isRetrying}
                      onClick={() => retryMut.mutate(row)}
                    >
                      {isRetrying ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      Retry sync
                    </Button>
                  )}
                  {needsReconnect && (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        setReconnectRow(row);
                        setNewAccountId('');
                        setNewToken('');
                      }}
                    >
                      <Plug className="h-3 w-3 mr-1" />
                      Reconnect
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!reconnectRow} onOpenChange={(o) => !o && setReconnectRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              Reconnect Ads account
            </DialogTitle>
            <DialogDescription>
              {reconnectRow?.clientName} — paste a fresh long-lived Meta access token. Generate one from
              {' '}<a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer" className="underline">Graph API Explorer</a>{' '}
              with <code className="text-[10px]">ads_read</code>, <code className="text-[10px]">ads_management</code>, and <code className="text-[10px]">business_management</code> scopes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reconnect-token">New access token</Label>
              <Input
                id="reconnect-token"
                type="password"
                placeholder="EAAB…"
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reconnect-account">Ad account ID (optional)</Label>
              <Input
                id="reconnect-account"
                placeholder="act_1234567890 or 1234567890"
                value={newAccountId}
                onChange={(e) => setNewAccountId(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">Leave blank to keep the existing ID.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReconnectRow(null)}>Cancel</Button>
            <Button
              onClick={() => reconnectMut.mutate()}
              disabled={reconnectMut.isPending || (!newToken.trim() && !newAccountId.trim())}
            >
              {reconnectMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Reconnect & sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}