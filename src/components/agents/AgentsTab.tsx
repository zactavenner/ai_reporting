import { useState, useMemo, useEffect } from 'react';
import { Plus, Play, Power, Trash2, AlertTriangle, CheckCircle, XCircle, Clock, Zap, Activity, Bot, Settings2, ChevronRight, Circle, Building2, User, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAgents, useAgentRuns, useCreateAgent, useUpdateAgent, useDeleteAgent, useRunAgent, useAgentEscalations, useAgentTasks, AVAILABLE_MODELS, AVAILABLE_CONNECTORS, AGENT_TEMPLATES, type Agent } from '@/hooks/useAgents';
import type { Client } from '@/hooks/useClients';
import { toast } from 'sonner';
import { CronSchedulePicker } from './CronSchedulePicker';
import { ClientScopePicker } from './ClientScopePicker';
import { AIAgentGenerator } from './AIAgentGenerator';
import { AgentReferenceLibrary } from './AgentReferenceLibrary';
import { AgencyAgentsManager } from './AgencyAgentsManager';
import { AgentChannelPane } from './AgentChannelPane';
import { AllChannelsInbox } from './AllChannelsInbox';

interface Props { clients: Client[]; }

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  completed: { icon: CheckCircle, color: 'text-primary', label: 'Completed' },
  running: { icon: Activity, color: 'text-warning', label: 'Running' },
  failed: { icon: XCircle, color: 'text-destructive', label: 'Failed' },
  skipped: { icon: Clock, color: 'text-muted-foreground', label: 'Skipped' },
};

