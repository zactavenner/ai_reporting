export interface AgendaSegment {
  key: string;
  name: string;
  duration_s: number;
}

export interface TimerState {
  segment_index: number;
  segment_started_at: string | null; // ISO
  paused_at: string | null;           // ISO when paused
  paused_elapsed_s: number;           // accumulated pause offset for current segment
  auto_advance: boolean;
  running: boolean;
  finished: boolean;
  extra_s: number;                    // +30s bumps applied to current segment
}

export const DEFAULT_AGENDA: AgendaSegment[] = [
  { key: 'wins', name: 'Wins', duration_s: 120 },
  { key: 'numbers', name: "Yesterday's Numbers", duration_s: 180 },
  { key: 'health', name: 'Client Health', duration_s: 180 },
  { key: 'accountability', name: 'Accountability', duration_s: 240 },
  { key: 'blockers', name: 'Blockers', duration_s: 120 },
  { key: 'close', name: 'Close & Cascade', duration_s: 60 },
];

export const DEFAULT_TIMER: TimerState = {
  segment_index: 0,
  segment_started_at: null,
  paused_at: null,
  paused_elapsed_s: 0,
  auto_advance: false,
  running: false,
  finished: false,
  extra_s: 0,
};