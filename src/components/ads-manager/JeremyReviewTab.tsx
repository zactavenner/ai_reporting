import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, Loader2, Play, Pause, TrendingUp, Check, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

const ACTION_META: Record<string, { label: string; icon: typeof Play }> = {
  pause: { label: 'Pause', icon: Pause },
  resume: { label: 'Resume', icon: Play },
  adjust_budget: { label: 'Adjust budget', icon: TrendingUp },
  hold: { label: 'Hold — needs more data', icon: AlertTriangle },
};

export function JeremyReviewTab({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const qc = useQueryClient();

  const { data: agent } = useQuery({
    queryKey: ['jeremy-agent'],
    queryFn: async () => {
      const { data } = await supabase
        .from('agency_agents')
        .select('name, is_active, default_model')
        .eq('slug', 'media_buyer_jeremy')
        .maybeSingle();
      return data;
    },
  });

  const { data: recs, isLoading } = useQuery({
    queryKey: ['jeremy-recommendations', clientId],
    enabled: !!clientId,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('meta_ad_recommendations')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(40);
      return data || [];
    },
  });

  const latest = useMemo(() => (recs || [])[0] as Record<string, any> | undefined, [recs]);
  const pending = useMemo(() => (recs || []).filter((r: Record<string, any>) => r.status === 'pending'), [recs]);
  const resolved = useMemo(() => (recs || []).filter((r: Record<string, any>) => r.status !== 'pending'), [recs]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['jeremy-recommendations', clientId] });

  const review = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('jeremy-media-buyer-review', {
        body: { client_id: clientId },
        headers: dashboardAuthHeaders(),
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Review failed');
      return data;
    },
    onSuccess: (d) => {
      toast.success(`Jeremy reviewed ${d.reviewed} entities and raised ${d.created} recommendations`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('meta-apply-recommendation', {
        body: { recommendation_id: id },
        headers: dashboardAuthHeaders(),
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Apply failed');
      return data;
    },
    onSuccess: () => { toast.success('Change applied in Meta'); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); invalidate(); },
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('meta_ad_recommendations')
        .update({ status: 'rejected' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Recommendation dismissed'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4" /> Media Buyer (JEREMY)
                {agent?.is_active === false && <Badge variant="secondary" className="text-[10px]">Disabled</Badge>}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Reviews {clientName || 'this client'}'s live Meta structure against funded outcomes. Every change needs your approval — Jeremy never writes to Meta on its own.
              </p>
            </div>
            <Button size="sm" onClick={() => review.mutate()} disabled={review.isPending || agent?.is_active === false}>
              {review.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Run review
            </Button>
          </div>
        </CardHeader>
        {latest?.summary && (
          <CardContent className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-24">Health score</span>
              <Progress value={Number(latest.health_score) || 0} className="h-2 flex-1" />
              <span className="text-sm font-semibold">{Number(latest.health_score) || 0}/100</span>
            </div>
            <p className="text-xs text-muted-foreground">{latest.summary}</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Approval queue {pending.length ? `(${pending.length})` : ''}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
          ) : !pending.length ? (
            <p className="text-xs text-muted-foreground">Nothing waiting on you. Run a review to generate fresh recommendations.</p>
          ) : (
            pending.map((r: Record<string, any>) => {
              const meta = ACTION_META[r.action] || ACTION_META.hold;
              const Icon = meta.icon;
              const m = r.metrics_snapshot || {};
              return (
                <div key={r.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize text-[10px]">{r.entity_type}</Badge>
                    <span className="text-sm font-medium truncate">{r.entity_name}</span>
                    <Badge className="text-[10px] gap-1"><Icon className="h-3 w-3" /> {meta.label}</Badge>
                    {r.proposed_daily_budget != null && (
                      <Badge variant="secondary" className="text-[10px]">→ ${Number(r.proposed_daily_budget).toLocaleString()}/day</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">confidence {Math.round(Number(r.confidence) * 100)}%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.reason}</p>
                  <p className="text-[11px] text-muted-foreground">
                    ${Number(m.spend || 0).toLocaleString()} spend · {m.leads || 0} leads · {m.funded || 0} funded
                    {m.cost_per_funded ? ` · $${Number(m.cost_per_funded).toLocaleString()} per funded` : ''}
                    {m.funded_roas ? ` · ${m.funded_roas}x funded ROAS` : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate(r.id)}>
                      {apply.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                      {r.action === 'hold' ? 'Acknowledge' : 'Apply in Meta'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(r.id)}>
                      <X className="h-3.5 w-3.5 mr-1" /> Dismiss
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {!!resolved.length && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Decision log</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {resolved.slice(0, 15).map((r: Record<string, any>) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs border-b pb-1.5 last:border-0">
                <span className="truncate">{r.entity_name} — {(ACTION_META[r.action] || ACTION_META.hold).label}</span>
                <div className="flex items-center gap-2">
                  {r.error_detail && <span className="text-destructive truncate max-w-[240px]">{r.error_detail}</span>}
                  <Badge variant={r.status === 'applied' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'} className="capitalize text-[10px]">
                    {r.status}
                  </Badge>
                  {(r.status === 'failed') && (
                    <Button size="sm" variant="outline" onClick={() => apply.mutate(r.id)}>
                      <RefreshCw className="h-3 w-3 mr-1" /> Retry
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}