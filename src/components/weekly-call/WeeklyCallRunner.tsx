import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Play, Pause, SkipForward, Plus, ChevronRight, ChevronLeft, PartyPopper, Circle, Loader2, X, Upload, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { useThisWeekCall } from '@/hooks/useThisWeekCall';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { useSegmentTiming } from '@/hooks/useHuddle';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  WinsSegment, ScorecardSegment, CreativeReviewSegment, TasksSegment, RecapSegment,
} from './WeeklyCallSegments';
import { WeeklyCallSettingsDrawer } from './WeeklyCallSettingsDrawer';

function fmt(s: number) {
  const neg = s < 0;
  const abs = Math.abs(Math.floor(s));
  const m = Math.floor(abs / 60);
  const sec = abs % 60;
  return `${neg ? '-' : ''}${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function StatusIndicators({
  isRecording, uploading, finalizeStatus,
}: { isRecording: boolean; uploading: boolean; finalizeStatus: string | null }) {
  const items: Array<{ key: string; icon: any; label: string; className: string; spin?: boolean; pulse?: boolean }> = [];
  if (isRecording) items.push({ key: 'rec', icon: Circle, label: 'Recording', className: 'text-destructive', pulse: true });
  if (uploading) items.push({ key: 'up', icon: Upload, label: 'Uploading…', className: 'text-amber-500', spin: false });
  if (finalizeStatus === 'pending' || finalizeStatus === 'processing') {
    items.push({ key: 'tx', icon: Loader2, label: 'Transcribing…', className: 'text-blue-500', spin: true });
  }
  if (finalizeStatus === 'done') items.push({ key: 'done', icon: CheckCircle2, label: 'Tasks ready', className: 'text-emerald-500' });
  if (finalizeStatus === 'error') items.push({ key: 'err', icon: AlertCircle, label: 'Transcript failed', className: 'text-destructive' });
  if (!items.length) return null;
  return (
    <div className="flex items-center gap-2 ml-2" aria-live="polite">
      {items.map((it) => (
        <span
          key={it.key}
          className={`inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] ${it.className}`}
          title={it.label}
        >
          <it.icon className={`w-3 h-3 ${it.spin ? 'animate-spin' : ''} ${it.pulse ? 'fill-current animate-pulse' : ''}`} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
function playChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 660;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.42);
  } catch {}
}

export function WeeklyCallRunner({ clientId, onFinish }: { clientId: string; onFinish?: () => void }) {
  const { call, agenda, loading, updateTimer, updateCall, updateAgenda } = useThisWeekCall(clientId);
  const { currentMember } = useTeamMember();
  const chimed = useRef<number>(-1);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const autoFinishedRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);

  const timer = call?.timer_state;
  const timing = useSegmentTiming(
    agenda,
    timer || { segment_index: 0, segment_started_at: null, paused_at: null, paused_elapsed_s: 0, auto_advance: false, running: false, finished: false, extra_s: 0 }
  );
  const isLastSegment = (timer?.segment_index ?? 0) >= agenda.length - 1;
  const isFacilitator = !!currentMember && !!call?.facilitator_id && currentMember.id === call.facilitator_id;

  useEffect(() => { chimed.current = -1; }, [timer?.segment_index, timer?.segment_started_at]);

  const meetingElapsed = useMemo(() => {
    if (!call?.started_at) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000));
  }, [call?.started_at, timing.elapsed]);

  useEffect(() => {
    if (!timer || !timer.running) return;
    if (timing.remaining <= 0 && chimed.current !== timing.idx) {
      chimed.current = timing.idx;
      playChime();
      if (timer.auto_advance && isFacilitator) next();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timing.remaining, timer?.running, isFacilitator]);

  // Auto-finish when total planned duration is exhausted
  useEffect(() => {
    if (!call?.started_at || timer?.finished || autoFinishedRef.current) return;
    // Auto-finish only when timer expires on the LAST segment
    const isLast = (timer?.segment_index ?? 0) >= agenda.length - 1;
    if (isLast && timing.remaining <= 0) {
      autoFinishedRef.current = true;
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timing.remaining, timer?.segment_index, timer?.finished, call?.started_at, agenda.length]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start(2000);
      mediaRecorderRef.current = rec;
      setIsRecording(true);
    } catch (e) {
      console.warn('mic denied:', e);
      toast.error('Microphone denied — call will run without recording');
    }
  };

  const stopAndUploadRecording = async (callId: string): Promise<string | null> => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === 'inactive') return null;
    return new Promise<string | null>((resolve) => {
      rec.onstop = async () => {
        try {
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          chunksRef.current = [];
          setIsRecording(false);
          if (blob.size < 5000) { resolve(null); return; }
          const path = `${callId}-${Date.now()}.webm`;
        setUploading(true);
          const { error: upErr } = await supabase.storage.from('weekly-call-recordings').upload(path, blob, {
            contentType: 'audio/webm', upsert: true,
          });
        setUploading(false);
        if (upErr) { console.warn('upload failed:', upErr); resolve(null); return; }
          const { data } = supabase.storage.from('weekly-call-recordings').getPublicUrl(path);
          resolve(data.publicUrl);
        } catch (e) {
          console.warn('stop/upload failed:', e);
        setUploading(false);
          resolve(null);
        }
      };
      rec.stop();
    });
  };

  const start = async () => {
    if (!call) return;
    const now = new Date().toISOString();
    if (!call.started_at) {
      await updateCall({
        started_at: now, status: 'in_progress',
        ...(call.facilitator_id ? {} : { facilitator_id: currentMember?.id ?? null }),
      } as any);
      startRecording();
    }
    await updateTimer({
      running: true,
      segment_started_at: timer?.segment_started_at || now,
      paused_at: null,
      paused_elapsed_s: timer?.paused_elapsed_s || 0,
    });
  };
  const pause = async () => { if (timer?.running) await updateTimer({ running: false, paused_at: new Date().toISOString() }); };
  const resume = async () => {
    if (!timer || timer.running) return;
    let pe = timer.paused_elapsed_s || 0;
    if (timer.paused_at && timer.segment_started_at) pe += Math.floor((Date.now() - new Date(timer.paused_at).getTime()) / 1000);
    await updateTimer({ running: true, paused_at: null, paused_elapsed_s: pe });
  };
  const bump30 = async () => {
    if (!timer) return;
    if (isLastSegment) { toast.error('No overtime on the recap step'); return; }
    await updateTimer({ extra_s: (timer.extra_s || 0) + 30 });
  };
  const next = async () => {
    if (!timer || !call) return;
    const nextIdx = timer.segment_index + 1;
    if (nextIdx >= agenda.length) { await finish(); return; }
    chimed.current = -1;
    await updateTimer({ segment_index: nextIdx, segment_started_at: new Date().toISOString(), paused_at: null, paused_elapsed_s: 0, extra_s: 0, running: true });
  };
  const back = async () => {
    if (!timer || !call) return;
    const prevIdx = Math.max(0, timer.segment_index - 1);
    if (prevIdx === timer.segment_index) return;
    chimed.current = -1;
    await updateTimer({ segment_index: prevIdx, segment_started_at: new Date().toISOString(), paused_at: null, paused_elapsed_s: 0, extra_s: 0, running: true });
  };
  const finish = async () => {
    if (!call || finalizing) return;
    setFinalizing(true);
    // Flush any pending textarea (recap notes save on blur) before we upload.
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
    const now = new Date().toISOString();
    const actual = call.started_at ? Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000) : 0;
    const { data: ratings } = await (supabase as any).from('client_weekly_call_ratings').select('rating').eq('call_id', call.id);
    const avg = (ratings && ratings.length) ? (ratings.reduce((a: number, r: any) => a + r.rating, 0) / ratings.length) : null;
    await updateTimer({ finished: true, running: false });
    const recordingUrl = await stopAndUploadRecording(call.id);
    await updateCall({
      ended_at: now,
      actual_duration_s: actual,
      status: 'completed',
      avg_rating: avg as any,
      ...(recordingUrl ? { recording_url: recordingUrl, finalize_status: 'pending' } as any : {}),
    });
    toast.success('Call wrapped — transcribing in the background');
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 2600);
    if (recordingUrl) {
      supabase.functions.invoke('weekly-call-finalize', { body: { call_id: call.id } })
        .then((res) => {
          if (res.error) toast.error('Transcription failed');
        })
        .catch(() => {});
    }
    setFinalizing(false);
    onFinish?.();
  };

  const cancel = async () => {
    if (!call || cancelling) return;
    if (!window.confirm('Cancel this call? Recording will be discarded and no transcript or tasks will be generated.')) return;
    setCancelling(true);
    try {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch {} }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      chunksRef.current = [];
      setIsRecording(false);
      await updateTimer({ finished: true, running: false });
      await updateCall({
        ended_at: new Date().toISOString(),
        status: 'cancelled',
        finalize_status: 'cancelled',
      } as any);
      toast.success('Call cancelled — no transcript generated');
      onFinish?.();
    } finally {
      setCancelling(false);
    }
  };

  if (loading || !call || !timer) {
    return <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground">Loading weekly call…</div>;
  }

  // Hard-lock: no overtime on the last (recap) segment.
  const rawRemaining = timing.remaining;
  const displayRemaining = isLastSegment ? Math.max(0, rawRemaining) : rawRemaining;
  const pct = timing.planned > 0 ? displayRemaining / timing.planned : 0;
  const timerColor = displayRemaining < 0 ? 'text-destructive' : pct <= 0.2 ? 'text-amber-500' : 'text-foreground';
  const seg = timing.seg;

  const body = (() => {
    if (!seg) return null;
    switch (seg.key) {
      case 'wins':      return <WinsSegment callId={call.id} clientId={clientId} />;
      case 'scorecard': return <ScorecardSegment callId={call.id} clientId={clientId} call={call} />;
      case 'creative':  return <CreativeReviewSegment callId={call.id} clientId={clientId} call={call} />;
      case 'tasks':     return <TasksSegment callId={call.id} clientId={clientId} call={call} />;
      case 'recap':     return <RecapSegment callId={call.id} clientId={clientId} />;
      default: return null;
    }
  })();

  return (
    <div className="flex flex-col">
      {celebrate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm pointer-events-none animate-fade-in">
          <div className="animate-scale-in text-center space-y-3">
            <PartyPopper className="w-24 h-24 mx-auto text-primary animate-bounce" />
            <div className="text-3xl font-bold">Call complete!</div>
            <div className="text-sm text-muted-foreground">Transcribing & drafting tasks…</div>
          </div>
        </div>
      )}
      <header className="border-b py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-xs text-muted-foreground">Segment</div>
          <div className="text-lg font-semibold truncate">{seg?.name}</div>
          {isRecording && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <Circle className="w-2 h-2 fill-current animate-pulse" /> REC
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {agenda.map((_, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${i < timing.idx ? 'bg-primary' : i === timing.idx ? 'bg-primary ring-2 ring-primary/30' : 'bg-muted'}`} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">Overall</div>
          <div className="text-lg font-mono tabular-nums">{fmt(meetingElapsed)}</div>
          <WeeklyCallSettingsDrawer agenda={agenda} onSave={updateAgenda} />
        </div>
      </header>

      <div className="flex flex-col items-center justify-center py-4 gap-1">
        <div className={`font-mono tabular-nums text-6xl md:text-7xl font-bold ${timerColor}`}>{fmt(displayRemaining)}</div>
        {displayRemaining < 0 && !isLastSegment && <div className="text-destructive text-xs uppercase tracking-widest">Overtime</div>}
        {isLastSegment && <div className="text-muted-foreground text-xs uppercase tracking-widest">Final segment — no overtime</div>}
      </div>

      <main className="pb-6 min-h-[300px]">{body}</main>

      <footer className="sticky bottom-0 z-10 border-t py-3 flex items-center gap-2 flex-wrap justify-center bg-card/95 backdrop-blur">
        {!timer.running && !call.started_at && (
          <Button onClick={start}><Play className="w-4 h-4 mr-2" />Start Call</Button>
        )}
        {!timer.running && call.started_at && !timer.finished && (
          <Button onClick={resume}><Play className="w-4 h-4 mr-2" />Resume</Button>
        )}
        {timer.running && (
          <Button variant="secondary" onClick={pause}><Pause className="w-4 h-4 mr-2" />Pause</Button>
        )}
        <Button variant="outline" onClick={bump30} disabled={isLastSegment}><Plus className="w-4 h-4 mr-2" />30s</Button>
        <Button variant="outline" onClick={back} disabled={timing.idx === 0}><ChevronLeft className="w-4 h-4 mr-2" />Back</Button>
        <Button variant="outline" onClick={next}><SkipForward className="w-4 h-4 mr-2" />Skip</Button>
        {timing.idx < agenda.length - 1 && (
          <Button onClick={next}>Next<ChevronRight className="w-4 h-4 ml-2" /></Button>
        )}
        <div className="flex items-center gap-2 ml-2">
          <Switch checked={timer.auto_advance} onCheckedChange={(v) => updateTimer({ auto_advance: v })} />
          <span className="text-xs text-muted-foreground">Auto-advance</span>
        </div>
        <StatusIndicators
          isRecording={isRecording}
          uploading={uploading}
          finalizeStatus={(call as any)?.finalize_status ?? null}
        />
        {call.started_at && !timer.finished && (
          <>
            <Button variant="ghost" onClick={cancel} className="ml-2 text-destructive hover:text-destructive" disabled={finalizing || cancelling}>
              <X className="w-4 h-4 mr-2" />Cancel call
            </Button>
            <Button variant="default" onClick={finish} disabled={finalizing || cancelling}>
              {finalizing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PartyPopper className="w-4 h-4 mr-2" />}
              Finish call
            </Button>
          </>
        )}
      </footer>
    </div>
  );
}