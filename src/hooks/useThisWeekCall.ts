import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTeamMember } from '@/contexts/TeamMemberContext';
import { DEFAULT_WEEKLY_AGENDA, DEFAULT_WEEKLY_TIMER, sanitizeWeeklyAgenda, weekOfISO, type AgendaSegment, type TimerState } from '@/lib/weeklyCall/types';

export interface WeeklyCallRecord {
  id: string;
  client_id: string;
  week_of: string;
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

export function useThisWeekCall(clientId: string | undefined) {
  const { currentMember } = useTeamMember();
  const [call, setCall] = useState<WeeklyCallRecord | null>(null);
  const [agenda, setAgenda] = useState<AgendaSegment[]>(DEFAULT_WEEKLY_AGENDA);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const week = weekOfISO();
      const { data: settings } = await (supabase as any)
        .from('client_weekly_call_settings')
        .select('agenda')
        .eq('client_id', clientId)
        .maybeSingle();
      const settingsAgenda = sanitizeWeeklyAgenda(settings?.agenda as AgendaSegment[] | null | undefined);
      const planned = settingsAgenda.reduce((a, s) => a + s.duration_s, 0);

      const { data: existing } = await (supabase as any)
        .from('client_weekly_calls')
        .select('*')
        .eq('client_id', clientId)
        .eq('week_of', week)
        .not('status', 'in', '("completed","cancelled")')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let record = existing as WeeklyCallRecord | null;
      if (!record) {
        const { data: created } = await (supabase as any)
          .from('client_weekly_calls')
          .insert({
            client_id: clientId,
            week_of: week,
            planned_duration_s: planned,
            agenda: settingsAgenda as any,
            timer_state: DEFAULT_WEEKLY_TIMER as any,
          })
          .select('*')
          .single();
        record = created as WeeklyCallRecord;
      }

      if (cancelled) return;
      const recordAgenda = sanitizeWeeklyAgenda((record?.agenda as AgendaSegment[] | null | undefined) || settingsAgenda);
      setAgenda(recordAgenda);
      const sanitizedRecord = record ? { ...record, agenda: recordAgenda, planned_duration_s: recordAgenda.reduce((a, s) => a + s.duration_s, 0) } : record;
      setCall(sanitizedRecord);
      setLoading(false);

      if (record && JSON.stringify(record.agenda || []) !== JSON.stringify(recordAgenda)) {
        const plannedSanitized = recordAgenda.reduce((a, s) => a + s.duration_s, 0);
        await (supabase as any)
          .from('client_weekly_calls')
          .update({ agenda: recordAgenda as any, planned_duration_s: plannedSanitized })
          .eq('id', record.id);
      }

      if (record && currentMember) {
        await (supabase as any)
          .from('client_weekly_call_attendance')
          .upsert(
            {
              call_id: record.id,
              member_id: currentMember.id,
              member_name: currentMember.name,
              joined_at: new Date().toISOString(),
            },
            { onConflict: 'call_id,member_id' }
          );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, currentMember?.id]);

  useEffect(() => {
    if (!call?.id) return;
    const channel = supabase
      .channel(`weekly-call-${call.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'client_weekly_calls', filter: `id=eq.${call.id}` },
        (payload) => setCall((prev) => (prev ? { ...prev, ...(payload.new as any) } : prev))
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [call?.id]);

  const updateTimer = async (patch: Partial<TimerState>) => {
    if (!call) return;
    const next: TimerState = { ...call.timer_state, ...patch };
    setCall({ ...call, timer_state: next });
    await (supabase as any).from('client_weekly_calls').update({ timer_state: next as any }).eq('id', call.id);
  };

  const updateCall = async (patch: Partial<WeeklyCallRecord>) => {
    if (!call) return;
    setCall({ ...call, ...patch });
    await (supabase as any).from('client_weekly_calls').update(patch as any).eq('id', call.id);
  };

  const updateAgenda = async (next: AgendaSegment[]) => {
    const sanitized = sanitizeWeeklyAgenda(next);
    setAgenda(sanitized);
    if (call) {
      const planned = sanitized.reduce((a, s) => a + s.duration_s, 0);
      await (supabase as any)
        .from('client_weekly_calls')
        .update({ agenda: sanitized as any, planned_duration_s: planned })
        .eq('id', call.id);
    }
    if (clientId) {
      await (supabase as any)
        .from('client_weekly_call_settings')
        .upsert({ client_id: clientId, agenda: sanitized as any });
    }
  };

  // Create a brand-new call row for this week (used after a call is finished
  // so a second meeting the same week starts fresh at segment 0).
  const resetForNewCall = async () => {
    if (!clientId) return;
    const week = weekOfISO();
    const sanitized = sanitizeWeeklyAgenda(agenda);
    const planned = sanitized.reduce((a, s) => a + s.duration_s, 0);
    const { data: created } = await (supabase as any)
      .from('client_weekly_calls')
      .insert({
        client_id: clientId,
        week_of: week,
        planned_duration_s: planned,
        agenda: sanitized as any,
        timer_state: DEFAULT_WEEKLY_TIMER as any,
      })
      .select('*')
      .single();
    if (created) setCall(created as WeeklyCallRecord);
  };

  return { call, agenda, loading, updateTimer, updateCall, updateAgenda, resetForNewCall };
}