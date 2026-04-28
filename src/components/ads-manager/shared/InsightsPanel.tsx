import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, AlertTriangle, TrendingUp, RefreshCw, Target, Wand2, ChevronDown, ChevronUp, PauseCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface AdsInsight {
  id: string;
  severity: 'critical' | 'warning' | 'opportunity' | 'info';
  action: 'pause' | 'scale' | 'refresh_creative' | 'adjust_bid' | 'refine_audience' | 'review';
  title: string;
  rationale: string;
  target_type: 'ad' | 'campaign' | 'account';
  target_ids: string[];
  target_names?: string[];
  metric_snapshot?: { spend?: number; ctr?: number; leads?: number; funded?: number };
}

interface Props {
  ads: any[];
  campaigns: any[];
  dateRange?: { from: Date; to: Date };
  onJumpTo?: (target: { type: string; id: string }) => void;
}

const severityStyles: Record<AdsInsight['severity'], string> = {
  critical: 'border-destructive/40 bg-destructive/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  opportunity: 'border-emerald-500/40 bg-emerald-500/5',
  info: 'border-border bg-muted/30',
};

const actionIcon: Record<AdsInsight['action'], any> = {
  pause: PauseCircle,
  scale: TrendingUp,
  refresh_creative: Wand2,
  adjust_bid: Target,
  refine_audience: Target,
  review: Sparkles,
};

const actionLabel: Record<AdsInsight['action'], string> = {
  pause: 'Pause',
  scale: 'Scale',
  refresh_creative: 'Refresh creative',
  adjust_bid: 'Adjust bid',
  refine_audience: 'Refine audience',
  review: 'Review',
};

export function InsightsPanel({ ads, campaigns, dateRange, onJumpTo }: Props) {
  const [data, setData] = useState<{ summary: string; insights: AdsInsight[] } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const { data: res, error } = await supabase.functions.invoke('ads-insights', {
        body: {
          ads,
          campaigns,
          dateRange: dateRange ? { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() } : null,
        },
      });
      if (error) throw new Error(error.message);
      if ((res as any)?.error) throw new Error((res as any).error);
      return res as { summary: string; insights: AdsInsight[] };
    },
    onSuccess: (res) => {
      setData(res);
      setGeneratedAt(new Date());
      const n = res.insights?.length || 0;
      toast.success(n ? `${n} insight${n === 1 ? '' : 's'} generated` : 'No actionable signals right now');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to generate insights'),
  });

  const isEmpty = !data && !mut.isPending;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-3 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-md bg-primary/10 grid place-items-center shrink-0">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold flex items-center gap-2">
              AI Insights & Recommendations
              {data?.insights?.length ? (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{data.insights.length}</Badge>
              ) : null}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {generatedAt
                ? `Generated ${generatedAt.toLocaleTimeString()} • ${ads.length} ads · ${campaigns.length} campaigns in scope`
                : `${ads.length} ads · ${campaigns.length} campaigns in current view`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant={isEmpty ? 'default' : 'secondary'}
            onClick={() => mut.mutate()}
            disabled={mut.isPending || (ads.length === 0 && campaigns.length === 0)}
            className="h-8"
          >
            {mut.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Analyzing…</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5 mr-1.5" />{data ? 'Regenerate' : 'Analyze performance'}</>
            )}
          </Button>
          {data && (
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setCollapsed(c => !c)}>
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-2">
          {isEmpty && (
            <div className="text-xs text-muted-foreground py-2">
              Click <strong>Analyze performance</strong> to surface pause/scale candidates, creative fatigue, and audience refinements based on the current filters.
            </div>
          )}

          {mut.isPending && (
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-16 rounded-md bg-muted/40 animate-pulse" />
              ))}
            </div>
          )}

          {data?.summary && (
            <div className="text-xs text-muted-foreground italic px-1 py-1.5">{data.summary}</div>
          )}

          {data && data.insights.length === 0 && !mut.isPending && (
            <div className="text-xs text-muted-foreground py-2">No actionable signals right now — performance looks within thresholds.</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data?.insights?.map((ins) => {
              const Icon = actionIcon[ins.action] || Sparkles;
              return (
                <div
                  key={ins.id}
                  className={cn('rounded-md border p-2.5 flex flex-col gap-1.5', severityStyles[ins.severity])}
                >
                  <div className="flex items-start gap-2">
                    <div className="h-6 w-6 rounded bg-background/80 grid place-items-center shrink-0 mt-0.5">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 uppercase">{ins.severity}</Badge>
                        <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{actionLabel[ins.action]}</Badge>
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">{ins.target_type}</Badge>
                      </div>
                      <div className="text-xs font-semibold mt-1 leading-snug">{ins.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{ins.rationale}</div>
                      {ins.target_names && ins.target_names.length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-1 truncate">
                          → {ins.target_names.slice(0, 3).join(', ')}{ins.target_names.length > 3 ? ` +${ins.target_names.length - 3}` : ''}
                        </div>
                      )}
                      {ins.metric_snapshot && (
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
                          {ins.metric_snapshot.spend != null && <span>Spend ${Number(ins.metric_snapshot.spend).toLocaleString()}</span>}
                          {ins.metric_snapshot.ctr != null && <span>CTR {Number(ins.metric_snapshot.ctr).toFixed(2)}%</span>}
                          {ins.metric_snapshot.leads != null && <span>{ins.metric_snapshot.leads} leads</span>}
                          {ins.metric_snapshot.funded != null && <span>{ins.metric_snapshot.funded} funded</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  {onJumpTo && ins.target_ids?.length > 0 && ins.target_type !== 'account' && (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => onJumpTo({ type: ins.target_type, id: ins.target_ids[0] })}
                      >
                        Jump to {ins.target_type}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}