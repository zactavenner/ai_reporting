import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeDollarSign, CheckCircle2, Clock, DollarSign, Film, Image as ImageIcon,
  Loader2, Rocket, Search, ShieldCheck, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

async function callJeremy<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('jeremy-autonomous', {
    body: { action, ...body },
    headers: dashboardAuthHeaders(),
  });
  if (error) throw new Error(error.message);
  if (data && data.success === false) throw new Error(data.error || `Jeremy refused: ${action}`);
  return data as T;
}

const money = (n: unknown) => `$${(Number(n) || 0).toFixed(2)}`;

const KIND_META: Record<string, { label: string; icon: typeof Search }> = {
  apify_discovery: { label: 'Apify Instagram discovery', icon: Search },
  image_generation: { label: 'Static image generation', icon: ImageIcon },
  video_generation: { label: 'Video generation', icon: Film },
  meta_publish: { label: 'Create PAUSED Meta objects', icon: Rocket },
};

const STATUS_TONE: Record<string, 'secondary' | 'default' | 'destructive' | 'outline'> = {
  awaiting_approval: 'secondary',
  approved: 'default',
  claimed: 'default',
  running: 'default',
  succeeded: 'default',
  rejected: 'outline',
  expired: 'outline',
  failed: 'destructive',
  verification_failed: 'destructive',
};

function CapBar({ title, posture }: { title: string; posture: Record<string, any> | undefined }) {
  if (!posture) return null;
  const cap = Number(posture.monthly_cap_usd) || 0;
  const used = Number(posture.month_to_date_usd) || 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">
          {posture.enabled ? `${money(used)} of ${money(cap)} this month` : 'Disabled'}
        </span>
      </div>
      <Progress value={cap > 0 ? Math.min(100, (used / cap) * 100) : 0} className="h-1.5" />
      <p className="text-[10px] text-muted-foreground">
        Per-run cap {money(posture.per_run_cap_usd)} · remaining {money(posture.remaining_usd)}
      </p>
    </div>
  );
}

/**
 * Operator surface for every paid or external Jeremy job: exact provider target,
 * quoted maximum cost, cost caps and month-to-date usage, approve/reject,
 * progress, durable generated previews and the PAUSED publication confirmation.
 * There is deliberately no activation control anywhere in this panel.
 */
