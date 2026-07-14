import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { DEFAULT_AGENDA, DEFAULT_TIMER, type AgendaSegment, type TimerState } from '@/lib/huddle/types';

function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface HuddleRecord {
  id: string;
  date: string;
  started_at: string | null;
  ended_at: string | null;
  planned_duration_s: number;
  actual_duration_s: number | null;
  facilitator_id: string | null;
  summary_text: string | null;
  avg_rating: number | null;
  agenda: AgendaSegment[];
  timer_state: TimerState;
  status: string;
}

export function useTodayHuddle() {
  const { currentMember } = useTeamMember();
  const [huddle, setHuddle] = useState<HuddleRecord | null>(null);
  const [agenda, setAgenda] = useState<AgendaSegment[]>(DEFAULT_AGENDA);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Load or create today's huddle
      const { data: settings } = await supabase.from('huddle_settings').select('agenda').eq('singleton', true).maybeSingle();
      const settingsAgenda = (settings?.agenda as unknown as AgendaSegment[]) || DEFAULT_AGENDA;
      const planned = settingsAgenda.reduce((a, s) => a + s.duration_s, 0);

      const { data: existing } = await supabase
        .from('huddles')
        .select('*')
        .eq('date', today())
        .maybeSingle();

      let record = existing as unknown as HuddleRecord | null;
      if (!record) {
        const { data: created } = await supabase
          .from('huddles')
          .insert({
            date: today(),
            planned_duration_s: planned,
            agenda: settingsAgenda as any,
            timer_state: DEFAULT_TIMER as any,
          })
          .select('*')
          .single();
        record = created as unknown as HuddleRecord;
      }

      if (cancelled) return;
      setAgenda((record?.agenda as unknown as AgendaSegment[]) || settingsAgenda);
      setHuddle(record);
      setLoading(false);

      // Attendance
      if (record && currentMember) {
        await supabase
          .from('huddle_attendance')
          .upsert(
            {
              huddle_id: record.id,
              member_id: currentMember.id,
              member_name: currentMember.name,
              joined_at: new Date().toISOString(),
            },
            { onConflict: 'huddle_id,member_id' }
          );
      }
    };
    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMember?.id]);

  // Realtime subscription
  useEffect(() => {
    if (!huddle?.id) return;
    const channel = supabase
      .channel(`huddle-${huddle.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'huddles', filter: `id=eq.${huddle.id}` },
        (payload) => {
          setHuddle((prev) => (prev ? { ...prev, ...(payload.new as any) } : prev));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [huddle?.id]);

  const updateTimer = async (patch: Partial<TimerState>) => {
    if (!huddle) return;
    const next: TimerState = { ...huddle.timer_state, ...patch };
    setHuddle({ ...huddle, timer_state: next });
    await supabase.from('huddles').update({ timer_state: next as any }).eq('id', huddle.id);
  };

  const updateHuddle = async (patch: Partial<HuddleRecord>) => {
    if (!huddle) return;
    setHuddle({ ...huddle, ...patch });
    await supabase.from('huddles').update(patch as any).eq('id', huddle.id);
  };

  const updateAgenda = async (next: AgendaSegment[]) => {
    setAgenda(next);
    if (huddle) {
      const planned = next.reduce((a, s) => a + s.duration_s, 0);
      await supabase
        .from('huddles')
        .update({ agenda: next as any, planned_duration_s: planned })
        .eq('id', huddle.id);
    }
    await supabase.from('huddle_settings').update({ agenda: next as any }).eq('singleton', true);
  };

  return { huddle, agenda, loading, updateTimer, updateHuddle, updateAgenda };
}

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function segmentElapsedS(timer: TimerState, now: number): number {
  if (!timer.segment_started_at) return 0;
  const startedMs = new Date(timer.segment_started_at).getTime();
  const nowMs = timer.running ? now : timer.paused_at ? new Date(timer.paused_at).getTime() : now;
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000) - timer.paused_elapsed_s);
}

export function useSegmentTiming(agenda: AgendaSegment[], timer: TimerState) {
  const now = useNow(250);
  return useMemo(() => {
    const idx = Math.min(timer.segment_index, agenda.length - 1);
    const seg = agenda[idx];
    const planned = (seg?.duration_s || 0) + (timer.extra_s || 0);
    const elapsed = segmentElapsedS(timer, now);
    const remaining = planned - elapsed;
    return { idx, seg, planned, elapsed, remaining };
  }, [agenda, timer, now]);
}