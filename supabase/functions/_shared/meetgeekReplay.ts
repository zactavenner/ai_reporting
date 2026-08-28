// Bounded, idempotent operator recovery for MeetGeek ingest events whose
// authoritative provider hydration failed (typically a regional 401).
//
// Rules baked in here:
//  - only signature_valid rows are ever eligible (the raw-body HMAC decision is
//    never re-litigated or bypassed),
//  - only non-terminal rows with a meeting_external_id and a hydration code of
//    null / unauthorized / missing_api_key,
//  - hard cap of 50 per request,
//  - replay goes through the SAME calendar-gated ingestion path, so tenant
//    mapping stays server-owned and the dedupe key keeps it idempotent,
//  - the caller never supplies a client id; results carry counts and safe codes.

export const MAX_REPLAY_BATCH = 50;
export const DEFAULT_REPLAY_BATCH = 25;

/** Hydration codes that a replay can plausibly fix. */
export const REPLAYABLE_HYDRATION_CODES: ReadonlyArray<string | null> = [
  null,
  'unauthorized',
  'missing_api_key',
];

export interface ReplayCandidateRow {
  id: string;
  meeting_external_id: string | null;
  signature_valid: boolean | null;
  status: string | null;
  hydration_code?: string | null;
  payload?: unknown;
}

export function clampReplayLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REPLAY_BATCH;
  return Math.min(Math.floor(n), MAX_REPLAY_BATCH);
}

export function isReplayableEvent(row: ReplayCandidateRow): boolean {
  if (!row) return false;
  if (row.signature_valid !== true) return false;
  if (!row.meeting_external_id) return false;
  const status = String(row.status || '').toLowerCase();
  if (status === 'processed' || status === 'ignored') return false;
  const code = row.hydration_code == null ? null : String(row.hydration_code).toLowerCase();
  return REPLAYABLE_HYDRATION_CODES.includes(code as any);
}

export interface ReplayOutcome {
  /** Safe, stable code only — never provider text, credentials or PII. */
  code: string;
  ok: boolean;
}

export interface ReplaySummary {
  requested: number;
  eligible: number;
  attempted: number;
  succeeded: number;
  skipped: number;
  still_failing: number;
  codes: Record<string, number>;
}

/**
 * Replays eligible events one at a time. `replayOne` must funnel through the
 * real signature-verified, calendar-gated ingestion path.
 */
export async function replayHydrationFailures(args: {
  limit?: unknown;
  fetchCandidates: (limit: number) => Promise<ReplayCandidateRow[]>;
  replayOne: (row: ReplayCandidateRow) => Promise<ReplayOutcome>;
}): Promise<ReplaySummary> {
  const limit = clampReplayLimit(args.limit);
  const rows = await args.fetchCandidates(limit);
  const bounded = (rows || []).slice(0, limit);
  const eligible = bounded.filter(isReplayableEvent);

  const summary: ReplaySummary = {
    requested: limit,
    eligible: eligible.length,
    attempted: 0,
    succeeded: 0,
    skipped: bounded.length - eligible.length,
    still_failing: 0,
    codes: {},
  };

  const seen = new Set<string>();
  for (const row of eligible) {
    // Idempotency guard inside a single batch: one attempt per meeting.
    const key = String(row.meeting_external_id);
    if (seen.has(key)) {
      summary.skipped += 1;
      continue;
    }
    seen.add(key);
    summary.attempted += 1;
    let outcome: ReplayOutcome;
    try {
      outcome = await args.replayOne(row);
    } catch {
      outcome = { ok: false, code: 'replay_error' };
    }
    if (outcome.ok) summary.succeeded += 1;
    else summary.still_failing += 1;
    const code = String(outcome.code || 'unknown').slice(0, 60);
    summary.codes[code] = (summary.codes[code] || 0) + 1;
  }

  return summary;
}
