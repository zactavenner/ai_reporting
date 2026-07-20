import type { AgendaSegment, TimerState } from '@/lib/huddle/types';
export type { AgendaSegment, TimerState };

export const DEFAULT_WEEKLY_AGENDA: AgendaSegment[] = [
  // Total 20 min. 3m wins, 2m recap; remainder split between scorecard & tasks,
  // with a light window for creative approvals.
  { key: 'wins',          name: 'Wins',                duration_s: 180 },
  { key: 'scorecard',     name: 'Scorecard',           duration_s: 390 },
  { key: 'creative',      name: 'Creative Approvals',  duration_s: 120 },
  { key: 'tasks',         name: 'Task Review',         duration_s: 390 },
  { key: 'recap',         name: 'Recap',               duration_s: 120 },
];

const WEEKLY_ALLOWED_KEYS = new Set(DEFAULT_WEEKLY_AGENDA.map((segment) => segment.key));

export function sanitizeWeeklyAgenda(agenda: AgendaSegment[] | null | undefined): AgendaSegment[] {
  if (!Array.isArray(agenda) || agenda.length === 0) return DEFAULT_WEEKLY_AGENDA;
  const byKey = new Map(agenda.map((segment) => [segment.key, segment]));
  return DEFAULT_WEEKLY_AGENDA.map((fallback) => {
    const saved = byKey.get(fallback.key);
    if (!saved || !WEEKLY_ALLOWED_KEYS.has(saved.key)) return fallback;
    return {
      ...fallback,
      name: fallback.name,
      duration_s: Number(saved.duration_s) > 0 ? Number(saved.duration_s) : fallback.duration_s,
    };
  });
}

export const DEFAULT_WEEKLY_TIMER: TimerState = {
  segment_index: 0,
  segment_started_at: null,
  paused_at: null,
  paused_elapsed_s: 0,
  auto_advance: true,
  running: false,
  finished: false,
  extra_s: 0,
};

export function weekOfISO(d: Date = new Date()): string {
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  const y = m.getFullYear();
  const mo = String(m.getMonth() + 1).padStart(2, '0');
  const da = String(m.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}