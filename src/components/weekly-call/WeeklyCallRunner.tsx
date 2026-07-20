import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Play, Pause, SkipForward, Plus, ChevronRight, ChevronLeft, PartyPopper, Circle, Loader2 } from 'lucide-react';
import { useThisWeekCall } from '@/hooks/useThisWeekCall';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { useSegmentTiming } from '@/hooks/useHuddle';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  WinsSegment, ScorecardSegment, CreativeReviewSegment, TasksSegment,
} from './WeeklyCallSegments';
import { WeeklyCallSettingsDrawer } from './WeeklyCallSettingsDrawer';

function fmt(s: number) {
  const neg = s < 0;
  const abs = Math.abs(Math.floor(s));
  const m = Math.floor(abs / 60);
  const sec = abs % 60;
  return `${neg ? '-' : ''}${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
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
  const autoFinishedRef = useRef(false);

  const timer = call?.timer_state;
  const timing = useSegmentTiming(
    agenda,
    timer || { segment_index: 0, segment_started_at: null, paused_at: null, paused_elapsed_s: 0, auto_advance: false, running: false, finished: false, extra_s: 0 }
  );
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
          const { error: upErr } = await supabase.storage.from('weekly-call-recordings').upload(path, blob, {
            contentType: 'audio/webm', upsert: true,
          });
          if (upErr) { console.warn('upload failed:', upErr); resolve(null); return; }
          const { data } = supabase.storage.from('weekly-call-recordings').getPublicUrl(path);
          resolve(data.publicUrl);
        } catch (e) {
          console.warn('stop/upload failed:', e);
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
  const bump30 = async () => { if (timer) await updateTimer({ extra_s: (timer.extra_s || 0) + 30 }); };
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

  if (loading || !call || !timer) {
    return <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground">Loading weekly call…</div>;
  }

  const pct = timing.planned > 0 ? timing.remaining / timing.planned : 0;
  const timerColor = timing.remaining < 0 ? 'text-destructive' : pct <= 0.2 ? 'text-amber-500' : 'text-foreground';
  const seg = timing.seg;

  const body = (() => {
    if (!seg) return null;
    switch (seg.key) {
      case 'wins':      return <WinsSegment callId={call.id} clientId={clientId} />;
      case 'scorecard': return <ScorecardSegment callId={call.id} clientId={clientId} call={call} />;
      case 'creative':  return <CreativeReviewSegment callId={call.id} clientId={clientId} call={call} />;
      case 'tasks':     return <TasksSegment callId={call.id} clientId={clientId} call={call} />;
      default: return null;
    }
  })();

  return (
    <div className="flex flex-col">
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
        <div className={`font-mono tabular-nums text-6xl md:text-7xl font-bold ${timerColor}`}>{fmt(timing.remaining)}</div>
        {timing.remaining < 0 && <div className="text-destructive text-xs uppercase tracking-widest">Overtime</div>}
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
        <Button variant="outline" onClick={bump30}><Plus className="w-4 h-4 mr-2" />30s</Button>
        <Button variant="outline" onClick={back} disabled={timing.idx === 0}><ChevronLeft className="w-4 h-4 mr-2" />Back</Button>
        <Button variant="outline" onClick={next}><SkipForward className="w-4 h-4 mr-2" />Skip</Button>
        {timing.idx < agenda.length - 1 && (
          <Button onClick={next}>Next<ChevronRight className="w-4 h-4 ml-2" /></Button>
        )}
        <div className="flex items-center gap-2 ml-2">
          <Switch checked={timer.auto_advance} onCheckedChange={(v) => updateTimer({ auto_advance: v })} />
          <span className="text-xs text-muted-foreground">Auto-advance</span>
        </div>
        {call.started_at && !timer.finished && (
          <Button variant="default" onClick={finish} className="ml-2" disabled={finalizing}>
            {finalizing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PartyPopper className="w-4 h-4 mr-2" />}
            Finish call
          </Button>
        )}
      </footer>
    </div>
  );
}