import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Bot, Check, CheckCircle2, ChevronRight, Clock, Database, EyeOff,
  Gauge, Loader2, Lock, Pause, PlayCircle, RefreshCw, ShieldCheck, Sparkles, TrendingUp, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { JeremyExternalJobsPanel } from './JeremyExternalJobsPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint plumbing. Every call carries the operator dashboard token; the server
// re-authorizes before reading any data and revalidates every guardrail itself.
// ─────────────────────────────────────────────────────────────────────────────
async function callJeremy<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('jeremy-autonomous', {
    body: { action, ...body },
    headers: dashboardAuthHeaders(),
  });
  if (error) throw new Error(error.message);
  if (data && data.success === false) throw new Error(data.error || `Jeremy refused: ${action}`);
  return data as T;
}

const money = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const pct = (n: unknown) => `${Math.round((Number(n) || 0) * 100)}%`;

const MODE_COPY: Record<string, { label: string; tone: 'secondary' | 'default' | 'destructive'; blurb: string; icon: typeof EyeOff }> = {
  shadow: { label: 'Shadow', tone: 'secondary', blurb: 'Decisions are recorded only. Nothing is ever sent to Meta.', icon: EyeOff },
  approval: { label: 'Approval', tone: 'default', blurb: 'Jeremy proposes; a human approves each action before it can execute.', icon: ShieldCheck },
  autopilot: { label: 'Autopilot', tone: 'destructive', blurb: 'Approved plans may execute unattended, still inside every guardrail.', icon: Bot },
};

const ACTION_ICON: Record<string, typeof Pause> = { pause: Pause, adjust_budget: TrendingUp, hold: AlertTriangle };

function GateList({ gates }: { gates: Array<{ gate: string; allowed: boolean; reason: string }> }) {
  if (!gates?.length) return null;
  return (
    <ul className="space-y-1">
      {gates.map((g, i) => (
        <li key={`${g.gate}-${i}`} className="flex items-start gap-2 text-xs">
          {g.allowed
            ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
            : <X className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />}
          <span className="font-medium capitalize">{g.gate.replace(/_/g, ' ')}</span>
          <span className="text-muted-foreground">{g.reason}</span>
        </li>
      ))}
    </ul>
  );
}

