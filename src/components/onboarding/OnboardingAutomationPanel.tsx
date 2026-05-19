import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, Clock, Loader2, XCircle, Play, Slack, Mail, MessageSquare,
  Globe, Phone, Megaphone, ShieldCheck, Rocket, AlertCircle, ExternalLink, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// ─── Types ───

type ItemStatus = 'pending' | 'in_progress' | 'done' | 'error';

interface ChecklistItem {
  key: string;
  label: string;
  manualFallback?: boolean;
  note?: string;
}

interface ItemState {
  status: ItemStatus;
  completed_at: string | null;
  note: string | null;
}

type TeamRole = 'louie' | 'gled' | 'flora' | 'emily' | 'coleton' | 'billal' | 'manager';

interface PhaseDef {
  id: string;
  num: number;
  title: string;
  description: string;
  icon: any;
  owner: TeamRole;
  items: ChecklistItem[];
  edgeFunction?: string;
}

// Replace with real Slack member IDs when available
const TEAM_SLACK_IDS: Record<TeamRole, string> = {
  louie: 'U_LOUIE_ID',
  gled: 'U_GLED_ID',
  flora: 'U_FLORA_ID',
  emily: 'U_EMILY_ID',
  coleton: 'U_COLETON_ID',
  billal: 'U_BILLAL_ID',
  manager: 'U_MANAGER_ID',
};

const TEAM_NAMES: Record<TeamRole, string> = {
  louie: 'Louie — Automation/GHL/AI',
  gled: 'Gled — Creatives/Funnels',
  flora: 'Flora — Creatives',
  emily: 'Emily — Account Manager',
  coleton: 'Coleton — Sales',
  billal: 'Billal — Media Buyer',
  manager: 'Manager Review',
};

const GHL_HELP_URL = 'https://app.gohighlevel.com/';

const PHASES: PhaseDef[] = [
  {
    id: 'access',
    num: 1,
    title: 'Access Setup',
    description: 'Triggers immediately on form submission',
    icon: ShieldCheck,
    owner: 'louie',
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
    description: 'Orchestrated via auto-generate-onboarding',
    icon: Megaphone,
    owner: 'gled',
    edgeFunction: 'auto-generate-onboarding',
    items: [
      { key: 'ad_copy', label: 'Ad copy generated (5 variants)' },
      { key: 'email_sequence', label: 'Email sequence generated (3 emails + disclaimers)' },
      { key: 'sms_sequence', label: 'SMS sequences generated (5 templates)' },
      { key: 'ai_conversation', label: 'AI conversation prompt (setter + caller)' },
      { key: 'canva_creatives', label: 'Static ads (10 variants)' },
      { key: 'compliance_check', label: 'Policy compliance check passed (manual)' },
    ],
  },
  {
    id: 'ghl',
    num: 3,
    title: 'GHL Full Setup',
    description: 'Mix of API-driven and manual GHL UI steps',
    icon: Globe,
    owner: 'louie',
    items: [
      { key: 'subdomain', label: 'Subdomain (invest.[domain].com)', manualFallback: true, note: 'Cloudflare DNS — manual until automated' },
      { key: 'sending_domain', label: 'Dedicated sending domain', manualFallback: true },
      { key: 'phone_number', label: 'Phone number (area code matched)', manualFallback: false, note: 'API: GHL phone-numbers' },
      { key: 'customer_list', label: 'Customer list uploaded + tagged', manualFallback: false, note: 'API: GHL contacts bulk' },
      { key: 'a2p_10dlc', label: 'A2P 10DLC submitted', manualFallback: true, note: 'GHL UI only — 1-7 day approval' },
      { key: 'funnel_built', label: 'Funnel deployed from snapshot', manualFallback: true, note: 'GHL Snapshots UI' },
      { key: 'automations_deployed', label: '8 automations active (from snapshot)', manualFallback: true },
      { key: 'conversation_ai', label: 'Conversation AI configured', manualFallback: true, note: 'GHL UI only' },
    ],
  },
  {
    id: 'review',
    num: 4,
    title: 'Manager Review',
    description: 'Human approval gate',
    icon: CheckCircle2,
    owner: 'manager',
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
    owner: 'billal',
    edgeFunction: 'onboarding-webhook',
    items: [
      { key: 'meta_campaign', label: 'Meta campaign created' },
      { key: 'lead_form_webhook', label: 'Lead form → GHL webhook connected' },
      { key: 'loom_sent', label: 'Process overview Loom sent to client' },
      { key: 'marked_active', label: 'Client marked "active"' },
    ],
  },
];

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
  primaryOffer?: any;
  onMarkActive?: (id: string) => void;
}