export function JeremyExternalJobsPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [scrapeType, setScrapeType] = useState<'profile' | 'hashtag' | 'url'>('profile');
  const [targets, setTargets] = useState('');
  const [resultsLimit, setResultsLimit] = useState(25);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['jeremy-jobs', clientId] });

  const { data, isLoading } = useQuery({
    queryKey: ['jeremy-jobs', clientId],
    enabled: !!clientId,
    refetchInterval: 20_000,
    queryFn: () => callJeremy('list_jobs', { client_id: clientId, limit: 50 }),
  });
  const jobs = (data?.jobs ?? []) as Record<string, any>[];
  const posture = data?.cost_posture as Record<string, any> | undefined;

  const quoteDiscovery = useMutation({
    mutationFn: () =>
      callJeremy('quote_discovery', {
        client_id: clientId,
        scrape_type: scrapeType,
        targets: targets.split(/[,\n]/).map((t) => t.trim()).filter(Boolean),
        results_limit: resultsLimit,
      }),
    onSuccess: (d: any) => {
      toast.success(`Quoted: max ${money(d?.job?.estimated_cost_usd)} — awaiting your approval`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: ({ jobId, approve }: { jobId: string; approve: boolean }) =>
      callJeremy(approve ? 'approve_job' : 'reject_job', { client_id: clientId, job_id: jobId }),
    onSuccess: (_d, v) => { toast.success(v.approve ? 'Job approved' : 'Job rejected'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const runJob = useMutation({
    mutationFn: (job: Record<string, any>) => {
      if (job.kind === 'apify_discovery') {
        const target = job.target ?? {};
        return callJeremy('run_discovery', {
          client_id: clientId,
          job_id: job.id,
          scrape_type: target.scrapeType,
          targets: target.targets,
          results_limit: target.resultsLimit,
          actor_id: target.actorId,
        });
      }
      if (job.kind === 'meta_publish') {
        return callJeremy('publish_launch', { client_id: clientId, job_id: job.id, launch_id: job.launch_id ?? job.target?.launch_id });
      }
      return callJeremy('run_generation', { client_id: clientId, job_id: job.id });
    },
    onSuccess: (d: any) => { toast.success(d?.reason || 'Job executed'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BadgeDollarSign className="h-4 w-4" /> Paid work: caps & month-to-date usage
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <CapBar title="Apify discovery" posture={posture?.discovery} />
          <CapBar title="Image & video generation" posture={posture?.generation} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Search className="h-4 w-4" /> Quote an Apify discovery run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Target type</Label>
              <Select value={scrapeType} onValueChange={(v) => setScrapeType(v as typeof scrapeType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="profile">Profiles</SelectItem>
                  <SelectItem value="hashtag">Hashtags</SelectItem>
                  <SelectItem value="url">Post URLs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Targets (comma separated)</Label>
              <Input value={targets} onChange={(e) => setTargets(e.target.value)} placeholder="acme.capital, investor.daily" />
            </div>
          </div>
          <div className="space-y-1 max-w-[200px]">
            <Label className="text-xs">Results per target</Label>
            <Input type="number" min={1} max={200} value={resultsLimit} onChange={(e) => setResultsLimit(Number(e.target.value))} />
          </div>
          <Button size="sm" disabled={!targets.trim() || quoteDiscovery.isPending} onClick={() => quoteDiscovery.mutate()}>
            {quoteDiscovery.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <DollarSign className="h-3.5 w-3.5 mr-1" />}
            Get exact quote
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Quoting spends nothing. The quote names the exact target count, result limit and maximum cost, and the run only
            happens after you approve it — inside both the Jeremy policy caps and the Apify monthly limit.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> External & paid jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading jobs…</p>}
          {!isLoading && !jobs.length && <p className="text-xs text-muted-foreground">No external jobs yet. Run a cycle or quote a discovery run.</p>}

          {jobs.map((job) => {
            const meta = KIND_META[job.kind] ?? { label: job.kind, icon: Search };
            const Icon = meta.icon;
            const target = (job.target ?? {}) as Record<string, any>;
            const verification = (job.verification ?? {}) as Record<string, any>;
            const durableUrl = String(verification.durable_url ?? '');
            return (
              <div key={job.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="font-medium">{meta.label}</span>
                  <Badge variant={STATUS_TONE[job.status] ?? 'outline'} className="text-[10px] capitalize">
                    {String(job.status).replace(/_/g, ' ')}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">max {money(job.estimated_cost_usd)}</Badge>
                  {job.actual_cost_usd != null && <Badge variant="outline" className="text-[10px]">actual {money(job.actual_cost_usd)}</Badge>}
                  <span className="text-muted-foreground">{new Date(job.created_at).toLocaleString()}</span>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {job.kind === 'apify_discovery'
                    ? `${target.scrapeType}: ${(target.targets ?? []).join(', ')} · ${target.resultsLimit} per target (max ${target.max_results} results)`
                    : job.kind === 'meta_publish'
                      ? `Launch ${target.launch_id} — campaign, ad set and ad are created PAUSED.`
                      : `${target.kind} · model ${target.model} · ${target.aspect_ratio}${target.duration_seconds ? ` · ${target.duration_seconds}s` : ''}`}
                </p>

                {job.status === 'running' && (
                  <p className="text-[11px] flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Provider job {job.provider_job_id ?? 'in flight'}…</p>
                )}
                {job.error && <p className="text-[11px] text-destructive">{job.error}</p>}
                {job.approved_by && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Approved by {job.approved_by} at {new Date(job.approved_at).toLocaleString()}
                  </p>
                )}
                {job.quote_expires_at && job.status === 'awaiting_approval' && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Quote valid until {new Date(job.quote_expires_at).toLocaleString()}
                  </p>
                )}

                {durableUrl && (
                  <a href={durableUrl} target="_blank" rel="noreferrer" className="block">
                    {job.kind === 'video_generation'
                      ? <video src={durableUrl} controls className="max-h-48 rounded-md border" />
                      : <img src={durableUrl} alt="Jeremy generated creative" loading="lazy" className="max-h-48 rounded-md border" />}
                  </a>
                )}
                {verification.statuses && (
                  <p className="text-[10px] text-muted-foreground">
                    Meta read-back: {Object.entries(verification.statuses as Record<string, string>).map(([k, v]) => `${k}=${v}`).join(' · ')}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {job.status === 'awaiting_approval' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => decide.mutate({ jobId: job.id, approve: true })}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve {money(job.estimated_cost_usd)}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decide.mutate({ jobId: job.id, approve: false })}>
                        <X className="h-3.5 w-3.5 mr-1" />Reject
                      </Button>
                    </>
                  )}

                  {job.status === 'approved' && job.kind !== 'meta_publish' && (
                    <Button size="sm" disabled={runJob.isPending} onClick={() => runJob.mutate(job)}>
                      {runJob.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <DollarSign className="h-3.5 w-3.5 mr-1" />}
                      Run now (spends up to {money(job.estimated_cost_usd)})
                    </Button>
                  )}

                  {job.status === 'approved' && job.kind === 'meta_publish' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm"><Rocket className="h-3.5 w-3.5 mr-1" />Create PAUSED Meta objects</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Create the campaign, ad set and ad — all PAUSED?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This creates real objects in the client's Meta ad account. Every object is created PAUSED, the
                            statuses are read back and verified, and nothing is ever activated. No budget is spent until
                            someone activates the campaign in Meta.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => runJob.mutate(job)}>Yes, create PAUSED objects</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
