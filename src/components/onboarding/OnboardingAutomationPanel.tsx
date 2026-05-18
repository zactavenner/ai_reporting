import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, Clock, Loader2, XCircle, Play, Slack, Mail, MessageSquare,
  Globe, Phone, Megaphone, ShieldCheck, Rocket, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─── Types ───

type ItemStatus = 'pending' | 'in_progress' | 'done' | 'error';

interface ChecklistItem {
  key: string;
  label: string;
}

interface ItemState {
  status: ItemStatus;
  completed_at: string | null;
  note: string | null;
}

interface PhaseDef {
  id: string;
  num: number;
  title: string;
  description: string;
  icon: any;
  items: ChecklistItem[];
  edgeFunction?: string;
}

interface NotificationEntry {
  channel: 'Slack' | 'Email' | 'WhatsApp' | 'System';
  message: string;
  timestamp: string;
  status: 'sent' | 'failed';
}

const PHASES: PhaseDef[] = [
  {
    id: 'access',
    num: 1,
    title: 'Access Setup',
    description: 'Triggers immediately on form submission',
    icon: ShieldCheck,
    edgeFunction: 'onboard-client',
    items: [
      { key: 'slack_channel', label: 'Slack channel created (#client-[company])' },
      { key: 'ghl_subaccount', label: 'GHL sub-account created via API' },
      { key: 'welcome_email', label: 'Welcome email sent to client' },
      { key: 'drive_folder', label: 'Google Drive folder created' },
      { key: 'kickoff_link', label: 'Kick-off call booking link sent' },
    ],
  },
  {
    id: 'assets',
    num: 2,
    title: 'AI Asset Creation',
    description: 'Triggers after kick-off or manually',
    icon: Megaphone,
    edgeFunction: 'fulfill-client',
    items: [
      { key: 'ad_copy', label: 'Ad copy generated (5 variants)' },
      { key: 'email_sequence', label: 'Email sequence generated (3 emails + disclaimers)' },
      { key: 'sms_sequence', label: 'SMS sequences generated (5 templates)' },
      { key: 'ai_conversation', label: 'AI conversation prompt generated' },
      { key: 'canva_creatives', label: 'Canva creatives exported (3 formats)' },
      { key: 'compliance_check', label: 'Policy compliance check passed' },
    ],
  },
  {
    id: 'ghl',
    num: 3,
    title: 'GHL Full Setup',
    description: 'Triggers after assets approved',
    icon: Globe,
    edgeFunction: 'fulfill-client-browser',
    items: [
      { key: 'subdomain', label: 'Subdomain created (invest.[domain].com)' },
      { key: 'sending_domain', label: 'Dedicated sending domain configured' },
      { key: 'a2p_10dlc', label: 'A2P 10DLC submitted' },
      { key: 'phone_number', label: 'Phone number purchased (area code matched)' },
      { key: 'customer_list', label: 'Customer list uploaded + tagged' },
      { key: 'funnel_built', label: 'Funnel built from snapshot' },
      { key: 'automations_deployed', label: 'All 7 automations deployed' },
      { key: 'conversation_ai', label: 'Conversation AI configured + tested' },
    ],
  },
  {
    id: 'review',
    num: 4,
    title: 'Manager Review',
    description: 'Human approval gate',
    icon: CheckCircle2,
    items: [
      { key: 'funnel_preview', label: 'Funnel preview reviewed' },
      { key: 'ad_copy_approved', label: 'Ad copy approved' },
      { key: 'automations_tested', label: 'Automations tested' },
    ],
  },
  {
    id: 'launch',
    num: 5,
    title: 'Ad Launch',
    description: 'Triggers after manager approval',
    icon: Rocket,
    edgeFunction: 'onboarding-webhook',
    items: [
      { key: 'meta_campaign', label: 'Meta campaign created' },
      { key: 'lead_form_webhook', label: 'Lead form → GHL webhook connected' },
      { key: 'loom_sent', label: 'Process overview Loom sent to client' },
      { key: 'marked_active', label: 'Client marked "active"' },
    ],
  },
];

// ─── Status display ───

const STATUS_STYLES: Record<ItemStatus, { icon: any; color: string; label: string }> = {
  done: { icon: CheckCircle2, color: 'text-green-500', label: 'Done' },
  in_progress: { icon: Loader2, color: 'text-blue-500 animate-spin', label: 'Running' },
  error: { icon: XCircle, color: 'text-destructive', label: 'Error' },
  pending: { icon: Clock, color: 'text-muted-foreground', label: 'Pending' },
};

