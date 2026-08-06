import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  EMPTY_SNAPSHOT,
  ONBOARDING_STAGES,
  computeStageStatuses,
  type OnboardingSnapshot,
  type StageStatus,
} from '@/lib/onboarding/dockStages';

export interface StageTimerRow {
  stage_key: string;
  started_at: string;
  completed_at: string | null;
}

/**
 * Loads everything the onboarding dock renders and keeps a persisted
 * per-stage timer in sync so elapsed time survives refreshes.
 */
export function useOnboardingDock(clientId: string | null) {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot>(EMPTY_SNAPSHOT);
  const [timers, setTimers] = useState<Record<string, StageTimerRow>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const syncing = useRef(false);

  const refresh = useCallback(async () => {
    if (!clientId) {
      setSnapshot(EMPTY_SNAPSHOT);
      setTimers({});
      setLoading(false);
      return;
    }
    const [offerRes, assetRes, staticRes, videoRes, avatarRes, approvalRes, goalRes, timerRes] =
      await Promise.all([
        supabase.from('client_offers').select('*').eq('client_id', clientId)
          .order('updated_at', { ascending: false }).limit(1),
        supabase.from('client_assets').select('*').eq('client_id', clientId)
          .order('created_at', { ascending: false }),
        supabase.from('creatives').select('id, title, file_url, headline, body_copy, aspect_ratio, status, created_at')
          .eq('client_id', clientId).eq('source', 'onboarding-build')
          .order('created_at', { ascending: false }).limit(30),
        supabase.from('creative_video_jobs')
          .select('id, status, prompt, output_url, resolution, aspect_ratio, duration, error, progress_label, created_at')
          .eq('client_id', clientId).order('created_at', { ascending: false }).limit(20),
        supabase.from('avatars').select('id, name, image_url, gender, age_range, style')
          .eq('client_id', clientId).order('created_at', { ascending: false }).limit(1),
        supabase.from('approval_queue').select('*').eq('client_id', clientId)
          .in('queue_type', ['creative_review', 'video_scripts'])
          .order('created_at', { ascending: false }).limit(12),
        supabase.from('jarvis_goals').select('*').eq('client_id', clientId)
          .ilike('title', 'Onboarding build%').order('created_at', { ascending: false }).limit(1),
        supabase.from('onboarding_stage_progress').select('stage_key, started_at, completed_at')
          .eq('client_id', clientId),
      ]);

    const goal = goalRes.data?.[0] || null;
    let events: any[] = [];
    if (goal) {
      const { data } = await supabase.from('jarvis_goal_events')
        .select('id, kind, title, content, created_at')
        .eq('goal_id', goal.id).order('created_at', { ascending: false }).limit(60);
      events = data || [];
    }

    setSnapshot({
      offer: offerRes.data?.[0] || null,
      assets: assetRes.data || [],
      statics: staticRes.data || [],
      videoJobs: videoRes.data || [],
      avatar: avatarRes.data?.[0] || null,
      approvals: approvalRes.data || [],
      goal,
      events,
    });
    setTimers(
      Object.fromEntries((timerRes.data || []).map((r: any) => [r.stage_key, r as StageTimerRow])),
    );
    setLoading(false);
  }, [clientId]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  // Live feed + polling while the backend mission runs.
  const goalId = snapshot.goal?.id as string | undefined;
  const goalRunning = ['queued', 'running'].includes(snapshot.goal?.status || '');
  useEffect(() => {
    if (!goalId || !goalRunning) return;
    const ch = supabase
      .channel(`onboarding-dock-${goalId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'jarvis_goal_events', filter: `goal_id=eq.${goalId}`,
      }, () => refresh())
      .subscribe();
    const poll = window.setInterval(refresh, 15000);
    return () => { supabase.removeChannel(ch); window.clearInterval(poll); };
  }, [goalId, goalRunning, refresh]);

  // Ticker for live stage durations.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const statuses = useMemo(() => computeStageStatuses(snapshot), [snapshot]);

  // Persist stage timing: open a row when a stage becomes active, close it when complete.
  useEffect(() => {
    if (!clientId || loading || syncing.current) return;
    const stamp = new Date().toISOString();
    const inserts: any[] = [];
    const closes: string[] = [];

    for (const stage of ONBOARDING_STAGES) {
      const status = statuses[stage.key];
      const row = timers[stage.key];
      if (status === 'active' && !row) {
        inserts.push({ client_id: clientId, stage_key: stage.key, stage_label: stage.label, started_at: stamp });
      } else if (status === 'complete') {
        if (!row) {
          inserts.push({
            client_id: clientId, stage_key: stage.key, stage_label: stage.label,
            started_at: stamp, completed_at: stamp,
          });
        } else if (!row.completed_at) {
          closes.push(stage.key);
        }
      }
    }
    if (inserts.length === 0 && closes.length === 0) return;

    syncing.current = true;
    (async () => {
      try {
        if (inserts.length) {
          const { error } = await supabase.from('onboarding_stage_progress')
            .upsert(inserts, { onConflict: 'client_id,stage_key', ignoreDuplicates: true });
          if (error) console.error('[onboarding-dock] timer insert failed', error);
        }
        for (const key of closes) {
          const { error } = await supabase.from('onboarding_stage_progress')
            .update({ completed_at: stamp }).eq('client_id', clientId).eq('stage_key', key);
          if (error) console.error('[onboarding-dock] timer close failed', error);
        }
        const { data } = await supabase.from('onboarding_stage_progress')
          .select('stage_key, started_at, completed_at').eq('client_id', clientId);
        setTimers(Object.fromEntries((data || []).map((r: any) => [r.stage_key, r as StageTimerRow])));
      } finally {
        syncing.current = false;
      }
    })();
  }, [clientId, loading, statuses, timers]);

  const elapsedFor = useCallback(
    (stageKey: string): number | null => {
      const row = timers[stageKey];
      if (!row) return null;
      const start = new Date(row.started_at).getTime();
      const end = row.completed_at ? new Date(row.completed_at).getTime() : now;
      return Math.max(0, Math.floor((end - start) / 1000));
    },
    [timers, now],
  );

  const totalElapsed = useMemo(
    () => ONBOARDING_STAGES.reduce((sum, s) => sum + (elapsedFor(s.key) ?? 0), 0),
    [elapsedFor],
  );

  return { snapshot, statuses: statuses as Record<string, StageStatus>, loading, refresh, elapsedFor, totalElapsed };
}