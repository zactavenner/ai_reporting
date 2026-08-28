import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';
import { invokeMeetgeek } from '@/lib/meetgeekInvoke';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

interface Props {
  /** Optional client scope. Omitted = agency-wide coverage. */
  clientId?: string;
}

interface CoverageSummary {
  total: number;
  transcript_complete: number;
  awaiting: number;
  pending: number;
  not_required: number;
  exceptions: number;
  by_exception: Record<string, number>;
  by_provider: Record<string, number>;
  capture_rate: number | null;
}

interface CoveragePayload {
  generated_at: string;
  window_days: number;
  last_reconciled_at: string | null;
  summary: CoverageSummary;
  by_client: (CoverageSummary & { client_id: string; client_name: string })[];
  exceptions: {
    id: string;
    client_name: string;
    contact_name: string | null;
    assigned_user_name: string | null;
    scheduled_start: string | null;
    expected_provider: string;
    exception_code: string | null;
    exception_message: string | null;
  }[];
}

const EXCEPTION_LABELS: Record<string, string> = {
  invite_never_sent: 'No shadow invite was ever sent',
  invite_not_delivered: 'Invite not delivered before start',
  notetaker_never_joined: 'Notetaker never joined / not admitted',
  phone_transcript_missing: 'Phone call has no transcript',
};

const PROVIDER_LABELS: Record<string, string> = {
  meetgeek: 'Video (notetaker)',
  ghl_phone: 'Phone (CRM dialer)',
  none: 'Not recordable',
  unknown: 'Unclassified',
};

async function invokeAdmin<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('meetgeek-guest-admin', {
    body,
    headers: dashboardAuthHeaders(),
  });
  if (error) {
    let message = error.message;
    try {
      const payload = await (error as any).context?.json?.();
      if (payload?.error) message = String(payload.error);
    } catch {
      /* keep original */
    }
    throw new Error(message);
  }
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as T;
}

