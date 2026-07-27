import { useState } from 'react';
import { format } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, Clock, RefreshCw, Mail, MessageSquare, Slack, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Delivery {
  id: string;
  task_id: string | null;
  member_id: string | null;
  channel: 'sms' | 'email' | 'slack' | 'in_app' | 'whatsapp';
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  provider: string | null;
  recipient: string | null;
  subject: string | null;
  error: string | null;
  retry_count: number;
  last_attempt_at: string;
  sent_at: string | null;
  kind: string | null;
  triggered_by: string | null;
  created_at: string;
}

const channelIcon = (c: Delivery['channel']) => {
  switch (c) {
    case 'sms': return <MessageSquare className="h-4 w-4" />;
    case 'email': return <Mail className="h-4 w-4" />;
    case 'slack': return <Slack className="h-4 w-4" />;
    default: return <Bell className="h-4 w-4" />;
  }
};

const statusBadge = (s: Delivery['status']) => {
  const map = {
    sent: { variant: 'secondary' as const, icon: <CheckCircle2 className="h-3 w-3" />, label: 'Sent' },
    failed: { variant: 'destructive' as const, icon: <XCircle className="h-3 w-3" />, label: 'Failed' },
    pending: { variant: 'outline' as const, icon: <Clock className="h-3 w-3 animate-spin" />, label: 'Pending' },
    skipped: { variant: 'outline' as const, icon: <Clock className="h-3 w-3" />, label: 'Skipped' },
  }[s];
  return (
    <Badge variant={map.variant} className="gap-1">
      {map.icon}{map.label}
    </Badge>
  );
};

export function TaskDeliveriesPanel({ taskId, memberId }: { taskId?: string; memberId?: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'failed'>('all');

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['task-deliveries', taskId, memberId, filter],
    queryFn: async () => {
      let q = supabase
        .from('task_notification_deliveries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (taskId) q = q.eq('task_id', taskId);
      if (memberId) q = q.eq('member_id', memberId);
      if (filter === 'failed') q = q.eq('status', 'failed');
      const { data, error } = await q;
      if (error) throw error;
      return data as Delivery[];
    },
    refetchInterval: 15000,
  });

  const retry = useMutation({
    mutationFn: async (deliveryId: string) => {
      const { data, error } = await supabase.functions.invoke('retry-task-notification', {
        body: { delivery_id: deliveryId, triggered_by: 'Manual retry' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: 'Retry queued', description: 'Delivery is being re-attempted.' });
      qc.invalidateQueries({ queryKey: ['task-deliveries'] });
    },
    onError: (err: any) => {
      toast({ title: 'Retry failed', description: err?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const failedCount = deliveries.filter(d => d.status === 'failed').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant={filter === 'all' ? 'secondary' : 'outline'} size="sm" onClick={() => setFilter('all')}>
          All ({deliveries.length})
        </Button>
        <Button variant={filter === 'failed' ? 'secondary' : 'outline'} size="sm" onClick={() => setFilter('failed')}>
          Failed{failedCount > 0 && <Badge variant="destructive" className="ml-1.5 h-5 px-1.5 text-xs">{failedCount}</Badge>}
        </Button>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading delivery log…</div>
      ) : deliveries.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No delivery attempts yet.</div>
      ) : (
        <ScrollArea className="h-[420px]">
          <div className="space-y-2 pr-3">
            {deliveries.map((d) => (
              <div
                key={d.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg border border-border p-3',
                  d.status === 'failed' && 'border-destructive/40 bg-destructive/5',
                )}
              >
                <div className="mt-0.5 text-muted-foreground">{channelIcon(d.channel)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium capitalize">{d.channel}</span>
                    {statusBadge(d.status)}
                    {d.retry_count > 0 && (
                      <Badge variant="outline" className="text-xs">
                        Retries: {d.retry_count}
                      </Badge>
                    )}
                    {d.provider && (
                      <span className="text-xs text-muted-foreground">via {d.provider}</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {d.recipient || '—'} · {d.kind || 'notification'}
                    {d.triggered_by && ` · from ${d.triggered_by}`}
                  </div>
                  {d.subject && (
                    <div className="mt-1 truncate text-xs">{d.subject}</div>
                  )}
                  {d.error && (
                    <div className="mt-1 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive break-words">
                      {d.error}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {format(new Date(d.last_attempt_at), 'MMM d, h:mm a')}
                  </span>
                  {(d.status === 'failed' || d.status === 'skipped') &&
                    (d.channel === 'sms' || d.channel === 'email') && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(d.id)}
                      >
                        <RefreshCw className={cn('mr-1 h-3 w-3', retry.isPending && 'animate-spin')} />
                        Retry
                      </Button>
                    )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}