import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Film, Image as ImageIcon,
  Loader2, Lock, MessageSquare, Rocket, ShieldCheck, Sparkles, UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { OfferReviewGate } from './OfferReviewGate';
import { AssetInlineChat } from './AssetInlineChat';
import { OnboardingStageRail } from './OnboardingStageRail';
import { useOnboardingDock } from '@/hooks/useOnboardingDock';
import {
  ONBOARDING_STAGES, ONBOARDING_STATIC_BUDGET, ONBOARDING_VIDEO_BUDGET,
  assetsForStage, flattenAssetContent, fmtStageDuration, scriptApprovalState,
  type StageDef, type StageStatus,
} from '@/lib/onboarding/dockStages';

interface Props {
  clientId: string;
  clientName: string;
  offerId?: string | null;
  /** Jump the studio back to the canvas so the operator can see generated items. */
  onOpenCanvas?: () => void;
}

export function OnboardingDock({ clientId, clientName, offerId, onOpenCanvas }: Props) {
  const { snapshot, statuses, loading, refresh, elapsedFor, totalElapsed } = useOnboardingDock(clientId);
  const [starting, setStarting] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const jump = useCallback((key: string) => {
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const goal = snapshot.goal;
  const running = !!goal && ['queued', 'running'].includes(goal.status);
  const offerReviewed = !!snapshot.offer?.offer_reviewed_at;
  const scripts = scriptApprovalState(snapshot);

  async function startBuild() {
    setStarting(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke('onboarding-build', {
        body: {
          password: 'HPA1234$',
          client_id: clientId,
          offer_id: offerId || snapshot.offer?.id || null,
          created_by: auth?.user?.id || null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Build running — it keeps going on the backend');
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Could not start the build');
    } finally {
      setStarting(false);
    }
  }

  async function resolveApproval(id: string, approved: boolean) {
    const reason = approved ? null : window.prompt('What needs to change?') || 'Rejected';
    const { error } = await supabase.from('approval_queue').update({
      status: approved ? 'approved' : 'rejected',
      rejection_reason: reason,
      resolved_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success(approved ? 'Approved — video agent unblocked' : 'Sent back for a rewrite');
    refresh();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      {/* Stage rail — always visible, mirrors the huddle agenda */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r pr-3">
        <OnboardingStageRail
          statuses={statuses}
          elapsedFor={elapsedFor}
          totalElapsed={totalElapsed}
          onJump={jump}
        />
      </aside>

      {/* One long dock */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Sticky control bar */}
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b pb-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold truncate">Onboarding · {clientName}</span>
              {goal && (
                <Badge variant={goal.status === 'completed' ? 'default' : running ? 'secondary' : 'outline'} className="text-[10px] capitalize">
                  {goal.status}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Approve the offer once — Jeremy AI then builds every asset end to end.
              Hard caps: {snapshot.statics.length}/{ONBOARDING_STATIC_BUDGET} statics ·{' '}
              {snapshot.videoJobs.length}/{ONBOARDING_VIDEO_BUDGET} videos.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline text-[11px] font-mono tabular-nums text-muted-foreground">
              {fmtStageDuration(totalElapsed)}
            </span>
            {onOpenCanvas && (
              <Button size="sm" variant="outline" onClick={onOpenCanvas}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Canvas
              </Button>
            )}
            <Button size="sm" onClick={startBuild} disabled={starting || running || !offerReviewed}>
              {starting || running
                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              {running ? 'Building…' : !offerReviewed ? 'Locked' : goal ? 'Rebuild' : 'Run onboarding'}
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 -mr-3 pr-3">
          <div className="space-y-4 pb-16">
            {ONBOARDING_STAGES.map((stage) => (
              <StageSection
                key={stage.key}
                stage={stage}
                status={statuses[stage.key] ?? 'pending'}
                elapsed={elapsedFor(stage.key)}
                ref={(el) => { sectionRefs.current[stage.key] = el; }}
              >
                {stage.key === 'offer_review' && (
                  <OfferReviewGate clientId={clientId} onChange={refresh} />
                )}

                {stage.key === 'avatar' && (
                  snapshot.avatar ? (
                    <div className="flex items-center gap-3 rounded-lg border p-3">
                      {snapshot.avatar.image_url ? (
                        <img
                          src={snapshot.avatar.image_url}
                          alt={`${snapshot.avatar.name} avatar for ${clientName}`}
                          className="h-16 w-16 rounded-lg object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center">
                          <UserRound className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 text-xs">
                        <div className="font-medium">{snapshot.avatar.name}</div>
                        <div className="text-muted-foreground mt-0.5">
                          {[snapshot.avatar.gender, snapshot.avatar.age_range, snapshot.avatar.style].filter(Boolean).join(' · ') || 'Assigned'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <EmptyNote text="No avatar assigned yet — the build creates a spokesperson avatar for this client." />
                  )
                )}

                {stage.key === 'statics' && (
                  snapshot.statics.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {snapshot.statics.map((c: any) => (
                        <div key={c.id} className="rounded-lg border overflow-hidden">
                          {c.file_url ? (
                            <img
                              src={c.file_url}
                              alt={c.headline || c.title || 'Static ad'}
                              className="w-full aspect-square object-cover bg-muted"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full aspect-square bg-muted flex items-center justify-center">
                              <ImageIcon className="h-6 w-6 text-muted-foreground" />
                            </div>
                          )}
                          <div className="p-2">
                            <div className="text-xs font-medium truncate">{c.headline || c.title || 'Static'}</div>
                            {c.body_copy && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{c.body_copy}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyNote text={`No statics yet — up to ${ONBOARDING_STATIC_BUDGET} get generated from the approved offer.`} />
                  )
                )}

                {stage.key === 'videos' && (
                  <>
                    {scripts === 'pending' && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-600 mb-3">
                        <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>Avatar videos stay blocked until the video scripts above are approved.</span>
                      </div>
                    )}
                    {snapshot.videoJobs.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {snapshot.videoJobs.map((j: any) => (
                          <div key={j.id} className="rounded-lg border overflow-hidden">
                            {j.output_url ? (
                              <video src={j.output_url} controls className="w-full bg-black aspect-video" preload="metadata" />
                            ) : (
                              <div className="w-full aspect-video bg-muted flex flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground">
                                <Film className="h-5 w-5" />
                                {j.progress_label || j.status}
                              </div>
                            )}
                            <div className="p-2 space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge variant={j.status === 'completed' ? 'default' : j.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px] capitalize">
                                  {j.status}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {[j.resolution, j.aspect_ratio, j.duration ? `${j.duration}s` : null].filter(Boolean).join(' · ')}
                                </span>
                              </div>
                              {j.prompt && <p className="text-[11px] text-muted-foreground line-clamp-2">{j.prompt}</p>}
                              {j.error && <p className="text-[11px] text-destructive line-clamp-2">{j.error}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyNote text={`${ONBOARDING_VIDEO_BUDGET} × 30s videos render here: podcast, street interview, walk-and-talk, b-roll, split screen.`} />
                    )}
                  </>
                )}

                {stage.key === 'ready' && (
                  <div className="space-y-3">
                    {snapshot.approvals.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ShieldCheck className="h-4 w-4 text-primary" /> Reviews &amp; approvals
                        </div>
                        {snapshot.approvals.map((a: any) => (
                          <div key={a.id} className="rounded-lg border px-3 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium truncate flex-1">{a.title}</span>
                              <Badge variant={a.status === 'approved' ? 'default' : a.status === 'rejected' ? 'destructive' : 'secondary'} className="text-[10px] capitalize">
                                {a.status}
                              </Badge>
                              {a.status === 'pending' && (
                                <div className="flex items-center gap-1.5">
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => resolveApproval(a.id, false)}>Request changes</Button>
                                  <Button size="sm" className="h-7 text-xs" onClick={() => resolveApproval(a.id, true)}>Approve</Button>
                                </div>
                              )}
                            </div>
                            {a.summary && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">{a.summary}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {goal?.report_md && (
                      <div>
                        <div className="text-xs font-medium mb-1">Build report</div>
                        <pre className="text-[11px] whitespace-pre-wrap font-mono rounded-lg border p-3 max-h-72 overflow-auto">{goal.report_md}</pre>
                      </div>
                    )}
                    {snapshot.events.length > 0 && (
                      <div>
                        <div className="text-xs font-medium mb-1">Live build feed</div>
                        <div className="rounded-lg border p-2 max-h-64 overflow-auto space-y-1.5">
                          {snapshot.events.map((e: any) => (
                            <div key={e.id} className="text-[11px] flex gap-2">
                              <span className="text-muted-foreground shrink-0">{new Date(e.created_at).toLocaleTimeString()}</span>
                              <Badge variant="outline" className="text-[9px] h-4 shrink-0">{e.kind}</Badge>
                              <span className="truncate">{e.title}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {snapshot.approvals.length === 0 && !goal?.report_md && snapshot.events.length === 0 && (
                      <EmptyNote text="Approvals, the build report and the live feed land here." />
                    )}
                  </div>
                )}

                {/* Text deliverables (strategy, copy, statics brief, scripts) */}
                {stage.assetTypes && (
                  <div className="space-y-3">
                    {stage.assetTypes.map((type) => {
                      const asset = assetsForStage(snapshot, stage).find((a: any) => a.asset_type === type);
                      return <AssetBlock key={type} type={type} asset={asset} onUpdated={refresh} />;
                    })}
                  </div>
                )}
              </StageSection>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

/* ── Section shell ───────────────────────────────────────────── */

import { forwardRef, type ReactNode } from 'react';

const StageSection = forwardRef<HTMLDivElement, {
  stage: StageDef;
  status: StageStatus;
  elapsed: number | null;
  children: ReactNode;
}>(function StageSection({ stage, status, elapsed, children }, ref) {
  return (
    <Card
      ref={ref}
      className={cn(
        'p-4 scroll-mt-2',
        status === 'active' && 'border-primary/50 shadow-sm',
        status === 'blocked' && 'border-amber-500/40',
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        {status === 'complete'
          ? <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          : status === 'blocked'
            ? <Lock className="h-4 w-4 text-amber-500 shrink-0" />
            : <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />}
        <h3 className="text-sm font-semibold truncate">{stage.label}</h3>
        <Badge variant={status === 'complete' ? 'default' : status === 'active' ? 'secondary' : 'outline'} className="text-[10px] capitalize">
          {status === 'blocked' ? 'waiting on you' : status}
        </Badge>
        {elapsed != null && (
          <span className="ml-auto text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
            {fmtStageDuration(elapsed)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">{stage.hint}</p>
      {children}
    </Card>
  );
});

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground">
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/* ── One text deliverable, expanded inline ───────────────────── */

const ASSET_LABELS: Record<string, string> = {
  offer_summary: 'Offer summary · location · strategy · credibility',
  angles: '5 marketing angles',
  ad_copy: '5 ad copy variants + headlines',
  nurture_emails: '10 nurture emails',
  appointment_reminders: 'Appointment reminders (email + SMS)',
  vsl: 'VSL script',
  video_scripts: '5 video ad scripts',
  faq_scripts: '5 FAQ video scripts',
  static_ad_brief: 'Static ad direction',
};

function AssetBlock({ type, asset, onUpdated }: { type: string; asset: any | undefined; onUpdated: () => void }) {
  const [open, setOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const label = ASSET_LABELS[type] || type.replace(/_/g, ' ');

  if (!asset) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {label} — not generated yet
      </div>
    );
  }

  const blocks = flattenAssetContent(asset.content);

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium truncate flex-1">{asset.title || label}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setChatOpen(v => !v)}>
          <MessageSquare className="h-3 w-3 mr-1" /> Refine
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setOpen(v => !v)} aria-label={open ? 'Collapse' : 'Expand'}>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
        </Button>
      </div>
      {open && (
        <div className="p-3 space-y-3">
          {blocks.length === 0 && <p className="text-[11px] text-muted-foreground">Empty.</p>}
          {blocks.map((b, i) => (
            <div key={i}>
              {b.label && (
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{b.label}</div>
              )}
              <p className="text-xs whitespace-pre-wrap leading-relaxed">{b.body}</p>
            </div>
          ))}
        </div>
      )}
      {chatOpen && (
        <div className="border-t p-3">
          <AssetInlineChat assetId={asset.id} assetType={asset.asset_type} onContentUpdated={onUpdated} />
        </div>
      )}
    </div>
  );
}