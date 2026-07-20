import type { AgendaSegment, TimerState } from '@/lib/huddle/types';
export type { AgendaSegment, TimerState };

export const DEFAULT_WEEKLY_AGENDA: AgendaSegment[] = [
  { key: 'wins',          name: 'Wins',                duration_s: 180 },
  { key: 'scorecard',     name: 'Scorecard',           duration_s: 300 },
  { key: 'creative',      name: 'Creative Approvals',  duration_s: 360 },
  { key: 'tasks',         name: 'Task Review',         duration_s: 300 },
  { key: 'recap',         name: 'Recap',               duration_s: 120 },
];

export const DEFAULT_WEEKLY_TIMER: TimerState = {
  segment_index: 0,
  segment_started_at: null,
  paused_at: null,
  paused_elapsed_s: 0,
  auto_advance: false,
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