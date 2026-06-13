import { useQuery } from '@tanstack/react-query';
import { Sparkles, AlertTriangle, TrendingUp, Info, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

type Insight = {
  id: string;
  client_id: string | null;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string | null;
  metrics: any;
  created_at: string;
};

export function AIInsightsCard() {
  const [running, setRunning] = useState(false);

  const { data: insights = [], isLoading, refetch } = useQuery({
    queryKey: ['ai-insights-recent'],
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 7);
      const { data, error } = await supabase
        .from('ai_insights')
        .select('*')
        .gte('created_at', since.toISOString())
        .order('severity', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as Insight[];
    },
    refetchInterval: 60_000,
  });

  const runNow = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke('anomaly-detector', { body: {} });
      if (error) throw error;
      toast({ title: 'Anomaly scan complete', description: 'Insights refreshed.' });
      await refetch();
    } catch (e: any) {
      toast({ title: 'Scan failed', description: e.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const sevIcon = (s: string) =>
    s === 'critical' ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" /> :
    s === 'warning' ? <TrendingUp className="h-3.5 w-3.5 text-amber-500" /> :
    <Info className="h-3.5 w-3.5 text-muted-foreground" />;

  const sevBadge = (s: string) =>
    s === 'critical' ? 'destructive' : s === 'warning' ? 'default' : 'secondary';

  return (
    <Card className="p-4 glass-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/10 grid place-items-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">AI Insights</p>
            <p className="text-xs text-muted-foreground">Anomalies & opportunities · last 7 days</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={runNow} disabled={running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {isLoading ? (
        <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : insights.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No insights yet. Click refresh to scan now — runs nightly at 2 AM PST.
        </p>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {insights.map((i) => (
            <div key={i.id} className="border rounded-md p-3 bg-background/40 hover:bg-background/60 transition">
              <div className="flex items-start gap-2">
                <div className="mt-0.5">{sevIcon(i.severity)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{i.title}</p>
                    <Badge variant={sevBadge(i.severity) as any} className="text-[10px]">{i.severity}</Badge>
                  </div>
                  {i.body && (
                    <div className="prose prose-xs dark:prose-invert max-w-none mt-1 text-xs text-muted-foreground">
                      <ReactMarkdown>{i.body}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}