export function JeremyAutonomyPanel({ clientId, clientName }: { clientId: string; clientName?: string }) {
  const qc = useQueryClient();
  const [windowDays, setWindowDays] = useState(30);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

  const invalidate = () => {
    for (const k of ['jeremy-policy', 'jeremy-coverage', 'jeremy-cycles', 'jeremy-plans', 'jeremy-executions']) {
      qc.invalidateQueries({ queryKey: [k, clientId] });
    }
  };

  const { data: contract } = useQuery({
    queryKey: ['jeremy-contract'],
    queryFn: () => callJeremy('get_kpi_contract'),
    staleTime: 600_000,
  });

  const { data: policyData, isLoading: policyLoading, error: policyError } = useQuery({
    queryKey: ['jeremy-policy', clientId],
    enabled: !!clientId,
    queryFn: () => callJeremy('get_policy', { client_id: clientId }),
  });
  const policy = policyData?.policy as Record<string, any> | undefined;

  const { data: coverageData } = useQuery({
    queryKey: ['jeremy-coverage', clientId, windowDays],
    enabled: !!clientId,
    queryFn: () => callJeremy('coverage', { client_id: clientId, window_days: windowDays }),
  });

  const { data: cyclesData } = useQuery({
    queryKey: ['jeremy-cycles', clientId],
    enabled: !!clientId,
    refetchInterval: 30_000,
    queryFn: () => callJeremy('list_cycles', { client_id: clientId, limit: 5 }),
  });
  const latestCycle = (cyclesData?.cycles ?? [])[0] as Record<string, any> | undefined;

  const { data: cycleDetail } = useQuery({
    queryKey: ['jeremy-cycle-detail', latestCycle?.id],
    enabled: !!latestCycle?.id,
    refetchInterval: 30_000,
    queryFn: () => callJeremy('get_cycle', { client_id: clientId, cycle_id: latestCycle!.id }),
  });

  const { data: plansData } = useQuery({
    queryKey: ['jeremy-plans', clientId],
    enabled: !!clientId,
    refetchInterval: 30_000,
    queryFn: () => callJeremy('list_plans', { client_id: clientId, limit: 50 }),
  });
  const plans = (plansData?.plans ?? []) as Record<string, any>[];

  const { data: execData } = useQuery({
    queryKey: ['jeremy-executions', clientId],
    enabled: !!clientId,
    refetchInterval: 30_000,
    queryFn: () => callJeremy('list_executions', { client_id: clientId, limit: 25 }),
  });
  const executions = (execData?.executions ?? []) as Record<string, any>[];

  const runCycle = useMutation({
    mutationFn: () => callJeremy('run_cycle', { client_id: clientId, window_days: windowDays }),
    onSuccess: (d: any) => { toast.success(d?.note || 'Cycle complete'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePolicy = useMutation({
    mutationFn: (patch: Record<string, unknown>) => callJeremy('update_policy', { client_id: clientId, policy: patch }),
    onSuccess: () => { toast.success('Guardrails saved'); setDraft(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: ({ planId, approve }: { planId: string; approve: boolean }) =>
      callJeremy(approve ? 'approve_plan' : 'reject_plan', { client_id: clientId, plan_id: planId }),
    onSuccess: (_d, v) => { toast.success(v.approve ? 'Plan approved' : 'Plan rejected'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const execute = useMutation({
    mutationFn: ({ plan, dryRun }: { plan: Record<string, any>; dryRun: boolean }) =>
      callJeremy('execute_action', {
        client_id: clientId,
        plan_id: plan.id,
        jeremy_action: plan.action,
        entity_type: plan.entity_type,
        meta_entity_id: plan.meta_entity_id,
        proposed_daily_budget: plan.proposed_daily_budget,
        cycle_id: plan.cycle_id,
        dry_run: dryRun,
      }),
    onSuccess: (d: any) => { toast.success(d?.reason || 'Execution recorded'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const coverage = coverageData?.coverage as Record<string, any> | undefined;
  const pending = useMemo(() => plans.filter((p) => p.status === 'pending'), [plans]);
  const approved = useMemo(() => plans.filter((p) => p.status === 'approved'), [plans]);
  const decided = useMemo(() => plans.filter((p) => !['pending', 'approved'].includes(String(p.status))), [plans]);
  const candidates = (cycleDetail?.candidates ?? []) as Record<string, any>[];
  const effective = { ...(policy ?? {}), ...(draft ?? {}) } as Record<string, any>;
  const modeMeta = MODE_COPY[String(effective.mode ?? 'shadow')] ?? MODE_COPY.shadow;
  const ModeIcon = modeMeta.icon;

  if (policyError) {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-2">
          <Lock className="h-5 w-5 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium">Operator access required</p>
          <p className="text-xs text-muted-foreground">{(policyError as Error).message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Header: mode + capability badges ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Jeremy Automation
                <Badge variant={modeMeta.tone} className="text-[10px] gap-1">
                  <ModeIcon className="h-3 w-3" />{modeMeta.label}
                </Badge>
                <Badge variant="outline" className="text-[10px]">New campaigns stay PAUSED</Badge>
                {!effective.paid_discovery_enabled && <Badge variant="outline" className="text-[10px]">Paid discovery off</Badge>}
                {!effective.paid_generation_enabled && <Badge variant="outline" className="text-[10px]">Paid generation off</Badge>}
              </CardTitle>
              <p className="text-xs text-muted-foreground max-w-2xl">
                {modeMeta.blurb} Jeremy runs the loop for {clientName || 'this client'}: discovery, ranking, derivative briefs,
                PAUSED launch drafts and budget/pause proposals. Every guardrail is re-checked on the server at execution time.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
                <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[7, 14, 30, 60].map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => runCycle.mutate()} disabled={runCycle.isPending}>
                {runCycle.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Run cycle
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ── KPI contract + data coverage ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4" /> KPI contract & data coverage
            {contract?.contract?.version && <Badge variant="secondary" className="text-[10px]">v{contract.contract.version}</Badge>}
            {coverage && (
              <Badge variant={coverage.outcome_data_complete ? 'default' : 'destructive'} className="text-[10px]">
                {coverage.outcome_data_complete ? 'Outcome data complete' : 'Outcome data incomplete'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Funded and qualified outcomes always outrank proxy metrics. When outcome data is incomplete, Jeremy holds — proxy
            metrics alone can never authorise a spend change.
          </p>
          {coverage && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ['Attribution coverage', pct(coverage.attribution_coverage)],
                  ['Funded records', coverage.funded_count ?? 0],
                  ['Qualified leads', coverage.qualified_leads ?? 0],
                  ['Spend in window', money(coverage.spend)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border p-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
                    <div className="text-sm font-semibold">{value as string}</div>
                  </div>
                ))}
              </div>
              <Progress value={(Number(coverage.attribution_coverage) || 0) * 100} className="h-1.5" />
              {!!coverage.missing?.length && (
                <div className="text-xs text-destructive space-y-0.5">
                  {coverage.missing.map((m: string) => <div key={m}>• {m}</div>)}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Guardrails ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Gauge className="h-4 w-4" /> Guardrails & spend policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {policyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Autonomy mode</Label>
                  <Select value={String(effective.mode)} onValueChange={(v) => setDraft({ ...(draft ?? {}), mode: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shadow">Shadow — record only</SelectItem>
                      <SelectItem value="approval">Approval — human approves each action</SelectItem>
                      <SelectItem value="autopilot">Autopilot — approved plans may run unattended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {([
                  ['scale_max_pct', 'Default scale cap %'],
                  ['scale_hard_max_pct', 'Hard scale cap % (max 30)'],
                  ['cooldown_hours', 'Cooldown hours'],
                  ['max_daily_budget_usd', 'Max daily budget $'],
                  ['max_account_daily_budget_delta_usd', 'Max account daily delta $'],
                  ['min_spend_usd', 'Min spend $ per decision'],
                  ['min_qualified_leads', 'Min qualified leads'],
                  ['min_funded_count', 'Min funded records'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      type="number"
                      className="h-8 text-xs"
                      value={String(effective[key] ?? '')}
                      onChange={(e) => setDraft({ ...(draft ?? {}), [key]: Number(e.target.value) })}
                    />
                  </div>
                ))}
              </div>
              <Separator />
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ['paid_discovery_enabled', 'Paid discovery (Apify)', 'paid_discovery_per_run_cap_usd', 'paid_discovery_monthly_cap_usd'],
                  ['paid_generation_enabled', 'Paid generation (AI renders)', 'paid_generation_per_run_cap_usd', 'paid_generation_monthly_cap_usd'],
                ] as const).map(([flag, label, perRun, monthly]) => (
                  <div key={flag} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">{label}</Label>
                      <Switch
                        checked={effective[flag] === true}
                        onCheckedChange={(v) => setDraft({ ...(draft ?? {}), [flag]: v })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label className="text-[10px] text-muted-foreground">Per run $</Label>
                        <Input type="number" className="h-7 text-xs" value={String(effective[perRun] ?? 0)}
                          onChange={(e) => setDraft({ ...(draft ?? {}), [perRun]: Number(e.target.value) })} /></div>
                      <div><Label className="text-[10px] text-muted-foreground">Monthly $</Label>
                        <Input type="number" className="h-7 text-xs" value={String(effective[monthly] ?? 0)}
                          onChange={(e) => setDraft({ ...(draft ?? {}), [monthly]: Number(e.target.value) })} /></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Accounts stay in Shadow until an operator changes it here. The server clamps anything above the hard ceilings.
                </p>
                <div className="flex gap-2">
                  {draft && <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" disabled={!draft || savePolicy.isPending}>
                        {savePolicy.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save guardrails
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Change Jeremy's guardrails?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This changes what Jeremy is permitted to do with real ad spend on {clientName || 'this client'}.
                          Moving to Approval or Autopilot means budget and pause changes can reach Meta once approved.
                          No control here activates a campaign — new campaigns always stay PAUSED.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => draft && savePolicy.mutate(draft)}>Save guardrails</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Cycle status ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4" /> Latest cycle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!latestCycle ? (
            <p className="text-xs text-muted-foreground">No cycle has run yet for this client.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={latestCycle.status === 'failed' ? 'destructive' : latestCycle.status === 'completed' ? 'default' : 'secondary'} className="capitalize text-[10px]">
                  {latestCycle.status}
                </Badge>
                <span className="text-muted-foreground">Stage</span>
                <span className="font-medium capitalize">{String(latestCycle.stage ?? '').replace(/_/g, ' ')}</span>
                <span className="text-muted-foreground">· {new Date(latestCycle.created_at).toLocaleString()}</span>
                {latestCycle.mode && <Badge variant="outline" className="text-[10px] capitalize">{latestCycle.mode}</Badge>}
              </div>
              {latestCycle.error_message && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  {latestCycle.error_message}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 text-[10px]">
                {['discovery', 'selection', 'recreation', 'launch', 'analysis', 'action', 'verification'].map((s) => (
                  <Badge key={s} variant={latestCycle.stage === s ? 'default' : 'outline'} className="capitalize">{s}</Badge>
                ))}
              </div>
              {!!candidates.length && (
                <div className="space-y-2">
                  <div className="text-xs font-medium">Candidate evidence & derivative briefs</div>
                  {candidates.slice(0, 6).map((c) => (
                    <div key={c.id} className="rounded-lg border p-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium truncate">{c.title || c.source_ref || 'Candidate'}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{c.source_type}</Badge>
                          <Badge variant="secondary" className="text-[10px]">score {Math.round(Number(c.score) || 0)}</Badge>
                          {c.generation_status && <Badge variant="outline" className="text-[10px] capitalize">{String(c.generation_status).replace(/_/g, ' ')}</Badge>}
                        </div>
                      </div>
                      {c.evidence_summary && <p className="text-[11px] text-muted-foreground">{c.evidence_summary}</p>}
                      {c.derivative_brief?.hook && (
                        <p className="text-[11px] flex items-start gap-1"><ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />{c.derivative_brief.hook}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Pending & approved decisions ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Decisions
            <Badge variant="secondary" className="text-[10px]">{pending.length} pending</Badge>
            <Badge variant="outline" className="text-[10px]">{approved.length} approved</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!plans.length && <p className="text-xs text-muted-foreground">No proposals recorded yet. Run a cycle to produce decisions.</p>}
          {[...pending, ...approved, ...decided.slice(0, 10)].map((p) => {
            const Icon = ACTION_ICON[String(p.action)] ?? AlertTriangle;
            const gates = (p.gates ?? []) as Array<{ gate: string; allowed: boolean; reason: string }>;
            const isPending = p.status === 'pending';
            const isApproved = p.status === 'approved';
            return (
              <div key={p.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-medium truncate">{p.entity_name || p.meta_entity_id}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{p.entity_type}</Badge>
                    <Badge variant={p.action === 'hold' ? 'secondary' : 'default'} className="text-[10px]">
                      {p.action === 'adjust_budget'
                        ? `Scale ${money(p.current_daily_budget)} → ${money(p.proposed_daily_budget)}/day`
                        : String(p.action).replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] capitalize">{p.status}</Badge>
                    {p.basis && <Badge variant="outline" className="text-[10px]">{String(p.basis).replace(/_/g, ' ')}</Badge>}
                    {p.executable === false && <Badge variant="outline" className="text-[10px]">Gate blocked</Badge>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isPending && p.executable && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => decide.mutate({ planId: p.id, approve: false })} disabled={decide.isPending}>
                          <X className="h-3.5 w-3.5 mr-1" />Reject
                        </Button>
                        <Button size="sm" onClick={() => decide.mutate({ planId: p.id, approve: true })} disabled={decide.isPending}>
                          <Check className="h-3.5 w-3.5 mr-1" />Approve
                        </Button>
                      </>
                    )}
                    {isApproved && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => execute.mutate({ plan: p, dryRun: true })} disabled={execute.isPending}>
                          Dry run
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="destructive" disabled={execute.isPending}>
                              <PlayCircle className="h-3.5 w-3.5 mr-1" />Execute live
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Send this change to Meta?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This writes to the live ad account: {p.action === 'adjust_budget'
                                  ? `raising ${p.entity_name || p.meta_entity_id} to ${money(p.proposed_daily_budget)}/day`
                                  : `pausing ${p.entity_name || p.meta_entity_id}`}. It affects real spend immediately.
                                The server re-checks every gate against live account state and refuses if anything has changed
                                since approval. Nothing is ever activated or deleted.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => execute.mutate({ plan: p, dryRun: false })}>
                                Yes, execute in Meta
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </div>
                {p.reason && <p className="text-xs text-muted-foreground">{p.reason}</p>}
                <GateList gates={gates} />
                {p.expires_at && (
                  <p className="text-[10px] text-muted-foreground">Evidence valid until {new Date(p.expires_at).toLocaleString()}</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── External & paid jobs: quotes, approvals, PAUSED publication ─── */}
      <JeremyExternalJobsPanel clientId={clientId} />

      {/* ── Execution audit trail ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4" /> Execution & read-back audit trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!executions.length && <p className="text-xs text-muted-foreground">No executions recorded.</p>}
          {executions.map((e) => (
            <div key={e.id} className="rounded-lg border p-2 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={e.status === 'succeeded' ? 'default' : e.status === 'blocked' ? 'secondary' : 'destructive'} className="text-[10px] capitalize">
                  {e.status}
                </Badge>
                <span className="font-medium capitalize">{String(e.action).replace(/_/g, ' ')}</span>
                <span className="text-muted-foreground truncate">{e.meta_entity_id}</span>
                {e.dry_run && <Badge variant="outline" className="text-[10px]">Dry run</Badge>}
                <Badge variant="outline" className="text-[10px] capitalize">{String(e.verification_status ?? '').replace(/_/g, ' ')}</Badge>
                <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                {e.executed_by && <span className="text-muted-foreground">by {e.executed_by}</span>}
              </div>
              {e.error_detail && <p className="text-[11px] text-destructive">{e.error_detail}</p>}
              <GateList gates={(e.gate_evidence ?? []) as Array<{ gate: string; allowed: boolean; reason: string }>} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