export function OnboardingAutomationPanel({ clientId, clientName, primaryOffer, onMarkActive }: Props) {
  const qc = useQueryClient();
  const [checklist, setChecklist] = useState<Record<string, ItemState>>({});
  const [loading, setLoading] = useState(true);
  const [runningPhase, setRunningPhase] = useState<string | null>(null);

  useEffect(() => {
    fetchChecklist();
  }, [clientId]);

  // Realtime notifications
  const { data: notifications = [] } = useQuery({
    queryKey: ['onboarding-notifications', clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from('onboarding_notifications' as any)
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(10);
      return (data as any[]) || [];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`onb-notif-${clientId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'onboarding_notifications', filter: `client_id=eq.${clientId}` },
        () => qc.invalidateQueries({ queryKey: ['onboarding-notifications', clientId] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clientId, qc]);

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
    } catch (err) {
      console.error('Failed to load automation checklist', err);
    } finally {
      setLoading(false);
    }
  }

  async function persist(nextItems: Record<string, ItemState>) {
    const payload = { items: nextItems, updated_at: new Date().toISOString() };
    setChecklist(nextItems);
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

  async function logNotification(entry: {
    channel: 'slack' | 'email' | 'whatsapp' | 'sms' | 'system';
    message: string;
    status?: 'sent' | 'failed' | 'pending';
    phase?: string;
    recipient?: string;
    metadata?: Record<string, any>;
  }) {
    await supabase.from('onboarding_notifications' as any).insert({
      client_id: clientId,
      channel: entry.channel,
      message: entry.message,
      status: entry.status || 'sent',
      phase: entry.phase || null,
      recipient: entry.recipient || null,
      metadata: entry.metadata || {},
    });
  }

  async function notifyOwner(phase: PhaseDef, message: string, status: 'sent' | 'failed' = 'sent') {
    const slackId = TEAM_SLACK_IDS[phase.owner];
    try {
      await supabase.functions.invoke('slack-notify', {
        body: {
          password: 'HPA1234$',
          recipient: slackId,
          owner: phase.owner,
          message: `[${clientName}] ${message}`,
          phase: phase.id,
        },
      });
    } catch (e) {
      // non-fatal
    }
    await logNotification({
      channel: 'slack',
      recipient: slackId,
      phase: phase.id,
      message: `→ ${TEAM_NAMES[phase.owner]}: ${message}`,
      status,
    });
  }

  async function runPhase(phase: PhaseDef) {
    setRunningPhase(phase.id);
    try {
      const next = { ...checklist };
      phase.items.forEach(item => {
        if (item.manualFallback) return;
        const current = next[item.key]?.status;
        if (current !== 'done') {
          next[item.key] = { status: 'in_progress', completed_at: null, note: null };
        }
      });
      await persist(next);

      // ── Phase 2: wire to auto-generate-onboarding ──
      if (phase.id === 'assets') {
        if (!primaryOffer?.id) {
          throw new Error('No primary offer found — add an offer first');
        }
        const { data, error } = await supabase.functions.invoke('auto-generate-onboarding', {
          body: {
            password: 'HPA1234$',
            client_id: clientId,
            offer_id: primaryOffer.id,
            offer_description: primaryOffer.description,
            company_name: clientName,
            brand_colors: primaryOffer.brand_colors,
            brand_fonts: primaryOffer.brand_fonts,
            website_url: primaryOffer.website_url,
            intake_data: primaryOffer.raw_form_data || {},
          },
        });
        if (error) throw error;

        const results = data?.results || {};
        const updated = { ...next };
        const mark = (key: string, ok: boolean, note?: string) => {
          updated[key] = {
            status: ok ? 'done' : 'error',
            completed_at: ok ? new Date().toISOString() : null,
            note: note || null,
          };
        };
        mark('ad_copy', !!results.ad_copy?.success);
        mark('email_sequence', !!results.emails?.success);
        mark('sms_sequence', !!results.sms?.success);
        mark(
          'ai_conversation',
          !!(results.setter?.success && results.caller?.success),
        );
        mark(
          'canva_creatives',
          (results.static_ads?.generated ?? 0) >= 5,
          results.static_ads ? `${results.static_ads.generated || 0} generated` : null,
        );
        // compliance_check stays manual
        await persist(updated);
        await logNotification({
          channel: 'system',
          phase: phase.id,
          message: `auto-generate-onboarding finished — ${Object.values(results).filter((r: any) => r?.success).length} steps OK`,
        });
        await notifyOwner(phase, `AI asset generation complete — ready for review`);
        toast.success('AI assets generated');
        return;
      }

      // ── Generic phase: invoke configured edge function ──
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
          channel: 'system',
          phase: phase.id,
          message: `Triggered ${phase.title} via ${phase.edgeFunction}`,
        });
        await notifyOwner(phase, `Phase ${phase.num} (${phase.title}) triggered`);
      } else {
        toast.message('Manual phase — toggle items as work is completed.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to run phase');
      const next = { ...checklist };
      phase.items.forEach(item => {
        if (next[item.key]?.status === 'in_progress') {
          next[item.key] = { status: 'error', completed_at: null, note: err?.message ?? null };
        }
      });
      await persist(next);
      await logNotification({
        channel: 'system',
        phase: phase.id,
        message: `${phase.title} failed: ${err?.message || 'unknown error'}`,
        status: 'failed',
      });
      await notifyOwner(phase, `Phase ${phase.num} failed: ${err?.message || 'unknown'}`, 'failed');
    } finally {
      setRunningPhase(null);
    }
  }

  async function handleManagerDecision(approved: boolean) {
    const next = { ...checklist };
    if (approved) {
      PHASES[3].items.forEach(item => {
        next[item.key] = { status: 'done', completed_at: new Date().toISOString(), note: 'Approved by manager' };
      });
    } else {
      next['ad_copy_approved'] = { status: 'error', completed_at: null, note: 'Changes requested' };
    }
    await persist(next);
    await logNotification({
      channel: 'slack',
      phase: 'review',
      message: approved ? `${clientName}: Manager approved review phase` : `${clientName}: Manager requested changes`,
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
      {/* SLA banner */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start gap-2">
            <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-[11px] space-y-1 text-muted-foreground">
              <div><span className="font-medium text-foreground">Same-day:</span> CRM, copy, funnel preview, creatives (Phases 1–3)</div>
              <div><span className="font-medium text-foreground">Day 2–3:</span> Meta compliance warm-up + ads live (Phase 5 — requires warm-up)</div>
              <div><span className="font-medium text-foreground">Day 1–7:</span> A2P 10DLC approval (blocks SMS sending)</div>
            </div>
          </div>
        </CardContent>
      </Card>

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
        const allManual = phase.items.every(i => i.manualFallback);

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
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[11px] text-muted-foreground">{phase.description}</p>
                      <Badge variant="outline" className="text-[10px] gap-1 py-0">
                        <User className="h-2.5 w-2.5" /> {TEAM_NAMES[phase.owner]}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{doneCount}/{phase.items.length}</Badge>
                  {errorCount > 0 && (
                    <Badge variant="destructive" className="text-[10px]">{errorCount} err</Badge>
                  )}
                  {!isReview && !allManual && (
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
                      'text-xs flex-1 flex items-center gap-2',
                      state.status === 'done' && 'text-muted-foreground line-through',
                    )}>
                      {item.label}
                      {item.manualFallback && (
                        <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/40 text-amber-600">
                          manual
                        </Badge>
                      )}
                      {item.manualFallback && (
                        <a
                          href={GHL_HELP_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          title="Open GHL"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </span>
                    {(item.note || state.note) && (
                      <span className="text-[10px] text-muted-foreground italic truncate max-w-[160px]" title={state.note || item.note}>
                        {state.note || item.note}
                      </span>
                    )}
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                      <Button
                        size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                        onClick={() => setItemStatus(item.key, 'done', item.manualFallback ? 'Marked done' : null)}
                        disabled={state.status === 'done'}
                      >
                        {item.manualFallback ? 'Mark done' : '✓'}
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
          <p className="text-[11px] text-muted-foreground">Last {notifications.length} of 10 · live</p>
        </CardHeader>
        <CardContent className="pt-0">
          {notifications.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No notifications yet</p>
          ) : (
            <div className="space-y-1.5">
              {notifications.map((n: any) => {
                const ChannelIcon = n.channel === 'slack' ? Slack
                  : n.channel === 'email' ? Mail
                  : n.channel === 'whatsapp' ? MessageSquare
                  : n.channel === 'sms' ? Phone
                  : Clock;
                return (
                  <div key={n.id} className="flex items-center gap-2 py-1.5 px-2 rounded bg-muted/30 text-xs">
                    <Badge variant="outline" className="text-[10px] gap-1 capitalize">
                      <ChannelIcon className="h-3 w-3" /> {n.channel}
                    </Badge>
                    <span className="flex-1 truncate" title={n.message}>{n.message}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleTimeString()}
                    </span>
                    <Badge
                      variant={n.status === 'sent' ? 'outline' : n.status === 'failed' ? 'destructive' : 'secondary'}
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
