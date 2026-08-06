import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { CheckCircle2, Circle, Loader2, Sparkles, ShieldCheck, Video, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { OfferReviewGate, type OfferReviewState } from './OfferReviewGate';

const DELIVERABLES: { key: string; label: string }[] = [
  { key: 'offer_summary', label: 'Offer summary · location · strategy · credibility' },
  { key: 'angles', label: '5 marketing angles' },
  { key: 'ad_copy', label: '5 ad copy variants + headlines' },
  { key: 'nurture_emails', label: '10 nurture emails' },
  { key: 'appointment_reminders', label: 'Appointment reminders (email + SMS)' },
  { key: 'vsl', label: 'VSL script' },
  { key: 'video_scripts', label: '5 video ad scripts' },
  { key: 'faq_scripts', label: '5 FAQ video scripts' },
  { key: 'static_ad_brief', label: 'Static ad direction + 10 statics' },
];

interface Props {
  clientId: string;
  clientName: string;
  offerId?: string | null;
  onOpenStudio?: () => void;
}

export function OnboardingBuildPanel({ clientId, clientName, offerId, onOpenStudio }: Props) {
  const [goal, setGoal] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [assetTypes, setAssetTypes] = useState<Set<string>>(new Set());
  const [approvals, setApprovals] = useState<any[]>([]);
  const [avatar, setAvatar] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<OfferReviewState>({ offerId: null, reviewed: false });
  const [counts, setCounts] = useState({ statics: 0, videos: 0 });

  const onReviewChange = useCallback((s: OfferReviewState) => setReview(s), []);

  const refresh = useCallback(async () => {
    const [g, a, ap, av] = await Promise.all([
      supabase.from('jarvis_goals').select('*').eq('client_id', clientId)
        .ilike('title', 'Onboarding build%').order('created_at', { ascending: false }).limit(1),
      supabase.from('client_assets').select('asset_type, created_at').eq('client_id', clientId),
      supabase.from('approval_queue').select('*').eq('client_id', clientId)
        .in('queue_type', ['creative_review', 'video_scripts']).order('created_at', { ascending: false }).limit(10),
      supabase.from('avatars').select('id, name, image_url').eq('client_id', clientId)
        .order('created_at', { ascending: false }).limit(1),
    ]);
    const found = g.data?.[0] || null;
    setGoal(found);
    setAssetTypes(new Set((a.data || []).map((r: any) => r.asset_type)));
    setApprovals(ap.data || []);
    setAvatar(av.data?.[0] || null);
    const [sc, vc] = await Promise.all([
      supabase.from('creatives').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).eq('source', 'onboarding-build'),
      supabase.from('creative_video_jobs').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId),
    ]);
    setCounts({ statics: sc.count || 0, videos: vc.count || 0 });
    if (found) {
      const { data: ev } = await supabase.from('jarvis_goal_events')
        .select('id, kind, title, content, created_at')
        .eq('goal_id', found.id).order('created_at', { ascending: false }).limit(40);
      setEvents(ev || []);
    } else {
      setEvents([]);
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Live feed while the mission is running on the backend.
  useEffect(() => {
    if (!goal?.id || !['queued', 'running'].includes(goal.status)) return;
    const ch = supabase
      .channel(`onboarding-build-${goal.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jarvis_goal_events', filter: `goal_id=eq.${goal.id}` }, () => refresh())
      .subscribe();
    const t = setInterval(refresh, 15000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [goal?.id, goal?.status, refresh]);

  async function start() {
    setStarting(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke('onboarding-build', {
        body: {
          password: 'HPA1234$',
          client_id: clientId,
          offer_id: offerId || review.offerId || null,
          created_by: auth?.user?.id || null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Build started — it keeps running on the backend');
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start build');
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
    toast.success(approved ? 'Approved — video agent unblocked' : 'Sent back for rewrite');
    refresh();
  }

  const running = goal && ['queued', 'running'].includes(goal.status);
  const locked = !review.reviewed;

  if (loading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3">
      <OfferReviewGate clientId={clientId} onChange={onReviewChange} />

      <Card className="p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Step 2 · AI Studio onboarding build</span>
            {goal && (
              <Badge variant={goal.status === 'completed' ? 'default' : running ? 'secondary' : 'outline'} className="text-[10px] capitalize">
                {goal.status}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Jeremy AI + the client agents build the offer summary, 5 angles, ad copy, 10 nurture emails, reminders, VSL, static ads,
            a 30-year-old female avatar, 5 video ad scripts and 5 FAQ scripts — straight onto the AI Studio canvas.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Hard limits per client: <span className="font-medium text-foreground">10 statics</span> ({counts.statics}/10 made) and{' '}
            <span className="font-medium text-foreground">5 × 30s videos</span> ({counts.videos}/5 started) — podcast, street interview, walk-and-talk, b-roll, split screen.
          </p>
          {locked && (
            <p className="text-[11px] text-amber-600 mt-1">Approve the offer above to unlock the build.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onOpenStudio && (
            <Button size="sm" variant="outline" onClick={onOpenStudio}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open AI Studio
            </Button>
          )}
          <Button size="sm" onClick={start} disabled={starting || !!running || locked}>
            {starting || running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            {running ? 'Building…' : locked ? 'Locked — review offer' : goal ? 'Rebuild all assets' : 'Build all assets'}
          </Button>
        </div>
      </Card>

      <div className="grid gap-2 sm:grid-cols-2">
        {DELIVERABLES.map(d => {
          const done = assetTypes.has(d.key);
          return (
            <div key={d.key} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2', done && 'bg-green-500/5 border-green-500/30')}>
              {done ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /> : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
              <span className="text-xs truncate">{d.label}</span>
            </div>
          );
        })}
        <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2', avatar && 'bg-green-500/5 border-green-500/30')}>
          {avatar ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" /> : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />}
          <span className="text-xs truncate">Client avatar assigned{avatar ? ` · ${avatar.name}` : ''}</span>
        </div>
      </div>

      {approvals.length > 0 && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Review &amp; approvals</span>
          </div>
          {approvals.map(a => (
            <div key={a.id} className="rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                {a.queue_type === 'video_scripts' ? <Video className="h-3.5 w-3.5 text-primary" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}
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
              {a.queue_type === 'video_scripts' && a.status === 'pending' && (
                <p className="text-[11px] text-amber-600 mt-1">Avatar videos stay blocked until these scripts are approved.</p>
              )}
            </div>
          ))}
        </Card>
      )}

      {events.length > 0 && (
        <Card className="p-3">
          <div className="text-xs font-medium mb-2">Live build feed — {clientName}</div>
          <div className="max-h-64 overflow-auto space-y-1.5">
            {events.map(e => (
              <div key={e.id} className="text-[11px] flex gap-2">
                <span className="text-muted-foreground shrink-0">{new Date(e.created_at).toLocaleTimeString()}</span>
                <Badge variant="outline" className="text-[9px] h-4 shrink-0">{e.kind}</Badge>
                <span className="truncate">{e.title}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {goal?.report_md && (
        <Card className="p-3">
          <div className="text-xs font-medium mb-1">Build report</div>
          <pre className="text-[11px] whitespace-pre-wrap font-mono max-h-64 overflow-auto">{goal.report_md}</pre>
        </Card>
      )}
    </div>
  );
}