function ts(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

export function NotetakerCoveragePanel({ clientId }: Props) {
  const queryClient = useQueryClient();

  const coverage = useQuery({
    queryKey: ['notetaker-coverage', clientId ?? 'agency'],
    queryFn: () =>
      invokeAdmin<CoveragePayload>({
        action: 'coverage_overview',
        client_id: clientId ?? null,
        lookback_days: 14,
      }),
  });

  const reconcile = useMutation({
    mutationFn: () => invokeAdmin({ action: 'coverage_reconcile', client_id: clientId ?? null }),
    onSuccess: (data: any) => {
      toast.success(
        `Reconciled ${data?.scanned || 0} bookings · ${data?.completed || 0} captured · ${data?.exceptions || 0} exceptions`,
      );
      queryClient.invalidateQueries({ queryKey: ['notetaker-coverage'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Coverage reconciliation failed'),
  });

  const replay = useMutation({
    mutationFn: () =>
      invokeAdmin({ action: 'coverage_replay_ingest', client_id: clientId ?? null, apply: true }),
    onSuccess: (data: any) => {
      toast.success(
        data?.retryable
          ? `Re-opened ${data.retryable} failed transcript ingests for retry`
          : 'No failed transcript ingests to retry',
      );
      queryClient.invalidateQueries({ queryKey: ['notetaker-coverage'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Replay failed'),
  });

  // Bounded provider-hydration recovery (regional 401 / missing key). The server
  // resolves tenancy and caps the batch; no client identity is sent.
  const rehydrate = useMutation({
    mutationFn: () => invokeMeetgeek({ action: 'mg_replay_hydration_failures', limit: 50 }),
    onSuccess: (data: any) => {
      toast.success(
        `Re-hydrated ${data?.succeeded || 0} of ${data?.attempted || 0} meetings (${data?.still_failing || 0} still failing)`,
      );
      queryClient.invalidateQueries({ queryKey: ['notetaker-coverage'] });
      queryClient.invalidateQueries({ queryKey: ['meetings'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Re-hydration failed'),
  });


  const s = coverage.data?.summary;

  return (
    <div className="border-2 border-border p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium mb-1 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Notetaker coverage ledger
          </h4>
          <p className="text-sm text-muted-foreground">
            Every booked appointment is tracked from booking to transcript. Video bookings expect the shadow-invite
            notetaker; phone bookings expect a transcribed CRM call. Anything overdue becomes a loud exception.
          </p>
        </div>
        <Badge variant="outline">Last 14 days</Badge>
      </div>

      {coverage.error ? (
        <p className="text-xs text-destructive border border-destructive/40 bg-destructive/5 p-2 rounded">
          {(coverage.error as Error).message}
        </p>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        {[
          { label: 'Bookings', value: s?.total ?? '—', icon: null },
          { label: 'Transcribed', value: s?.transcript_complete ?? '—', icon: CheckCircle2 },
          { label: 'Awaiting', value: (s?.awaiting ?? 0) + (s?.pending ?? 0), icon: Clock },
          { label: 'Exceptions', value: s?.exceptions ?? '—', icon: AlertTriangle },
          { label: 'Capture rate', value: s?.capture_rate == null ? '—' : `${s.capture_rate}%`, icon: null },
        ].map((k) => (
          <div key={k.label} className="border border-border p-2 space-y-1">
            <div className="text-muted-foreground flex items-center gap-1">
              {k.icon ? <k.icon className="h-3 w-3" /> : null}
              {k.label}
            </div>
            <div className="text-lg font-semibold tabular-nums">{coverage.isLoading ? '…' : k.value}</div>
          </div>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">
        Last watchdog reconciliation: {ts(coverage.data?.last_reconciled_at)} · runs automatically every 10 minutes
      </div>

      {s && Object.keys(s.by_provider || {}).length ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(s.by_provider).map(([provider, count]) => (
            <Badge key={provider} variant="secondary">
              {PROVIDER_LABELS[provider] || provider}: {count}
            </Badge>
          ))}
        </div>
      ) : null}

      {coverage.data?.exceptions?.length ? (
        <div className="space-y-2">
          <Label className="text-xs">Open exceptions</Label>
          <div className="border border-border divide-y divide-border max-h-72 overflow-auto">
            {coverage.data.exceptions.map((e) => (
              <div key={e.id} className="p-2 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {e.client_name} · {e.contact_name || 'Unknown contact'}
                  </span>
                  <Badge variant="destructive" className="shrink-0">
                    {EXCEPTION_LABELS[e.exception_code || ''] || e.exception_code || 'exception'}
                  </Badge>
                </div>
                <div className="text-muted-foreground">
                  {ts(e.scheduled_start)} · {PROVIDER_LABELS[e.expected_provider] || e.expected_provider}
                  {e.assigned_user_name ? ` · ${e.assigned_user_name}` : ''}
                </div>
                {e.exception_message ? <div className="text-muted-foreground">{e.exception_message}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No open coverage exceptions in this window.</p>
      )}

      {coverage.data?.by_client?.length ? (
        <div className="space-y-2">
          <Label className="text-xs">By client</Label>
          <div className="border border-border divide-y divide-border max-h-56 overflow-auto text-xs">
            {coverage.data.by_client.map((c) => (
              <div key={c.client_id} className="p-2 flex items-center justify-between gap-2">
                <span>{c.client_name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {c.transcript_complete}/{c.total} captured
                  {c.exceptions ? ` · ${c.exceptions} exception${c.exceptions > 1 ? 's' : ''}` : ''}
                  {c.capture_rate == null ? '' : ` · ${c.capture_rate}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => coverage.refetch()} disabled={coverage.isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${coverage.isFetching ? 'animate-spin' : ''}`} />
          Refresh coverage
        </Button>
        <Button variant="secondary" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
          {reconcile.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Run watchdog now
        </Button>
        <Button variant="ghost" onClick={() => replay.mutate()} disabled={replay.isPending}>
          {replay.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Retry failed transcript ingests
        </Button>
      </div>
    </div>
  );
}
