import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RefreshCw, AlertOctagon, Inbox, CheckCircle2, Clock, RotateCw } from 'lucide-react';

interface QueueRow {
  id: string;
  client_id: string;
  sync_type: string;
  status: string;
  source: string | null;
  attempts: number;
  max_attempts: number;
  next_retry_at: string | null;
  error_message: string | null;
  dead_letter: boolean;
  created_at: string;
  completed_at: string | null;
  external_id: string | null;
}

function StatTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${tone}`} />
        </div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export function QueueHealthTab() {
  const qc = useQueryClient();

  const stats = useQuery({
    queryKey: ['sync-queue-status-counts'],
    queryFn: async () => {
      const statuses = ['pending', 'processing', 'retrying', 'completed', 'failed'];
      const out: Record<string, number> = {};
      for (const s of statuses) {
        const { count } = await supabase
          .from('sync_queue').select('id', { count: 'exact', head: true }).eq('status', s);
        out[s] = count ?? 0;
      }
      const { count: dead } = await supabase
        .from('sync_queue').select('id', { count: 'exact', head: true }).eq('dead_letter', true);
      out.dead_letter = dead ?? 0;
      return out;
    },
    refetchInterval: 10000,
  });

  const recent = useQuery({
    queryKey: ['sync-queue-recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_queue')
        .select('id, client_id, sync_type, status, source, attempts, max_attempts, next_retry_at, error_message, dead_letter, created_at, completed_at, external_id')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as QueueRow[];
    },
    refetchInterval: 10000,
  });

  const deadLetters = useQuery({
    queryKey: ['sync-queue-dead'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_queue')
        .select('id, client_id, sync_type, status, source, attempts, max_attempts, next_retry_at, error_message, dead_letter, created_at, completed_at, external_id')
        .eq('dead_letter', true)
        .order('completed_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      return data as QueueRow[];
    },
    refetchInterval: 30000,
  });

  const runDispatcher = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sync-queue-dispatcher');
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      toast.success(`Dispatcher ran: ${JSON.stringify(d?.stats ?? d)}`);
      qc.invalidateQueries({ queryKey: ['sync-queue-status-counts'] });
      qc.invalidateQueries({ queryKey: ['sync-queue-recent'] });
      qc.invalidateQueries({ queryKey: ['sync-queue-dead'] });
    },
    onError: (e: any) => toast.error(`Dispatcher failed: ${e.message}`),
  });

  const requeue = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('sync_queue')
        .update({
          status: 'pending',
          dead_letter: false,
          attempts: 0,
          next_retry_at: null,
          error_message: null,
          started_at: null,
          completed_at: null,
        })
        .eq('id', jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Job re-queued');
      qc.invalidateQueries({ queryKey: ['sync-queue-dead'] });
      qc.invalidateQueries({ queryKey: ['sync-queue-recent'] });
      qc.invalidateQueries({ queryKey: ['sync-queue-status-counts'] });
    },
    onError: (e: any) => toast.error(`Re-queue failed: ${e.message}`),
  });

  const s = stats.data ?? {};

  const statusColor = (status: string, dead: boolean) => {
    if (dead) return 'destructive';
    if (status === 'completed') return 'secondary';
    if (status === 'processing') return 'default';
    if (status === 'failed' || status === 'retrying') return 'destructive';
    return 'outline';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sync Queue</h2>
          <p className="text-sm text-muted-foreground">Bulletproof ingestion pipeline for leads (webhook + cursor + master sync).</p>
        </div>
        <Button onClick={() => runDispatcher.mutate()} disabled={runDispatcher.isPending} size="sm">
          {runDispatcher.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Run Dispatcher
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile icon={Inbox} label="Pending" value={s.pending ?? 0} tone="text-chart-4" />
        <StatTile icon={Loader2} label="Processing" value={s.processing ?? 0} tone="text-primary" />
        <StatTile icon={RotateCw} label="Retrying" value={s.retrying ?? 0} tone="text-chart-4" />
        <StatTile icon={CheckCircle2} label="Completed" value={s.completed ?? 0} tone="text-chart-2" />
        <StatTile icon={Clock} label="Failed" value={s.failed ?? 0} tone="text-destructive" />
        <StatTile icon={AlertOctagon} label="Dead Letter" value={s.dead_letter ?? 0} tone="text-destructive" />
      </div>

      {(deadLetters.data?.length ?? 0) > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-destructive" /> Dead Letter Queue ({deadLetters.data?.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {deadLetters.data?.map((j) => (
              <div key={j.id} className="flex items-start justify-between gap-3 rounded border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className="text-[10px]">{j.sync_type}</Badge>
                    <Badge variant="outline" className="text-[10px]">{j.source ?? 'manual'}</Badge>
                    <span className="text-xs text-muted-foreground">{j.attempts}/{j.max_attempts} attempts</span>
                  </div>
                  <p className="text-xs text-destructive break-all line-clamp-2">{j.error_message || 'No error message'}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ext_id: {j.external_id ?? '—'} · {j.completed_at ? formatDistanceToNow(new Date(j.completed_at), { addSuffix: true }) : ''}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => requeue.mutate(j.id)} disabled={requeue.isPending}>
                  Re-queue
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
            </div>
          ) : (recent.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No jobs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2 pr-3">Type</th>
                    <th className="text-left py-2 pr-3">Source</th>
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-left py-2 pr-3">Attempts</th>
                    <th className="text-left py-2 pr-3">Created</th>
                    <th className="text-left py-2 pr-3">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data?.map((j) => (
                    <tr key={j.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-mono">{j.sync_type}</td>
                      <td className="py-2 pr-3">{j.source ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={statusColor(j.status, j.dead_letter) as any} className="text-[10px]">
                          {j.dead_letter ? 'dead_letter' : j.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{j.attempts}/{j.max_attempts}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}
                      </td>
                      <td className="py-2 pr-3 text-destructive max-w-md truncate">{j.error_message ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}