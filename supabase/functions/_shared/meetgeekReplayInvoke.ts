// Server-only, service-role invocation of the bounded MeetGeek hydration
// recovery action (`mg_replay_hydration_failures`) exposed by meetgeek-webhook.
//
// Rules baked in here:
//  - authorization is ALWAYS the server-held service-role key (Bearer + apikey);
//    there is no shared password and no caller-supplied identity,
//  - the limit is hard-capped at MAX_AUTO_REPLAY (50),
//  - failures never throw to the caller and never surface provider text,
//    credentials or PII: only a short, stable code,
//  - a single attempt per call — the 10-minute cron cadence IS the retry, so
//    there is no inner retry loop.

export const MAX_AUTO_REPLAY = 50;

export interface ReplayInvokeResult {
  ok: boolean;
  /** Safe, stable code only. */
  code: string;
  /** Counts summary from the recovery action when it succeeded. */
  summary?: Record<string, unknown>;
  status?: number;
}

export function clampAutoReplayLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return MAX_AUTO_REPLAY;
  return Math.min(Math.floor(n), MAX_AUTO_REPLAY);
}

export function buildReplayRequest(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  limit?: unknown;
}): { url: string; init: RequestInit } {
  const base = String(args.supabaseUrl || '').replace(/\/+$/, '');
  return {
    url: `${base}/functions/v1/meetgeek-webhook`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.serviceRoleKey}`,
        apikey: args.serviceRoleKey,
      },
      body: JSON.stringify({
        action: 'mg_replay_hydration_failures',
        limit: clampAutoReplayLimit(args.limit),
      }),
    },
  };
}

/** Never throws. Returns a safe code on every failure path. */
export async function invokeReplayHydrationFailures(args: {
  supabaseUrl?: string | null;
  serviceRoleKey?: string | null;
  limit?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<ReplayInvokeResult> {
  const supabaseUrl = String(args.supabaseUrl || '');
  const serviceRoleKey = String(args.serviceRoleKey || '');
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, code: 'replay_not_configured' };
  }
  const doFetch = args.fetchImpl ?? fetch;
  const { url, init } = buildReplayRequest({ supabaseUrl, serviceRoleKey, limit: args.limit });

  let res: Response;
  try {
    res = await doFetch(url, init);
  } catch {
    return { ok: false, code: 'replay_network_error' };
  }
  if (!res.ok) {
    // Body intentionally drained and discarded — never logged or returned.
    try { await res.text(); } catch { /* ignore */ }
    return { ok: false, code: 'replay_http_error', status: res.status };
  }
  let parsed: any;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, code: 'replay_parse_error', status: res.status };
  }
  if (!parsed || typeof parsed !== 'object' || parsed.ok !== true) {
    return { ok: false, code: 'replay_rejected', status: res.status };
  }
  // Whitelist only the numeric/count fields plus the safe code histogram.
  const summary: Record<string, unknown> = {};
  for (const k of ['requested', 'eligible', 'attempted', 'succeeded', 'skipped', 'still_failing']) {
    if (typeof parsed[k] === 'number') summary[k] = parsed[k];
  }
  if (parsed.codes && typeof parsed.codes === 'object') {
    const codes: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed.codes as Record<string, unknown>)) {
      if (typeof v === 'number') codes[String(k).slice(0, 60)] = v;
    }
    summary.codes = codes;
  }
  return { ok: true, code: 'replayed', summary, status: res.status };
}