export function AgentsTab({ clients }: Props) {
  const { data: agents = [], isLoading } = useAgents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedAgent = agents.find(a => a.id === selectedId) || null;
  const { data: runs = [] } = useAgentRuns(selectedId);
  const { data: escalations = [] } = useAgentEscalations();
  const { data: tasks = [] } = useAgentTasks();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();
  const runAgent = useRunAgent();
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<Agent>>({});
  const [tab, setTab] = useState('overview');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [showAllAgents, setShowAllAgents] = useState(false);

  // Deep-link: ?agent=<id> selects that agent + listen for org-chart clicks
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get('agent');
    if (id) setSelectedId(id);
    const handler = (e: any) => {
      const id = e?.detail?.id;
      if (id) { setSelectedId(id); setEditMode(false); }
    };
    window.addEventListener('agents:select', handler as any);
    return () => window.removeEventListener('agents:select', handler as any);
  }, []);

  // Computed stats
  const stats = useMemo(() => {
    const total = agents.length;
    const active = agents.filter(a => a.enabled).length;
    const recentRuns = runs.filter(r => {
      const started = r.started_at ? new Date(r.started_at).getTime() : 0;
      return Date.now() - started < 24 * 60 * 60 * 1000;
    });
    const failedRuns = recentRuns.filter(r => r.status === 'failed').length;
    const totalTokens = recentRuns.reduce((sum, r) => sum + (r.tokens_used || 0), 0);
    const openEscalations = escalations.filter(e => !e.resolved_at).length;
    return { total, active, failedRuns, totalTokens, openEscalations };
  }, [agents, runs, escalations]);

  const handleCreateFromTemplate = (template: typeof AGENT_TEMPLATES[0]) => {
    const exists = agents.some(a => a.template_key === template.key);
    if (exists) {
      toast.warning(`${template.name} already exists in your workforce`);
      return;
    }
    createAgent.mutate({
      name: template.name,
      icon: template.icon,
      description: template.description,
      prompt_template: template.prompt_template,
      schedule_cron: template.schedule_cron,
      model: template.model,
      connectors: template.connectors as any,
      enabled: false,
      template_key: template.key,
    } as any);
    setShowTemplates(false);
  };

  const activeAgents = useMemo(() => agents.filter(a => a.enabled), [agents]);
  const visibleAgents = useMemo(
    () => (showAllAgents ? agents : agents.filter(a => (a as any).is_core)),
    [agents, showAllAgents]
  );

  const handleCreateBlank = () => {
    createAgent.mutate({
      name: 'New Agent',
      icon: '🤖',
      description: '',
      prompt_template: '',
      schedule_cron: '0 6 * * *',
      model: 'openrouter/owl-alpha',
      connectors: ['database'] as any,
      enabled: false,
    } as any);
  };

  const startEditing = () => {
    if (!selectedAgent) return;
    setEditData({
      name: selectedAgent.name,
      description: selectedAgent.description,
      prompt_template: selectedAgent.prompt_template,
      schedule_cron: selectedAgent.schedule_cron,
      model: selectedAgent.model,
      icon: selectedAgent.icon,
      connectors: selectedAgent.connectors,
      client_id: selectedAgent.client_id,
      notify_channels: (selectedAgent as any).notify_channels || ['slack'],
      whatsapp_recipients: (selectedAgent as any).whatsapp_recipients || [],
    } as any);
    setEditMode(true);
  };

  const saveEdit = () => {
    if (!selectedAgent) return;
    updateAgent.mutate({ id: selectedAgent.id, ...editData } as any);
    setEditMode(false);
  };

  return (
    <div className="space-y-6">
      {/* Phase 2: Shared Agency Agents with 3-layer knowledge */}
      <AgencyAgentsManager clients={clients} />

      {/* Agency-wide unified inbox across all agent channels (agency + client) */}
      <AllChannelsInbox clients={clients} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Agent Workforce
          </h2>
          <p className="text-sm text-muted-foreground">
            {stats.active}/{stats.total} active · {stats.openEscalations} open escalations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setShowAIGenerator(!showAIGenerator); setShowTemplates(false); }}>
            <Sparkles className="h-4 w-4 mr-1" /> AI Create
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setShowTemplates(!showTemplates); setShowAIGenerator(false); }}>
            <Zap className="h-4 w-4 mr-1" /> Templates
          </Button>
          <Button size="sm" onClick={handleCreateBlank} disabled={createAgent.isPending}>
            <Plus className="h-4 w-4 mr-1" /> New Agent
          </Button>
        </div>
      </div>

      {/* Template picker */}
      {showTemplates && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {AGENT_TEMPLATES.map((t) => (
            <Card key={t.key} className="cursor-pointer hover:border-primary transition-colors" onClick={() => handleCreateFromTemplate(t)}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{t.icon}</span>
                  <span className="font-semibold text-sm">{t.name}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {t.connectors.map(c => (
                    <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* AI Agent Generator */}
      {showAIGenerator && (
        <AIAgentGenerator clients={clients} onCreated={() => setShowAIGenerator(false)} />
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Agents', value: stats.total, icon: Bot },
          { label: 'Active', value: stats.active, icon: Power },
          { label: 'Failed (24h)', value: stats.failedRuns, icon: AlertTriangle },
          { label: 'Tokens (24h)', value: stats.totalTokens.toLocaleString(), icon: Zap },
          { label: 'Escalations', value: stats.openEscalations, icon: AlertTriangle },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active Agents Grid */}
      {activeAgents.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Circle className="h-2 w-2 fill-primary text-primary animate-pulse" />
            Live Agents ({activeAgents.length})
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {activeAgents.map((agent) => {
              const statusCfg = STATUS_CONFIG[agent.last_run_status || ''];
              const StatusIcon = statusCfg?.icon || Clock;
              const statusColor = statusCfg?.color || 'text-muted-foreground';
              return (
                <Card
                  key={agent.id}
                  className="cursor-pointer hover:border-primary/50 transition-all"
                  onClick={() => { setSelectedId(agent.id); setEditMode(false); }}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{agent.icon || '🤖'}</span>
                        <span className="font-semibold text-xs truncate">{agent.name.replace(/\s*\(.*\)/, '')}</span>
                      </div>
                      <Switch
                        checked={true}
                        onCheckedChange={(enabled) => updateAgent.mutate({ id: agent.id, enabled } as any)}
                        className="scale-75"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <StatusIcon className={`h-3 w-3 ${statusColor}`} />
                      <span className={statusColor}>{statusCfg?.label || 'Idle'}</span>
                      <span className="text-muted-foreground ml-auto">{agent.schedule_cron || 'Manual'}</span>
                    </div>
                    {agent.last_run_at && (
                      <p className="text-[10px] text-muted-foreground mt-1 truncate">
                        Last: {new Date(agent.last_run_at).toLocaleString()}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading agents...</div>
      ) : agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <span className="text-4xl mb-4 block">🤖</span>
            <h3 className="font-semibold mb-2">No agents yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create your first agent or pick a template.</p>
            <Button onClick={handleCreateBlank}>Create Agent</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agent list */}
          <div className="space-y-2 lg:col-span-1">
            <div className="flex items-center justify-between px-1 pb-2">
              <p className="text-xs text-muted-foreground">
                {showAllAgents ? `All ${agents.length} agents` : `${visibleAgents.length} core agents`}
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setShowAllAgents(v => !v)}>
                {showAllAgents ? 'Show core only' : 'Show all'}
              </Button>
            </div>
            {visibleAgents.map((agent) => {
              const lastStatus = agent.last_run_status || 'unknown';
              const statusCfg = STATUS_CONFIG[lastStatus];
              return (
                <Card
                  key={agent.id}
                  onClick={() => { setSelectedId(agent.id); setEditMode(false); }}
                  className={`cursor-pointer transition-all ${selectedId === agent.id ? 'border-primary ring-1 ring-primary/20' : 'hover:border-muted-foreground/30'}`}
                >
                  <CardContent className="p-3 flex items-center gap-3">
                    <span className="text-2xl">{agent.icon || '🤖'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm truncate">{agent.name}</p>
                        {agent.enabled ? (
                          <Badge variant="default" className="text-[10px] h-4">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] h-4">Off</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{agent.description || 'No description'}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">{agent.schedule_cron || 'Manual'}</span>
                        {statusCfg && (
                          <span className={`text-[10px] ${statusCfg.color}`}>{statusCfg.label}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Agent detail */}
          <div className="lg:col-span-2">
            {selectedAgent ? (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{selectedAgent.icon}</span>
                      <div>
                        <CardTitle>{selectedAgent.name}</CardTitle>
                        <p className="text-sm text-muted-foreground">{selectedAgent.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={selectedAgent.enabled || false}
                        onCheckedChange={(enabled) => updateAgent.mutate({ id: selectedAgent.id, enabled } as any)}
                      />
                      <Button variant="outline" size="sm" onClick={() => runAgent.mutate({ agentId: selectedAgent.id, clientId: selectedAgent.client_id || undefined })} disabled={runAgent.isPending}>
                        <Play className="h-3.5 w-3.5 mr-1" /> Run
                      </Button>
                      <Button variant="outline" size="sm" onClick={editMode ? saveEdit : startEditing}>
                        <Settings2 className="h-3.5 w-3.5 mr-1" /> {editMode ? 'Save' : 'Edit'}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => { setSelectedId(null); deleteAgent.mutate(selectedAgent.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs value={tab} onValueChange={setTab}>
                    <TabsList>
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="config">Config</TabsTrigger>
                      <TabsTrigger value="references">Agent Training</TabsTrigger>
                    <TabsTrigger value="channel">Channel</TabsTrigger>
                      <TabsTrigger value="runs">Runs ({runs.length})</TabsTrigger>
                      <TabsTrigger value="escalations">Escalations</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4 mt-4">
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Model</p>
                          <p className="text-sm font-medium truncate">{AVAILABLE_MODELS.find(m => m.value === selectedAgent.model)?.label || selectedAgent.model || 'Not set'}</p>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Schedule</p>
                          <p className="text-sm font-medium">{selectedAgent.schedule_cron || 'Manual'}</p>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Scope</p>
                          <div className="flex items-center gap-1.5">
                            {selectedAgent.client_id ? (
                              <>
                                <User className="h-3 w-3 text-muted-foreground" />
                                <p className="text-sm font-medium truncate">{clients.find(c => c.id === selectedAgent.client_id)?.name || 'Client'}</p>
                              </>
                            ) : (
                              <>
                                <Building2 className="h-3 w-3 text-primary" />
                                <p className="text-sm font-medium">Agency-wide</p>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Last Run</p>
                          <p className="text-sm font-medium">{selectedAgent.last_run_at ? new Date(selectedAgent.last_run_at).toLocaleString() : 'Never'}</p>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Failures</p>
                          <p className="text-sm font-medium">{(selectedAgent as any).consecutive_failures || 0}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">Connectors</p>
                        <div className="flex flex-wrap gap-1">
                          {(selectedAgent.connectors || []).map((c: string) => {
                            const cfg = AVAILABLE_CONNECTORS.find(ac => ac.key === c);
                            return <Badge key={c} variant="outline" className="text-xs">{cfg?.label || c}</Badge>;
                          })}
                        </div>
                      </div>
                      {selectedAgent.prompt_template && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-2">Prompt Template</p>
                          <pre className="bg-muted/50 rounded-lg p-3 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {selectedAgent.prompt_template}
                          </pre>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="config" className="space-y-4 mt-4">
                      {editMode ? (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-muted-foreground">Name</label>
                              <Input value={editData.name || ''} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">Icon</label>
                              <Input value={editData.icon || ''} onChange={e => setEditData(p => ({ ...p, icon: e.target.value }))} />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Description</label>
                            <Input value={editData.description || ''} onChange={e => setEditData(p => ({ ...p, description: e.target.value }))} />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-muted-foreground">Model</label>
                              <Select value={editData.model || ''} onValueChange={v => setEditData(p => ({ ...p, model: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {AVAILABLE_MODELS.map(m => (
                                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <CronSchedulePicker
                              value={editData.schedule_cron || ''}
                              onChange={v => setEditData(p => ({ ...p, schedule_cron: v }))}
                            />
                          </div>
                          <ClientScopePicker
                            clientId={editData.client_id ?? selectedAgent?.client_id ?? null}
                            onChange={v => setEditData(p => ({ ...p, client_id: v }))}
                            clients={clients}
                          />
                          <div>
                            <label className="text-xs text-muted-foreground">Connectors</label>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {AVAILABLE_CONNECTORS.map(c => {
                                const active = (editData.connectors || []).includes(c.key);
                                return (
                                  <Badge
                                    key={c.key}
                                    variant={active ? 'default' : 'outline'}
                                    className="cursor-pointer"
                                    onClick={() => {
                                      const current = editData.connectors || [];
                                      setEditData(p => ({
                                        ...p,
                                        connectors: active ? current.filter((x: string) => x !== c.key) : [...current, c.key],
                                      }));
                                    }}
                                  >
                                    {c.label}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Notify Channels</label>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {['slack','whatsapp'].map(ch => {
                                const channels = (editData as any).notify_channels || ['slack'];
                                const active = channels.includes(ch);
                                return (
                                  <Badge
                                    key={ch}
                                    variant={active ? 'default' : 'outline'}
                                    className="cursor-pointer capitalize"
                                    onClick={() => {
                                      const next = active ? channels.filter((x: string) => x !== ch) : [...channels, ch];
                                      setEditData(p => ({ ...p, notify_channels: next } as any));
                                    }}
                                  >
                                    {ch}
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                          {((editData as any).notify_channels || []).includes('whatsapp') && (
                            <div>
                              <label className="text-xs text-muted-foreground">WhatsApp Recipients (E.164, one per line)</label>
                              <Textarea
                                className="min-h-[60px] font-mono text-xs"
                                placeholder="+15551234567"
                                value={(((editData as any).whatsapp_recipients) || []).join('\n')}
                                onChange={e => setEditData(p => ({ ...p, whatsapp_recipients: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } as any))}
                              />
                            </div>
                          )}
                          <div>
                            <label className="text-xs text-muted-foreground">System Prompt</label>
                            <Textarea
                              className="min-h-[200px] font-mono text-xs"
                              value={editData.prompt_template || ''}
                              onChange={e => setEditData(p => ({ ...p, prompt_template: e.target.value }))}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={saveEdit}>Save Changes</Button>
                            <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
                          </div>
                        </>
                      ) : (
                        <div className="text-center text-muted-foreground py-8">
                          <Settings2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">Click "Edit" to modify agent configuration</p>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="references" className="mt-4">
                      <AgentReferenceLibrary
                        agentTag={selectedAgent.template_key || selectedAgent.id}
                        agentName={selectedAgent.name}
                      />
                    </TabsContent>
                    <TabsContent value="channel" className="mt-4">
                      <AgentChannelPane
                        agentId={selectedAgent.id}
                        scope={selectedAgent.client_id ? 'client' : 'agency'}
                        clientId={selectedAgent.client_id || null}
                      />
                    </TabsContent>
                    <TabsContent value="runs" className="space-y-3 mt-4">
                      {runs.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">No runs yet</p>
                      ) : (
                        runs.slice(0, 20).map(run => {
                          const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.completed;
                          const Icon = cfg.icon;
                          return (
                            <div key={run.id} className="border rounded-lg p-3 space-y-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Icon className={`h-4 w-4 ${cfg.color}`} />
                                  <span className="text-sm font-medium capitalize">{run.status}</span>
                                  {run.client && (
                                    <Badge variant="outline" className="text-[10px]">{run.client.name}</Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                  {run.tokens_used ? <span>{run.tokens_used.toLocaleString()} tokens</span> : null}
                                  {(run as any).duration_ms ? <span>{(run as any).duration_ms}ms</span> : null}
                                  {(run as any).cost_usd ? <span>${Number((run as any).cost_usd).toFixed(4)}</span> : null}
                                  <span>{run.started_at ? new Date(run.started_at).toLocaleString() : ''}</span>
                                </div>
                              </div>
                              {run.output_summary && (
                                <p className="text-xs text-muted-foreground line-clamp-3">{run.output_summary}</p>
                              )}
                              {run.error && (
                                <p className="text-xs text-destructive">{run.error}</p>
                              )}
                            </div>
                          );
                        })
                      )}
                    </TabsContent>

                    <TabsContent value="escalations" className="space-y-3 mt-4">
                      {escalations.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">No escalations</p>
                      ) : (
                        escalations.slice(0, 15).map(esc => (
                          <div key={esc.id} className="border rounded-lg p-3 space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant={esc.severity === 'critical' ? 'destructive' : esc.severity === 'high' ? 'destructive' : 'secondary'} className="text-[10px]">
                                  {esc.severity}
                                </Badge>
                                <span className="text-sm font-medium">{esc.title}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {esc.resolved_at ? '✅ Resolved' : '⏳ Open'}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{esc.description}</p>
                            <p className="text-[10px] text-muted-foreground">from {esc.agent_name} · {new Date(esc.created_at).toLocaleString()}</p>
                          </div>
                        ))
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-dashed">
                <CardContent className="p-12 text-center">
                  <Bot className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-muted-foreground">Select an agent to view details</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
