import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useLaunchReadiness } from './useLaunchReadiness';

interface Props {
  clientId: string;
  clientName: string;
}

/**
 * Compact launch-readiness view. Surfaces the pending readiness item from the
 * approval queue and the gates behind it. Read-only — creates nothing on Meta.
 */
export function LaunchReadinessCard({ clientId, clientName }: Props) {
  const { data, isLoading, refetch } = useLaunchReadiness(clientId);
  const qc = useQueryClient();
  const [pulling, setPulling] = useState(false);

  if (isLoading || !data) return null;
  // Only render when there is a pending readiness item or an open gate.
  if (!data.pendingApproval && !data.hold) return null;

  const pullAssets = async () => {
    setPulling(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('fetch-meta-account-assets', {
        body: { clientId },
      });
      if (error || !res?.success) throw new Error(res?.error || error?.message || 'Asset pull failed');
      toast.success('Account assets pulled');
      await refetch();
      qc.invalidateQueries({ queryKey: ['meta-account-assets'] });
    } catch (e: any) {
      toast.error(e?.message || 'Asset pull failed');
    } finally {
      setPulling(false);
    }
  };

  return (
    <Card className="p-4 space-y-3 border-amber-200/60 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/10">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {data.hold ? (
              <ShieldAlert className="h-4 w-4 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
            Launch readiness — {clientName}
            <Badge variant={data.hold ? 'destructive' : 'outline'} className="text-[10px]">
              {data.hold ? `HOLD · ${data.blocking.length} gate${data.blocking.length === 1 ? '' : 's'} open` : 'All gates met'}
            </Badge>
          </div>
          {data.pendingApproval && (
            <p className="text-[11px] text-muted-foreground max-w-xl">
              Approval queue item: <span className="text-foreground">{data.pendingApproval.title}</span>
              {data.pendingApproval.summary ? ` — ${data.pendingApproval.summary}` : ''}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={pullAssets} disabled={pulling}>
          {pulling ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          Pull account assets
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {data.gates.map((g) => (
          <div
            key={g.key}
            className={`rounded-md border px-2.5 py-2 text-[11px] flex items-start gap-2 ${
              g.ok ? 'bg-background' : 'bg-red-50/60 dark:bg-red-950/20 border-red-200/60 dark:border-red-900/40'
            }`}
          >
            {g.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-red-600 mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="font-medium truncate">{g.label}</div>
              <div className="text-muted-foreground break-words">{g.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        This view reports current state only. No campaign is created or activated from here, and anything the
        wizard creates stays PAUSED.
      </p>
    </Card>
  );
}
