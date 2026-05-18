import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Play, Calendar, BarChart3, Slack } from 'lucide-react';
import {
  useAgents, useCreateAgent, useRunAgent, useAgentRuns,
} from '@/hooks/useAgents';
import type { Client } from '@/hooks/useClients';
import { toast } from 'sonner';

const WEEKLY_AGENT_KEY = 'weekly_reporting_agent';

const WEEKLY_AGENT_CONFIG = {
  name: 'Weekly Reporting Agent',
  icon: '📊',
  description: 'Generates a Monday morning recap across all clients with Meta Ads spend, GHL contacts, and calendar bookings.',
  prompt_template: `You are the Weekly Reporting Agent.
Pull last 7 days of: Meta Ads spend & results, GHL contacts & opportunities, GHL calendar bookings.
For EACH client in scope, output:
- Spend, leads, booked calls, showed calls, funded
- WoW deltas (decreased cost = good)
- Top wins, red flags, recommended next actions
End with an agency-wide rollup.`,
  schedule_cron: '0 6 * * 1',
  model: 'google/gemini-2.5-pro',
  connectors: ['database', 'meta_ads', 'ghl_crm', 'slack'] as any,
  notify_channels: ['slack'],
  template_key: WEEKLY_AGENT_KEY,
};

interface Props {
  clients: Client[];
}

export function WeeklyReportingAgent({ clients }: Props) {
  const { data: agents = [] } = useAgents();
  const createAgent = useCreateAgent();
  const runAgent = useRunAgent();

  const weeklyAgent = useMemo(
    () => agents.find(a => (a as any).template_key === WEEKLY_AGENT_KEY || a.name === WEEKLY_AGENT_CONFIG.name),
    [agents],
  );

  const { data: runs = [] } = useAgentRuns(weeklyAgent?.id ?? null);
  const lastRun = runs[0];

  const [includedClients, setIncludedClients] = useState<Set<string>>(
    new Set(clients.map(c => c.id)),
  );

  const toggleClient = (id: string) => {
    setIncludedClients(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleInstall = () => {
    createAgent.mutate({
      ...WEEKLY_AGENT_CONFIG,
      enabled: true,
    } as any);
  };

  const handleRunNow = () => {
    if (!weeklyAgent) return;
    runAgent.mutate({ agentId: weeklyAgent.id });
  };

  const previewSummary = (() => {
    if (!lastRun) return null;
    const raw = (lastRun as any).output_summary || (lastRun as any).result || (lastRun as any).output || '';
    if (typeof raw === 'string') return raw.slice(0, 500);
    try { return JSON.stringify(raw).slice(0, 500); } catch { return null; }
  })();

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-xl">
              📊
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Weekly Reporting Agent
                <Badge variant={weeklyAgent?.enabled ? 'default' : 'secondary'} className="text-[10px]">
                  {weeklyAgent ? (weeklyAgent.enabled ? 'Active' : 'Off') : 'Not installed'}
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Every Monday 6:00 AM</span>
                <span className="flex items-center gap-1"><Slack className="h-3 w-3" /> Slack notify</span>
                <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> Meta · GHL · Calendar</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!weeklyAgent ? (
              <Button size="sm" onClick={handleInstall} disabled={createAgent.isPending}>
                {createAgent.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Installing…</>
                ) : (
                  'Install Agent'
                )}
              </Button>
            ) : (
              <Button size="sm" onClick={handleRunNow} disabled={runAgent.isPending}>
                {runAgent.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Running…</>
                ) : (
                  <><Play className="h-3.5 w-3.5 mr-1" /> Run Now</>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {lastRun && (
          <div className="rounded-lg bg-muted/40 p-3 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold">Last run</span>
              <span className="text-muted-foreground">
                {lastRun.started_at ? new Date(lastRun.started_at).toLocaleString() : '—'} · {lastRun.status}
              </span>
            </div>
            {previewSummary ? (
              <p className="text-muted-foreground whitespace-pre-wrap line-clamp-6">{previewSummary}</p>
            ) : (
              <p className="text-muted-foreground italic">No summary captured</p>
            )}
          </div>
        )}

        <div>
          <p className="text-xs font-semibold mb-2">
            Clients included ({includedClients.size}/{clients.length})
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-2">
            {clients.map(c => (
              <label
                key={c.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-xs"
              >
                <Switch
                  checked={includedClients.has(c.id)}
                  onCheckedChange={() => toggleClient(c.id)}
                  className="scale-75"
                />
                <span className="truncate">{c.name}</span>
              </label>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}