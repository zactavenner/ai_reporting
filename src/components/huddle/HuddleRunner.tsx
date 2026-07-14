import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Play, Pause, SkipForward, Plus, ChevronRight, Flag, PartyPopper } from 'lucide-react';
import { useTodayHuddle, useSegmentTiming } from '@/hooks/useHuddle';
import { HuddleSettingsDrawer } from './HuddleSettingsDrawer';
import { WinsSegment } from './segments/WinsSegment';
import { NumbersSegment } from './segments/NumbersSegment';
import { ClientHealthSegment } from './segments/ClientHealthSegment';
import { AccountabilitySegment } from './segments/AccountabilitySegment';
import { BlockersSegment } from './segments/BlockersSegment';
import { CloseSegment } from './segments/CloseSegment';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  const chimed = useRef<number>(-1);

  const timer = huddle?.timer_state;
  const timing = useSegmentTiming(agenda, timer || { segment_index: 0, segment_started_at: null, paused_at: null, paused_elapsed_s: 0, auto_advance: false, running: false, finished: false, extra_s: 0 });

  const meetingElapsed = useMemo(() => {
    if (!huddle?.started_at) return 0;
    const started = new Date(huddle.started_at).getTime();
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  }, [huddle?.started_at, timing.elapsed]);

  // Chime + auto-advance on segment end
  useEffect(() => {
    if (!timer || !timer.running) return;
    if (timing.remaining <= 0 && chimed.current !== timing.idx) {
      chimed.current = timing.idx;
      playChime();
      if (timer.auto_advance) next();
    }
  }, [timing.remaining, timer?.running]);

  const start = async () => {
    if (!huddle) return;
    const now = new Date().toISOString();
    if (!huddle.started_at) await updateHuddle({ started_at: now, status: 'in_progress' });
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
    });
  };

  const finish = async () => {
    if (!huddle) return;
    const now = new Date().toISOString();
    const actual = huddle.started_at ? Math.floor((Date.now() - new Date(huddle.started_at).getTime()) / 1000) : 0;
    const { data: ratings } = await supabase.from('huddle_ratings').select('rating').eq('huddle_id', huddle.id);
    const avg = (ratings && ratings.length) ? (ratings.reduce((a, r: any) => a + r.rating, 0) / ratings.length) : null;
    await updateTimer({ finished: true, running: false });
    await updateHuddle({ ended_at: now, actual_duration_s: actual, status: 'completed', avg_rating: avg as any });
    toast.success('Huddle wrapped');
    onFinish?.();
  };

  if (loading || !huddle || !timer) {
    return <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground">Loading huddle…</div>;
  }

  const pct = timing.planned > 0 ? timing.remaining / timing.planned : 0;
  const timerColor = timing.remaining < 0 ? 'text-destructive' : pct <= 0.2 ? 'text-amber-500' : 'text-foreground';

  const seg = timing.seg;
  const body = (() => {
    if (!seg) return null;
    switch (seg.key) {
      case 'wins': return <WinsSegment huddleId={huddle.id} />;
      case 'numbers': return <NumbersSegment huddleId={huddle.id} />;
      case 'health': return <ClientHealthSegment huddleId={huddle.id} />;
      case 'accountability': return <AccountabilitySegment huddleId={huddle.id} />;
      case 'blockers': return <BlockersSegment huddleId={huddle.id} />;
      case 'close': return <CloseSegment huddle={huddle} agenda={agenda} />;
      default: return null;
    }
  })();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 md:px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-xs md:text-sm text-muted-foreground">Segment</div>
          <div className="text-lg md:text-xl font-semibold truncate">{seg?.name}</div>
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
        <div className={`font-mono tabular-nums text-7xl md:text-8xl lg:text-9xl font-bold ${timerColor}`}>
          {fmt(timing.remaining)}
        </div>
        {timing.remaining < 0 && <div className="text-destructive text-sm uppercase tracking-widest">Overtime</div>}
      </div>

      <main className="flex-1 px-4 md:px-8 pb-4">
        {body}
      </main>

      <footer className="border-t px-4 md:px-8 py-3 flex items-center gap-2 flex-wrap justify-center bg-card">
        {!timer.running && !huddle.started_at && (
          <Button size="lg" onClick={start}><Play className="w-4 h-4 mr-1" />Start Huddle</Button>
        )}
        {!timer.running && huddle.started_at && !timer.finished && (
          <Button size="lg" onClick={resume}><Play className="w-4 h-4 mr-1" />Resume</Button>
        )}
        {timer.running && (
          <Button size="lg" variant="secondary" onClick={pause}><Pause className="w-4 h-4 mr-1" />Pause</Button>
        )}
        <Button variant="outline" onClick={bump30}><Plus className="w-4 h-4 mr-1" />30s</Button>
        <Button variant="outline" onClick={next}><SkipForward className="w-4 h-4 mr-1" />Skip</Button>
        <Button onClick={next}>Next <ChevronRight className="w-4 h-4 ml-1" /></Button>
        <div className="flex items-center gap-2 ml-2">
          <Switch checked={timer.auto_advance} onCheckedChange={(v) => updateTimer({ auto_advance: v })} />
          <span className="text-xs text-muted-foreground">Auto-advance</span>
        </div>
        {timing.idx >= agenda.length - 1 && (
          <Button variant="default" onClick={finish} className="ml-2">
            <PartyPopper className="w-4 h-4 mr-1" />Finish
          </Button>
        )}
      </footer>
    </div>
  );
}