// ─── Component ───

interface Props {
  clientId: string;
  clientName: string;
  onMarkActive?: (id: string) => void;
}

export function OnboardingAutomationPanel({ clientId, clientName, onMarkActive }: Props) {
  const [checklist, setChecklist] = useState<Record<string, ItemState>>({});
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningPhase, setRunningPhase] = useState<string | null>(null);

  useEffect(() => {
    fetchChecklist();
  }, [clientId]);

  async function fetchChecklist() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('clients')
        .select('automation_checklist')
        .eq('id', clientId)
        .maybeSingle();
      const raw = (data as any)?.automation_checklist || {};
      setChecklist(raw.items || {});
      setNotifications(Array.isArray(raw.notifications) ? raw.notifications : []);
    } catch (err) {
      console.error('Failed to load automation checklist', err);
    } finally {
      setLoading(false);
    }
  }

  async function persist(nextItems: Record<string, ItemState>, nextNotifications?: NotificationEntry[]) {
    const payload = {
      items: nextItems,
      notifications: nextNotifications ?? notifications,
      updated_at: new Date().toISOString(),
    };
    setChecklist(nextItems);
    if (nextNotifications) setNotifications(nextNotifications);
    const { error } = await supabase
      .from('clients')
      .update({ automation_checklist: payload } as any)
      .eq('id', clientId);
    if (error) toast.error(`Failed to save: ${error.message}`);
  }

  async function setItemStatus(key: string, status: ItemStatus, note: string | null = null) {
    const next = {
      ...checklist,
      [key]: {
        status,
        completed_at: status === 'done' ? new Date().toISOString() : checklist[key]?.completed_at ?? null,
        note,
      },
    };
    await persist(next);
  }

  async function logNotification(entry: Omit<NotificationEntry, 'timestamp'>) {
    const newEntry: NotificationEntry = { ...entry, timestamp: new Date().toISOString() };
    const next = [newEntry, ...notifications].slice(0, 10);
    await persist(checklist, next);
  }

  async function runPhase(phase: PhaseDef) {
    setRunningPhase(phase.id);
    try {
      // Optimistically mark pending items as in_progress
      const next = { ...checklist };
      phase.items.forEach(item => {
        const current = next[item.key]?.status;
        if (current !== 'done') {
          next[item.key] = { status: 'in_progress', completed_at: null, note: null };
        }
      });
      await persist(next);

      if (phase.edgeFunction) {
        const { data, error } = await supabase.functions.invoke(phase.edgeFunction, {
          body: {
            password: 'HPA1234$',
            client_id: clientId,
            phase: phase.id,
            action: 'trigger',
          },
        });
        if (error) throw error;
        toast.success(`Phase "${phase.title}" triggered`);
        await logNotification({
          channel: 'System',
          message: `Triggered ${phase.title} via ${phase.edgeFunction}`,
          status: 'sent',
        });
      } else {
        toast.message(`Manual phase — toggle items as work is completed.`);
      }
    } catch (err: any) {
      toast.error(err?.message || `Failed to run phase`);
      // Mark in_progress items as error
      const next = { ...checklist };
      phase.items.forEach(item => {
        if (next[item.key]?.status === 'in_progress') {
          next[item.key] = { status: 'error', completed_at: null, note: err?.message ?? null };
        }
      });
      await persist(next);
      await logNotification({
        channel: 'System',
        message: `${phase.title} failed: ${err?.message || 'unknown error'}`,
        status: 'failed',
      });
    } finally {
      setRunningPhase(null);
    }
  }

  async function handleManagerDecision(approved: boolean) {
    const decisionKey = approved ? 'funnel_preview' : 'ad_copy_approved';
    const next = { ...checklist };
    if (approved) {
      PHASES[3].items.forEach(item => {
        next[item.key] = { status: 'done', completed_at: new Date().toISOString(), note: 'Approved by manager' };
      });
    } else {
      next[decisionKey] = { status: 'error', completed_at: null, note: 'Changes requested' };
    }
    await persist(next);
    await logNotification({
      channel: 'Slack',
      message: approved ? `${clientName}: Manager approved review phase` : `${clientName}: Manager requested changes`,
      status: 'sent',
    });
    toast.success(approved ? 'Approved' : 'Changes requested');
  }

  const overallProgress = useMemo(() => {
    const total = PHASES.reduce((sum, p) => sum + p.items.length, 0);
    const done = Object.values(checklist).filter(s => s.status === 'done').length;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }, [checklist]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">End-to-End Automation</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">5-phase pipeline · {overallProgress}% complete</p>
            </div>
            <Badge variant={overallProgress === 100 ? 'default' : 'outline'}>{overallProgress}%</Badge>
          </div>
          <Progress value={overallProgress} className="h-2 mt-2" />
        </CardHeader>
      </Card>

      {/* Phase cards */}
      {PHASES.map(phase => {
        const PhaseIcon = phase.icon;
        const phaseStates = phase.items.map(i => checklist[i.key]?.status || 'pending');
        const doneCount = phaseStates.filter(s => s === 'done').length;
        const errorCount = phaseStates.filter(s => s === 'error').length;
        const isComplete = doneCount === phase.items.length;
        const isRunning = runningPhase === phase.id;
        const isReview = phase.id === 'review';
        const isLaunch = phase.id === 'launch';

        return (
          <Card key={phase.id} className={cn(isComplete && 'border-green-500/30 bg-green-500/5')}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                    isComplete ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground',
                  )}>
                    {isComplete ? <CheckCircle2 className="h-4 w-4" /> : phase.num}
                  </div>
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <PhaseIcon className="h-4 w-4 text-muted-foreground" />
                      Phase {phase.num} — {phase.title}
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{phase.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {doneCount}/{phase.items.length}
                  </Badge>
                  {errorCount > 0 && (
                    <Badge variant="destructive" className="text-[10px]">{errorCount} err</Badge>
                  )}
                  {!isReview && (
                    <Button
                      size="sm"
                      variant={isComplete ? 'outline' : 'default'}
                      onClick={() => runPhase(phase)}
                      disabled={isRunning}
                    >
                      {isRunning ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running…</>
                      ) : (
                        <><Play className="h-3 w-3 mr-1" /> Run Phase</>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {phase.items.map(item => {
                const state = checklist[item.key] || { status: 'pending', completed_at: null, note: null };
                const cfg = STATUS_STYLES[state.status];
                const Icon = cfg.icon;
                return (
                  <div
                    key={item.key}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/40 group"
                  >
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', cfg.color)} />
                    <span className={cn(
                      'text-xs flex-1',
                      state.status === 'done' && 'text-muted-foreground line-through',
                    )}>
                      {item.label}
                    </span>
                    {state.note && (
                      <span className="text-[10px] text-muted-foreground italic truncate max-w-[140px]" title={state.note}>
                        {state.note}
                      </span>
                    )}
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                        onClick={() => setItemStatus(item.key, 'done')}
                        disabled={state.status === 'done'}
                      >
                        ✓
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                        onClick={() => setItemStatus(item.key, 'pending')}
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                );
              })}

              {isReview && (
                <div className="flex gap-2 pt-3 border-t mt-3">
                  <Button size="sm" onClick={() => handleManagerDecision(true)}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleManagerDecision(false)}>
                    <AlertCircle className="h-3.5 w-3.5 mr-1" /> Request Changes
                  </Button>
                </div>
              )}

              {isLaunch && isComplete && onMarkActive && (
                <Button size="sm" className="mt-3" onClick={() => onMarkActive(clientId)}>
                  <Rocket className="h-3.5 w-3.5 mr-1" /> Mark Client Active
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Notification log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Notification History</CardTitle>
          <p className="text-[11px] text-muted-foreground">Last {notifications.length} of 10</p>
        </CardHeader>
        <CardContent className="pt-0">
          {notifications.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No notifications yet</p>
          ) : (
            <div className="space-y-1.5">
              {notifications.map((n, i) => {
                const ChannelIcon = n.channel === 'Slack' ? Slack
                  : n.channel === 'Email' ? Mail
                  : n.channel === 'WhatsApp' ? MessageSquare
                  : Phone;
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded bg-muted/30 text-xs">
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <ChannelIcon className="h-3 w-3" /> {n.channel}
                    </Badge>
                    <span className="flex-1 truncate" title={n.message}>{n.message}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(n.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge
                      variant={n.status === 'sent' ? 'outline' : 'destructive'}
                      className="text-[10px]"
                    >
                      {n.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}