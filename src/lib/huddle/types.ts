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
  /**
   * Sub-position within the current segment (used by the client walkthrough
   * to step client-by-client without advancing the segment).
   */
  sub_index?: number;
}

export const DEFAULT_AGENDA: AgendaSegment[] = [
  { key: 'wins',         name: 'Wins & Attendance',    duration_s: 120 },
  { key: 'accountability', name: 'Accountability (Yesterday)', duration_s: 180 },
  { key: 'clients',      name: 'Client Walkthrough',   duration_s: 720 },
  { key: 'close',        name: 'Recap & Close',        duration_s: 120 },
];

export const DEFAULT_TIMER: TimerState = {
  segment_index: 0,
  segment_started_at: null,
  paused_at: null,
  paused_elapsed_s: 0,
  // Never auto-advance / auto-end: the huddle counts up until the facilitator
  // moves on or finishes.
  auto_advance: false,
  running: false,
  finished: false,
  extra_s: 0,
  sub_index: 0,
};