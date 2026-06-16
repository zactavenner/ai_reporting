import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  Rocket,
  ListChecks,
  Sparkles,
  Bot,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Flame,
  Snowflake,
  Plus,
} from 'lucide-react';

type Client = { id: string; name: string };

const tagMeta: Record<string, { label: string; icon: any; cls: string }> = {
  winner: { label: 'Winner', icon: TrendingUp, cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  emerging: { label: 'Emerging', icon: Sparkles, cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  fatigued: { label: 'Fatigued', icon: Snowflake, cls: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  underperforming: { label: 'Underperforming', icon: TrendingDown, cls: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
};

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function useClients() {
  return useQuery<Client[]>({
    queryKey: ['mo-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('status', 'active')
        .order('name');
      if (error) throw error;
      return (data || []) as Client[];
    },
  });
}

/* ─────────── Launch Center ─────────── */
function LaunchCenter() {
  const qc = useQueryClient();
  const { data: templates, isLoading } = useQuery({
    queryKey: ['mo-campaign-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_campaign_templates')
        .select('*, clients(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('meta_campaign_templates').insert({
        name: `Untitled Template ${new Date().toLocaleDateString()}`,
        platform: 'meta',
        objective: 'OUTCOME_LEADS',
        daily_budget: 100,
        optimization_goal: 'LEAD_GENERATION',
        attribution_setting: '7d_click_1d_view',
        placements: ['facebook', 'instagram'],
        naming_convention: { campaign: '{CLIENT} | {OFFER} | {GOAL} | {MONTH}', adset: '{AUDIENCE} | {GEO} | {AGE}', ad: '{CREATIVE_TYPE} | v{VERSION}' },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Template created');
      qc.invalidateQueries({ queryKey: ['mo-campaign-templates'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Campaign Templates</h3>
          <p className="text-sm text-muted-foreground">Save blueprints, then launch in one click.</p>
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          <Plus className="h-4 w-4 mr-1" /> New Template
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !templates?.length ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">No templates yet. Create your first one to enable one-click launches.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t: any) => (
            <Card key={t.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  <Badge variant="outline">{t.objective || '—'}</Badge>
                </div>
                <CardDescription className="text-xs">{t.clients?.name || 'Global template'}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs space-y-1 text-muted-foreground">
                <div>Daily budget: {fmtMoney(t.daily_budget)}</div>
                <div>Optimization: {t.optimization_goal || '—'}</div>
                <div>Placements: {(t.placements || []).join(', ') || '—'}</div>
                <div className="pt-2">
                  <Button size="sm" variant="default" className="w-full">
                    <Rocket className="h-3.5 w-3.5 mr-1" /> Launch from template
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Lead Forms ─────────── */
function LeadForms() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['mo-lead-forms'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_lead_forms')
        .select('*, clients(name)')
        .order('last_synced_at', { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const sync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('meta-leadforms-sync', { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(`Synced ${d?.total ?? 0} lead forms`);
      qc.invalidateQueries({ queryKey: ['mo-lead-forms'] });
    },
    onError: (e: any) => toast.error(`Sync failed: ${e.message}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Lead Form Library</h3>
          <p className="text-sm text-muted-foreground">Synced from every connected ad account & page.</p>
        </div>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-1 ${sync.isPending ? 'animate-spin' : ''}`} />
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6"><Skeleton className="h-32 w-full" /></div>
          ) : !data?.length ? (
            <div className="p-10 text-center text-muted-foreground">
              No lead forms yet — click <span className="font-medium">Sync now</span> to pull from Meta.
            </div>
          ) : (
            <ScrollArea className="h-[520px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Form</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Questions</TableHead>
                    <TableHead>Last synced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((f: any) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.name || f.meta_form_id}</TableCell>
                      <TableCell className="text-muted-foreground">{f.clients?.name || '—'}</TableCell>
                      <TableCell><Badge variant={f.status === 'ACTIVE' ? 'default' : 'secondary'}>{f.status || '—'}</Badge></TableCell>
                      <TableCell className="text-right">{f.leads_count ?? 0}</TableCell>
                      <TableCell className="text-right">{Array.isArray(f.questions) ? f.questions.length : 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {f.last_synced_at ? new Date(f.last_synced_at).toLocaleString() : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────── Creative Intelligence ─────────── */
function CreativeIntelligence() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: tags, isLoading: tagsLoading } = useQuery({
    queryKey: ['mo-creative-tags'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_creative_tags')
        .select('*')
        .order('computed_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: insights, isLoading: insightsLoading } = useQuery({
    queryKey: ['mo-ai-insights'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_ai_creative_insights')
        .select('*, clients(name)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });

  const tagCounts = (tags || []).reduce((acc: Record<string, number>, t: any) => {
    acc[t.tag] = (acc[t.tag] || 0) + 1;
    return acc;
  }, {});

  const runTagger = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('meta-creative-tagger', { body: {} });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Tagger run complete'); qc.invalidateQueries({ queryKey: ['mo-creative-tags'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const runAI = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('meta-ai-analyze-creatives', { body: { limit: 30 } });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('AI analysis complete'); qc.invalidateQueries({ queryKey: ['mo-ai-insights'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Creative Intelligence</h3>
          <p className="text-sm text-muted-foreground">Winner detection + daily AI analysis across all accounts.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runTagger.mutate()} disabled={runTagger.isPending}>
            <Flame className="h-4 w-4 mr-1" /> {runTagger.isPending ? 'Tagging…' : 'Run tagger'}
          </Button>
          <Button onClick={() => runAI.mutate()} disabled={runAI.isPending}>
            <Sparkles className="h-4 w-4 mr-1" /> {runAI.isPending ? 'Analyzing…' : 'Run AI analysis'}
          </Button>
        </div>
      </div>

      {/* Tag distribution */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['winner', 'emerging', 'fatigued', 'underperforming'] as const).map((t) => {
          const M = tagMeta[t];
          const Icon = M.icon;
          return (
            <Card key={t}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center border ${M.cls}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-semibold">{tagsLoading ? '…' : (tagCounts[t] || 0)}</div>
                  <div className="text-xs text-muted-foreground">{M.label}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* AI insights */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> AI Insights Feed</CardTitle>
          <CardDescription>Daily pattern detection across top-spending ads.</CardDescription>
        </CardHeader>
        <CardContent>
          {insightsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : !insights?.length ? (
            <div className="text-center text-muted-foreground py-8">No insights yet. Click <span className="font-medium">Run AI analysis</span>.</div>
          ) : (
            <ScrollArea className="h-[420px] pr-3">
              <div className="space-y-3">
                {insights.map((i: any) => (
                  <div key={i.id} className="border rounded-lg p-3 hover:bg-muted/40 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-medium text-sm">{i.title}</div>
                      <Badge variant="outline" className="text-[10px]">{i.insight_type}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">{i.body}</div>
                    <div className="text-[10px] text-muted-foreground mt-2 flex gap-3">
                      <span>{i.clients?.name || 'All'}</span>
                      <span>{new Date(i.created_at).toLocaleDateString()}</span>
                      {i.confidence != null && <span>confidence {Math.round(i.confidence * 100)}%</span>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────── Automation Rules ─────────── */
function Automation() {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery({
    queryKey: ['mo-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_rules')
        .select('*, clients(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: alerts } = useQuery({
    queryKey: ['mo-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_alerts')
        .select('*, clients(name)')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  const createRule = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('meta_rules').insert({
        name: 'Pause if CPL > $80 (2d)',
        platform: 'meta',
        scope_level: 'ad',
        scope_ids: [],
        schedule: 'every_30_min',
        conditions: { all: [{ metric: 'cost_per_lead', op: '>', value: 80, window_days: 2 }, { metric: 'spend', op: '>', value: 50, window_days: 2 }] },
        action: 'pause',
        action_config: {},
        notify_channels: ['slack', 'in_app'],
        is_active: false,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Sample rule created (disabled)'); qc.invalidateQueries({ queryKey: ['mo-rules'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Automation & Alerts</h3>
          <p className="text-sm text-muted-foreground">Pause / scale / notify based on live performance.</p>
        </div>
        <Button onClick={() => createRule.mutate()} disabled={createRule.isPending}><Plus className="h-4 w-4 mr-1" /> New Rule</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6"><Skeleton className="h-32 w-full" /></div>
          ) : !rules?.length ? (
            <div className="p-8 text-center text-muted-foreground">No rules yet — click <span className="font-medium">New Rule</span> to create a starter.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.clients?.name || 'All'}</TableCell>
                    <TableCell><Badge variant="outline">{r.scope_level}</Badge></TableCell>
                    <TableCell><Badge>{r.action}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.last_run_at ? new Date(r.last_run_at).toLocaleString() : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={r.is_active ? 'default' : 'secondary'}>{r.is_active ? 'Active' : 'Paused'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Alerts</CardTitle></CardHeader>
        <CardContent>
          {!alerts?.length ? (
            <div className="text-center text-muted-foreground py-6">No alerts yet.</div>
          ) : (
            <div className="space-y-2">
              {alerts.map((a: any) => (
                <div key={a.id} className="flex items-start justify-between border rounded-lg p-3">
                  <div>
                    <div className="font-medium text-sm">{a.title}</div>
                    <div className="text-xs text-muted-foreground">{a.message}</div>
                  </div>
                  <Badge variant={a.severity === 'critical' ? 'destructive' : a.severity === 'warning' ? 'default' : 'secondary'}>
                    {a.severity}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────── Root ─────────── */
export function MetaOpsTab() {
  const [section, setSection] = useState('launch');
  return (
    <div className="space-y-4">
      <Tabs value={section} onValueChange={setSection}>
        <TabsList>
          <TabsTrigger value="launch" className="gap-2"><Rocket className="h-4 w-4" /> Launch</TabsTrigger>
          <TabsTrigger value="lead-forms" className="gap-2"><ListChecks className="h-4 w-4" /> Lead Forms</TabsTrigger>
          <TabsTrigger value="intelligence" className="gap-2"><Sparkles className="h-4 w-4" /> Intelligence</TabsTrigger>
          <TabsTrigger value="automation" className="gap-2"><Bot className="h-4 w-4" /> Automation</TabsTrigger>
        </TabsList>
        <TabsContent value="launch" className="mt-4"><LaunchCenter /></TabsContent>
        <TabsContent value="lead-forms" className="mt-4"><LeadForms /></TabsContent>
        <TabsContent value="intelligence" className="mt-4"><CreativeIntelligence /></TabsContent>
        <TabsContent value="automation" className="mt-4"><Automation /></TabsContent>
      </Tabs>
    </div>
  );
}

export default MetaOpsTab;