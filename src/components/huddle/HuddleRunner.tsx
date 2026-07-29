import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Play, Pause, SkipForward, Plus, ChevronRight, ChevronLeft, PartyPopper, Loader2, Upload, CheckCircle2, AlertCircle, X, RotateCcw, Volume2 } from 'lucide-react';
import { useTodayHuddle, useSegmentTiming } from '@/hooks/useHuddle';
import { useHuddleClients } from '@/hooks/useHuddleClients';
import { HuddleAgendaRail } from './HuddleAgendaRail';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { HuddleSettingsDrawer } from './HuddleSettingsDrawer';
import { WinsSegment } from './segments/WinsSegment';
import { AccountabilitySegment } from './segments/AccountabilitySegment';
import { ClientWalkthroughSegment } from './segments/ClientWalkthroughSegment';
import { CloseSegment } from './segments/CloseSegment';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { captureMicPlusSystemAudio, requestTabAudioStream } from '@/lib/huddle/captureAudio';
import { AddCallAudioDialog } from '@/components/shared/AddCallAudioDialog';

function fmt(s: number) {
  const neg = s < 0;
  const abs = Math.abs(Math.floor(s));
  const m = Math.floor(abs / 60);
  const sec = abs % 60;
  return `${neg ? '-' : ''}${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

// Simple beep using WebAudio — no asset needed
function playChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.42);
  } catch {}
}

export function HuddleRunner({ onFinish }: { onFinish?: () => void }) {
  const { huddle, agenda, loading, updateTimer, updateHuddle, updateAgenda } = useTodayHuddle();
  const { clients } = useHuddleClients();
  const { currentMember } = useTeamMember();
  const chimed = useRef<number>(-1);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const captureStopRef = useRef<(() => void) | null>(null);
  const recordingMimeTypeRef = useRef('audio/webm');
  const [isRecording, setIsRecording] = useState(false);
  const [systemAudioOn, setSystemAudioOn] = useState(false);
  const [audioGuideOpen, setAudioGuideOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const autoFinishedRef = useRef(false);

  const timer = huddle?.timer_state;
  const timing = useSegmentTiming(agenda, timer || { segment_index: 0, segment_started_at: null, paused_at: null, paused_elapsed_s: 0, auto_advance: false, running: false, finished: false, extra_s: 0 });

  const isFacilitator = !!currentMember && !!huddle?.facilitator_id && currentMember.id === huddle.facilitator_id;

  // Reset chime guard whenever the current segment changes (covers viewers who
  // didn't call next() locally but received the change via Realtime)
  useEffect(() => {
    chimed.current = -1;
  }, [timer?.segment_index, timer?.segment_started_at]);

  const meetingElapsed = useMemo(() => {
    if (!huddle?.started_at) return 0;
    const started = new Date(huddle.started_at).getTime();
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  }, [huddle?.started_at, timing.elapsed]);

  // Per-client count-up: resets when sub_index changes inside the clients
  // segment. Ticks locally every 500ms so operators see live seconds.
  const [clientStart, setClientStart] = useState<number>(() => Date.now());
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => { setClientStart(Date.now()); }, [timer?.sub_index, timer?.segment_index, huddle?.id]);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const clientElapsed = Math.max(0, Math.floor((nowTick - clientStart) / 1000));

  // Chime + auto-advance on segment end. Only the facilitator auto-advances so
  // multiple viewers don't race to write the next segment.
  useEffect(() => {
    if (!timer || !timer.running) return;
    if (timing.remaining <= 0 && chimed.current !== timing.idx) {
      chimed.current = timing.idx;
      playChime();
      if (timer.auto_advance && isFacilitator) next();
    }
  }, [timing.remaining, timer?.running, isFacilitator]);

  // Hard cap: 2 hours then auto-finish (nothing runs forever)
  const HARD_CAP_S = 7200;
  useEffect(() => {
    if (!huddle?.started_at || timer?.finished || autoFinishedRef.current) return;
    if (meetingElapsed >= HARD_CAP_S) {
      autoFinishedRef.current = true;
      toast.message('2-hour cap reached — wrapping huddle');
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingElapsed, timer?.finished, huddle?.started_at]);

  const startRecording = async () => {
    try {
      // Default to mic-only for reliability. Some browsers/OS combos hang on
      // getDisplayMedia and silently drop the whole recording — start fast with
      // the mic and offer "Add system audio" from the header controls.
      const capture = await captureMicPlusSystemAudio({ requestSystem: false });
      streamRef.current = capture.stream;
      captureStopRef.current = capture.stop;
      chunksRef.current = [];
      const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const rec = preferredMime ? new MediaRecorder(capture.stream, { mimeType: preferredMime }) : new MediaRecorder(capture.stream);
      recordingMimeTypeRef.current = rec.mimeType || preferredMime || 'audio/webm';
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onerror = (e) => console.error('MediaRecorder error', e);
      rec.start(1000); // flush every 1s so late-cancel doesn't lose the tail
      mediaRecorderRef.current = rec;
      setIsRecording(true);
      toast.success('Recording started (mic). Use "Add system audio" to include call participants.', { duration: 6000 });
      return true;
    } catch (e: any) {
      console.error('mic denied:', e);
      const msg = String(e?.name || e?.message || '');
      const hint = msg.includes('NotAllowed')
        ? 'Grant microphone permission in your browser, then click Start again.'
        : msg.includes('NotFound')
        ? 'No microphone found on this device.'
        : 'Microphone unavailable — check browser mic permissions.';
      toast.error(`Recording failed: ${hint}`, { duration: 8000 });
      return false;
    }
  };

  // Opt-in: mix in system/tab audio (Zoom/Meet participants) after recording
  // has already started with a reliable mic-only stream.
  const addSystemAudio = async () => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === 'inactive') { throw new Error('Start recording first'); }
    const display = await requestTabAudioStream();
    try {
      // Mix into a new destination and swap the MediaRecorder source.
      const AudioCtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const dest = ctx.createMediaStreamDestination();
      if (streamRef.current) ctx.createMediaStreamSource(streamRef.current).connect(dest);
      ctx.createMediaStreamSource(display).connect(dest);
      // We can't swap tracks on an active MediaRecorder — restart with the
      // combined stream, preserving accumulated chunks.
      const preservedChunks = chunksRef.current.slice();
      try { rec.requestData(); rec.stop(); } catch {}
      await new Promise((r) => setTimeout(r, 250));
      chunksRef.current = preservedChunks;
      const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type));
      const next = preferredMime ? new MediaRecorder(dest.stream, { mimeType: preferredMime }) : new MediaRecorder(dest.stream);
      next.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      next.start(1000);
      mediaRecorderRef.current = next;
      const prevStop = captureStopRef.current;
      captureStopRef.current = () => {
        try { prevStop?.(); } catch {}
        try { display.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
        try { ctx.close(); } catch {}
      };
      streamRef.current = dest.stream;
      setSystemAudioOn(true);
      toast.success('Call audio added — mic + participants are now recorded');
    } catch (e: any) {
      try { display.getTracks().forEach((t: MediaStreamTrack) => t.stop()); } catch {}
      console.warn('addSystemAudio failed', e);
      throw new Error(e?.message || 'Could not mix in the shared audio.');
    }
  };

  const stopAndUploadRecording = async (huddleId: string): Promise<string | null> => {
    const rec = mediaRecorderRef.current;
    if (!rec) return null;
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const upload = async () => {
        if (settled) return;
        settled = true;
        try {
          try { captureStopRef.current?.(); } catch {}
          captureStopRef.current = null;
          streamRef.current?.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          const contentType = recordingMimeTypeRef.current || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: contentType });
          chunksRef.current = [];
          setIsRecording(false);
          if (blob.size < 1024) {
            toast.error('Recording was empty — transcript was not generated.');
            resolve(null);
            return;
          }
          const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('wav') ? 'wav' : 'webm';
          const path = `huddles/${huddleId}-${Date.now()}.${ext}`;
          setUploading(true);
          const { error: upErr } = await supabase.storage.from('weekly-call-recordings').upload(path, blob, {
            contentType, upsert: true,
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
      rec.onstop = upload;
      if (rec.state === 'inactive') upload();
      else {
        try { rec.requestData(); } catch {}
        rec.stop();
      }
    });
  };

  const start = async () => {
    if (!huddle) return;
    const now = new Date().toISOString();
    if (!huddle.started_at) {
      const ok = await startRecording();
      if (!ok) {
        const proceed = window.confirm(
          'Microphone was denied. Start the huddle anyway without a recording? (No transcript / summary / action items will be generated.)'
        );
        if (!proceed) return;
      }
      await updateHuddle({
        started_at: now,
        status: 'in_progress',
        // First presser becomes the facilitator (writer of auto-advance)
        ...(huddle.facilitator_id ? {} : { facilitator_id: currentMember?.id ?? null }),
      } as any);
    }
    await updateTimer({
      running: true,
      segment_started_at: timer?.segment_started_at || now,
      paused_at: null,
      paused_elapsed_s: timer?.paused_elapsed_s || 0,
    });
  };

  const pause = async () => {
    if (!timer?.running) return;
    await updateTimer({ running: false, paused_at: new Date().toISOString() });
  };

  const resume = async () => {
    if (!timer || timer.running) return;
    let pausedElapsed = timer.paused_elapsed_s || 0;
    if (timer.paused_at && timer.segment_started_at) {
      pausedElapsed += Math.floor((Date.now() - new Date(timer.paused_at).getTime()) / 1000);
    }
    await updateTimer({ running: true, paused_at: null, paused_elapsed_s: pausedElapsed });
  };

  const bump30 = async () => {
    if (!timer) return;
    await updateTimer({ extra_s: (timer.extra_s || 0) + 30 });
  };

  const next = async () => {
    if (!timer || !huddle) return;
    const nextIdx = timer.segment_index + 1;
    if (nextIdx >= agenda.length) {
      await finish();
      return;
    }
    chimed.current = -1;
    await updateTimer({
      segment_index: nextIdx,
      segment_started_at: new Date().toISOString(),
      paused_at: null,
      paused_elapsed_s: 0,
      extra_s: 0,
      running: true,
      sub_index: 0,
    });
  };

  const back = async () => {
    if (!timer || !huddle) return;
    const prevIdx = Math.max(0, timer.segment_index - 1);
    if (prevIdx === timer.segment_index) return;
    chimed.current = -1;
    await updateTimer({
      segment_index: prevIdx,
      segment_started_at: new Date().toISOString(),
      paused_at: null,
      paused_elapsed_s: 0,
      extra_s: 0,
      running: true,
      sub_index: 0,
    });
  };

  // When the operator is inside Client Walkthrough, the footer Next/Skip
  // buttons step client-by-client instead of jumping to the next segment.
  // Falls through to segment `next()` on the last client (or when we're not
  // in the clients segment).
  const walkthroughAdvance = async (status: 'reviewed' | 'skipped') => {
    if (seg?.key === 'clients') {
      const idx = timer?.sub_index ?? 0;
      const current = clients[idx];
      if (current && huddle) {
        try {
          await (supabase as any)
            .from('huddle_client_reviews')
            .upsert(
              { huddle_id: huddle.id, client_id: current.id, position: idx, status },
              { onConflict: 'huddle_id,client_id' },
            );
        } catch (e) {
          console.warn('walkthrough upsert failed', e);
        }
      }
      if (idx + 1 < clients.length) {
        await updateTimer({ sub_index: idx + 1 });
        return;
      }
    }
    await next();
  };

  const finish = async () => {
    if (!huddle || finalizing) return;
    setFinalizing(true);
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
    const now = new Date().toISOString();
    const actual = huddle.started_at ? Math.floor((Date.now() - new Date(huddle.started_at).getTime()) / 1000) : 0;
    const { data: ratings } = await supabase.from('huddle_ratings').select('rating').eq('huddle_id', huddle.id);
    const avg = (ratings && ratings.length) ? (ratings.reduce((a, r: any) => a + r.rating, 0) / ratings.length) : null;
    await updateTimer({ finished: true, running: false });
    const recordingUrl = await stopAndUploadRecording(huddle.id);
    await updateHuddle({
      ended_at: now,
      actual_duration_s: actual,
      status: 'completed',
      avg_rating: avg as any,
      finalize_status: 'pending',
      ...(recordingUrl ? { recording_url: recordingUrl } as any : {}),
    } as any);
    toast.success(recordingUrl ? 'Huddle wrapped — transcribing in the background' : 'Huddle wrapped — summarizing notes; no usable recording captured');
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 2600);
    supabase.functions.invoke('huddle-finalize', { body: { huddle_id: huddle.id } }).then((res) => {
      if (res.error) toast.error('Summary failed — use Retry from history.');
    }).catch((err) => {
      console.error('Finalize trigger failed:', err);
      toast.error('Failed to trigger background summary. Please contact support.');
    });
    setFinalizing(false);
    onFinish?.();
  };

  const cancel = async () => {
    if (!huddle) return;
    if (!window.confirm('Cancel this huddle? Recording will be discarded.')) return;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch {} }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
    await updateTimer({ finished: true, running: false });
    await updateHuddle({ ended_at: new Date().toISOString(), status: 'cancelled', finalize_status: 'cancelled' } as any);
    toast.success('Huddle cancelled');
    onFinish?.();
  };

  // Full restart: hard-delete this huddle and all its history so it can be
  // re-run from scratch. Guarantees no zombie runs and no stale transcript
  // or attendance data linger.
  const restart = async () => {
    if (!huddle) return;
    if (!window.confirm('Restart this huddle? All attendance, ratings, commitments, wins, client reviews, recording and transcript for today will be permanently deleted.')) return;
    try {
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch {} }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      chunksRef.current = [];
      setIsRecording(false);
      const id = huddle.id;
      // Best-effort cleanup of child rows in case FK cascade isn't configured.
      const childTables = [
        'huddle_attendance', 'huddle_ratings', 'huddle_wins',
        'huddle_commitments', 'huddle_client_reviews', 'huddle_blockers', 'huddle_flags',
      ];
      await Promise.allSettled(
        childTables.map((t) => (supabase as any).from(t).delete().eq('huddle_id', id))
      );
      await (supabase as any).from('huddles').delete().eq('id', id);
      toast.success('Huddle restarted');
      window.location.reload();
    } catch (e: any) {
      console.error('restart failed', e);
      toast.error(e?.message || 'Restart failed');
    }
  };

  if (loading || !huddle || !timer) {
    return <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground">Loading huddle…</div>;
  }

  const pct = timing.planned > 0 ? timing.remaining / timing.planned : 0;
  const timerColor = timing.remaining < 0 ? 'text-destructive' : pct <= 0.2 ? 'text-amber-500' : 'text-foreground';

  const seg = timing.seg;
  const inClients = seg?.key === 'clients';
  const bigDisplay = inClients ? clientElapsed : Math.max(0, timing.remaining);
  const bigColor = inClients ? 'text-foreground' : timerColor;
  const finalizeStatus = (huddle as any)?.finalize_status ?? null;
  const body = (() => {
    if (!seg) return null;
    switch (seg.key) {
      case 'wins': return <WinsSegment huddleId={huddle.id} />;
      case 'accountability': return <AccountabilitySegment huddleId={huddle.id} />;
      case 'clients':
        return (
          <ClientWalkthroughSegment
            huddleId={huddle.id}
            subIndex={timer.sub_index ?? 0}
            onSubIndexChange={(idx) => updateTimer({ sub_index: idx })}
            onAdvanceSegment={next}
          />
        );
      case 'close': return <CloseSegment huddle={huddle} agenda={agenda} />;
      default:
        return (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border rounded-lg border-dashed">
            <AlertCircle className="w-10 h-10 mb-2 opacity-20" />
            <p>Segment "{seg.key}" has no runner implementation.</p>
            <Button variant="link" onClick={next}>Skip to next</Button>
          </div>
        );
    }
  })();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {celebrate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm pointer-events-none animate-fade-in">
          <div className="animate-scale-in text-center space-y-3">
            <PartyPopper className="w-24 h-24 mx-auto text-primary animate-bounce" />
            <div className="text-3xl font-bold">Huddle complete!</div>
            <div className="text-sm text-muted-foreground">Transcribing & summarizing…</div>
          </div>
        </div>
      )}
      <header className="border-b px-4 md:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-xs md:text-sm text-muted-foreground">Segment</div>
          <div className="text-lg md:text-xl font-semibold truncate">{seg?.name}</div>
          {(isRecording || uploading || finalizeStatus) && (
            <div className="flex items-center gap-2 ml-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${isRecording ? 'bg-primary animate-pulse' : 'bg-muted-foreground/30'}`}
                title={isRecording ? 'Recording' : 'Recording inactive'}
              />
              {isRecording && (
                <Button
                  size="sm"
                  variant={systemAudioOn ? 'secondary' : 'outline'}
                  className="h-6 text-[11px] px-2"
                  onClick={() => setAudioGuideOpen(true)}
                  disabled={systemAudioOn}
                >
                  {systemAudioOn ? 'Call audio on' : '+ Call audio'}
                </Button>
              )}
              {uploading && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-amber-500">
                  <Upload className="w-3 h-3" /> Uploading
                </span>
              )}
              {(finalizeStatus === 'pending' || finalizeStatus === 'processing') && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-blue-500">
                  <Loader2 className="w-3 h-3 animate-spin" /> Transcribing
                </span>
              )}
              {finalizeStatus === 'done' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-emerald-500">
                  <CheckCircle2 className="w-3 h-3" /> Summary ready
                </span>
              )}
              {finalizeStatus === 'error' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-destructive">
                  <AlertCircle className="w-3 h-3" /> Transcript failed
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {agenda.map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i < timing.idx ? 'bg-primary' : i === timing.idx ? 'bg-primary ring-2 ring-primary/30' : 'bg-muted'}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground">Overall</div>
          <div className="text-lg md:text-xl font-mono tabular-nums">{fmt(meetingElapsed)}</div>
          <HuddleSettingsDrawer agenda={agenda} onSave={updateAgenda} />
        </div>
      </header>

      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <div className={`font-mono tabular-nums text-7xl md:text-8xl lg:text-9xl font-bold ${bigColor}`}>
          {fmt(bigDisplay)}
        </div>
        <div className="text-xs font-mono tabular-nums text-muted-foreground">
          Total {fmt(meetingElapsed)}{!inClients && timing.remaining < 0 ? ' · Overtime' : ''}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <main className="flex-1 overflow-y-auto px-4 md:px-8 pb-32">
          {body}
        </main>
        <aside className="hidden xl:block w-80 border-l bg-muted/5 p-6 overflow-y-auto">
          <HuddleAgendaRail 
            agenda={agenda} 
            currentSegmentIdx={timing.idx} 
            clients={clients}
            currentClientIdx={timer.sub_index}
            huddleId={huddle.id}
          />
        </aside>
      </div>

      <footer className="fixed bottom-0 inset-x-0 z-40 border-t px-4 md:px-8 py-5 flex items-center gap-3 flex-wrap justify-center bg-card/95 backdrop-blur shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.15)]">
        {!timer.running && !huddle.started_at && (
          <Button size="lg" className="h-12 px-6 text-base" onClick={start}><Play className="w-5 h-5 mr-2" />Start Huddle</Button>
        )}
        {!timer.running && huddle.started_at && !timer.finished && (
          <Button size="lg" className="h-12 px-6 text-base" onClick={resume}><Play className="w-5 h-5 mr-2" />Resume</Button>
        )}
        {timer.running && (
          <Button size="lg" variant="secondary" className="h-12 px-6 text-base" onClick={pause}><Pause className="w-5 h-5 mr-2" />Pause</Button>
        )}
        <Button size="lg" variant="outline" className="h-12 px-5 text-base" onClick={bump30}><Plus className="w-5 h-5 mr-2" />30s</Button>
        {isRecording && (
          <Button
            size="lg"
            variant={systemAudioOn ? 'secondary' : 'outline'}
            className="h-12 px-5 text-base"
            onClick={() => setAudioGuideOpen(true)}
            disabled={systemAudioOn}
          >
            <Volume2 className="w-5 h-5 mr-2" />{systemAudioOn ? 'Call audio on' : 'Add call audio'}
          </Button>
        )}
        <Button size="lg" variant="outline" className="h-12 px-5 text-base" onClick={back} disabled={timing.idx === 0}>
          <ChevronLeft className="w-5 h-5 mr-2" />Back
        </Button>
        <Button size="lg" variant="outline" className="h-12 px-5 text-base" onClick={() => walkthroughAdvance('skipped')}>
          <SkipForward className="w-5 h-5 mr-2" />
          {seg?.key === 'clients' && (timer.sub_index ?? 0) + 1 < clients.length ? 'Skip client' : 'Skip'}
        </Button>
        <Button size="lg" className="h-12 px-6 text-base" onClick={() => walkthroughAdvance('reviewed')}>
          {seg?.key === 'clients' && (timer.sub_index ?? 0) + 1 < clients.length ? 'Next client' : 'Next'}
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
        <div className="flex items-center gap-2 ml-2">
          <Switch checked={timer.auto_advance} onCheckedChange={(v) => updateTimer({ auto_advance: v })} />
          <span className="text-sm text-muted-foreground">Auto-advance</span>
        </div>
        {huddle.started_at && !timer.finished && (
          <>
            <Button size="lg" variant="ghost" onClick={cancel} className="h-12 px-4 text-base text-destructive hover:text-destructive" disabled={finalizing}>
              <X className="w-5 h-5 mr-2" />Cancel
            </Button>
            <Button size="lg" variant="default" onClick={finish} className="h-12 px-6 text-base ml-2" disabled={finalizing}>
              {finalizing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <PartyPopper className="w-5 h-5 mr-2" />}
              Finish
            </Button>
          </>
        )}
        <Button size="lg" variant="ghost" onClick={restart} className="h-12 px-4 text-base text-muted-foreground hover:text-foreground" disabled={finalizing} title="Delete this huddle and start over">
          <RotateCcw className="w-5 h-5 mr-2" />Restart
        </Button>
      </footer>
      <AddCallAudioDialog open={audioGuideOpen} onOpenChange={setAudioGuideOpen} onRequest={addSystemAudio} />
    </div>
  );
}