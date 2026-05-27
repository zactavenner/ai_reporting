import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw, AlertTriangle, CheckCircle2, ListTodo } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

export function DailyAISummaryCard() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['daily-ai-summary-latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_ai_summaries')
        .select('*')
        .order('summary_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const regen = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('daily-ai-summary', { body: { source: 'manual' } });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Daily brief refreshed');
      qc.invalidateQueries({ queryKey: ['daily-ai-summary-latest'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to refresh brief'),
  });

  const tasks = (data?.tasks_due_today as any[]) || [];
  const alerts = (data?.sheet_alerts as any[]) || [];
  const stats = (data?.client_stats as any[]) || [];

  return (
    <Card className="p-5 border-border/60 shadow-sm bg-gradient-to-br from-primary/5 via-background to-background">
      <div className="flex items-start gap-3 mb-4">
        <div className="h-9 w-9 rounded-xl bg-primary/10 grid place-items-center shrink-0">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold leading-tight">Daily Brief</h2>
            {data?.summary_date && (
              <Badge variant="secondary" className="text-[10px]">
                {format(new Date(data.summary_date + 'T00:00:00'), 'MMM d')}
              </Badge>
            )}
            {data?.delivered_slack && (
              <Badge variant="outline" className="text-[10px] gap-1"><CheckCircle2 className="h-2.5 w-2.5" /> Slack</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Auto-generated each morning at 4 AM PST — tasks due today + yesterday's KPI snapshot per client.</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => regen.mutate()}
          disabled={regen.isPending}
          className="h-8 gap-1 text-xs shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${regen.isPending ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading brief…</div>
      ) : !data ? (
        <div className="text-sm text-muted-foreground">
          No brief yet. Click <strong>Refresh</strong> to generate today's brief.
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1.4fr,1fr] gap-4">
          {/* AI Summary */}
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-1.5 prose-h2:text-sm prose-h2:font-semibold prose-p:my-1 prose-ul:my-1.5">
            <ReactMarkdown>{data.ai_summary || '_No summary content_'}</ReactMarkdown>
          </div>

          {/* Quick stats column */}
          <div className="space-y-3">
            <div className="rounded-xl border border-border/60 p-3 bg-card/50">
              <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
                <ListTodo className="h-3.5 w-3.5 text-primary" />
                Tasks due today
                <Badge variant="secondary" className="text-[10px] ml-auto">{tasks.length}</Badge>
              </div>
              {tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Clear for today.</p>
              ) : (
                <ul className="space-y-1 max-h-44 overflow-y-auto pr-1">
                  {tasks.slice(0, 10).map((t: any) => (
                    <li key={t.id} className="text-xs flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${t.priority === 'high' ? 'bg-rose-500' : t.priority === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      <span className="truncate">{t.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border/60 p-3 bg-card/50">
              <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Alerts
                <Badge variant="secondary" className="text-[10px] ml-auto">{alerts.length}</Badge>
              </div>
              {alerts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No alerts. All sheets healthy.</p>
              ) : (
                <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {alerts.slice(0, 8).map((a: any, i: number) => (
                    <li key={i} className="text-xs">
                      <span className="font-medium">{a.client_name}</span>{' '}
                      <span className="text-muted-foreground">— {a.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground">
              {stats.length} client{stats.length === 1 ? '' : 's'} reported sheet stats for yesterday.
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}