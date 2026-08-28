import { describe, it, expect } from 'vitest';
import {
  MEETGEEK_BASE_URLS,
  clearRegionCache,
  isRegionalMismatch,
  normalizeMeetgeekRegion,
  regionBaseUrl,
  resolveMeetgeekRegion,
  fingerprintApiKey,
  getCachedRegion,
  setCachedRegion,
  type MeetgeekProbeResult,
} from '../../supabase/functions/_shared/meetgeekRegion';
import {
  clampReplayLimit,
  isReplayableEvent,
  replayHydrationFailures,
  MAX_REPLAY_BATCH,
} from '../../supabase/functions/_shared/meetgeekReplay';
import { extractTranscriptCursor, extractTranscriptText } from '../../supabase/functions/_shared/meetgeekIngest';

const probes = (results: MeetgeekProbeResult[]) => {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    probe: async (baseUrl: string) => {
      calls.push(baseUrl);
      return results[Math.min(i++, results.length - 1)];
    },
  };
};

describe('meetgeek regional resolver', () => {
  it('defaults to the documented Europe endpoint and succeeds without probing US', async () => {
    const { calls, probe } = probes([{ ok: true, status: 200, body: { meeting_id: 'm1' } }]);
    const res = await resolveMeetgeekRegion({ probe });
    expect(res.ok).toBe(true);
    expect(res.region).toBe('eu');
    expect(res.baseUrl).toBe('https://api.meetgeek.ai');
    expect(calls).toEqual([MEETGEEK_BASE_URLS.eu]);
  });

  it('falls back to US only on an auth/not-found regional mismatch', async () => {
    for (const status of [401, 403, 404]) {
      const { calls, probe } = probes([
        { ok: false, status },
        { ok: true, status: 200, body: { meeting_id: 'm1' } },
      ]);
      const res = await resolveMeetgeekRegion({ probe });
      expect(res.ok).toBe(true);
      expect(res.region).toBe('us');
      expect(res.baseUrl).toBe('https://api-us.meetgeek.ai');
      expect(calls).toEqual([MEETGEEK_BASE_URLS.eu, MEETGEEK_BASE_URLS.us]);
    }
  });

  it('never retries the alternate region on 429, 5xx, network or parse errors', async () => {
    const transient: MeetgeekProbeResult[] = [
      { ok: false, status: 429 },
      { ok: false, status: 500 },
      { ok: false, status: 503 },
      { ok: false, errorKind: 'network' },
      { ok: false, errorKind: 'parse' },
    ];
    for (const failure of transient) {
      expect(isRegionalMismatch(failure)).toBe(false);
      const { calls, probe } = probes([failure, { ok: true, body: {} }]);
      const res = await resolveMeetgeekRegion({ probe });
      expect(res.ok).toBe(false);
      expect(calls).toEqual([MEETGEEK_BASE_URLS.eu]);
      expect(res.failure).toEqual(failure);
    }
  });

  it('honors an explicit MEETGEEK_REGION without any provider call', async () => {
    const { calls, probe } = probes([{ ok: true, body: {} }]);
    const us = await resolveMeetgeekRegion({ explicitRegion: 'US', probe });
    expect(us.region).toBe('us');
    expect(us.source).toBe('explicit');
    const eu = await resolveMeetgeekRegion({ explicitRegion: 'europe', probe });
    expect(eu.region).toBe('eu');
    expect(calls).toEqual([]);
    expect(normalizeMeetgeekRegion('nonsense')).toBeNull();
    expect(regionBaseUrl('us')).toBe(MEETGEEK_BASE_URLS.us);
  });

  it('caches by a non-reversible fingerprint and never stores the key', async () => {
    clearRegionCache();
    const key = 'super-secret-meetgeek-key';
    const fp = await fingerprintApiKey(key);
    expect(fp).not.toContain(key);
    expect(fp.length).toBeLessThanOrEqual(12);
    expect(getCachedRegion(fp)).toBeNull();
    setCachedRegion(fp, 'us');
    expect(getCachedRegion(fp)).toBe('us');
    clearRegionCache();
  });

  it('leaks no credential or provider body through resolution output', async () => {
    const { probe } = probes([{ ok: false, status: 401 }, { ok: false, status: 401 }]);
    const res = await resolveMeetgeekRegion({ probe });
    const serialized = JSON.stringify(res);
    expect(serialized).not.toMatch(/Bearer|authorization|api[_-]?key|secret/i);
  });
});

describe('bounded operator replay', () => {
  it('caps the batch and filters ineligible rows', () => {
    expect(clampReplayLimit(1000)).toBe(MAX_REPLAY_BATCH);
    expect(clampReplayLimit(-3)).toBeGreaterThan(0);
    expect(clampReplayLimit(10)).toBe(10);

    const base = { id: 'a', meeting_external_id: 'm1', signature_valid: true, status: 'rejected' };
    expect(isReplayableEvent({ ...base, hydration_code: 'unauthorized' })).toBe(true);
    expect(isReplayableEvent({ ...base, hydration_code: null })).toBe(true);
    expect(isReplayableEvent({ ...base, hydration_code: 'missing_api_key' })).toBe(true);
    // not replayable
    expect(isReplayableEvent({ ...base, hydration_code: 'rate_limited' })).toBe(false);
    expect(isReplayableEvent({ ...base, signature_valid: false, hydration_code: null })).toBe(false);
    expect(isReplayableEvent({ ...base, status: 'processed', hydration_code: null })).toBe(false);
    expect(isReplayableEvent({ ...base, meeting_external_id: null, hydration_code: null })).toBe(false);
  });

  it('is idempotent per meeting and reports counts with safe codes only', async () => {
    const rows = [
      { id: '1', meeting_external_id: 'm1', signature_valid: true, status: 'rejected', hydration_code: 'unauthorized', payload: { meeting_id: 'm1' } },
      { id: '2', meeting_external_id: 'm1', signature_valid: true, status: 'rejected', hydration_code: 'unauthorized', payload: { meeting_id: 'm1' } },
      { id: '3', meeting_external_id: 'm2', signature_valid: false, status: 'rejected', hydration_code: null, payload: {} },
      { id: '4', meeting_external_id: 'm3', signature_valid: true, status: 'rejected', hydration_code: null, payload: { meeting_id: 'm3' } },
    ];
    const attempted: string[] = [];
    const summary = await replayHydrationFailures({
      limit: 500,
      fetchCandidates: async (limit) => {
        expect(limit).toBe(MAX_REPLAY_BATCH);
        return rows as any;
      },
      replayOne: async (row) => {
        attempted.push(String(row.meeting_external_id));
        return row.meeting_external_id === 'm3'
          ? { ok: false, code: 'unauthorized' }
          : { ok: true, code: 'processed' };
      },
    });
    expect(attempted).toEqual(['m1', 'm3']);
    expect(summary.attempted).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.still_failing).toBe(1);
    expect(summary.skipped).toBe(2);
    expect(summary.codes).toEqual({ processed: 1, unauthorized: 1 });
    expect(JSON.stringify(summary)).not.toMatch(/Bearer|payload|@/);
  });

  it('treats a thrown replay as a safe non-fatal failure', async () => {
    const summary = await replayHydrationFailures({
      fetchCandidates: async () => ([
        { id: '1', meeting_external_id: 'm1', signature_valid: true, status: 'rejected', hydration_code: 'unauthorized', payload: {} },
      ] as any),
      replayOne: async () => { throw new Error('secret-key-leaked'); },
    });
    expect(summary.still_failing).toBe(1);
    expect(summary.codes).toEqual({ replay_error: 1 });
    expect(JSON.stringify(summary)).not.toContain('secret-key-leaked');
  });
});

describe('transcript pagination across the resolved region', () => {
  it('walks pages via pagination.next_cursor and stops on an empty cursor', () => {
    const p1 = { sentences: [{ speaker: 'Rep', transcript: 'One' }], pagination: { next_cursor: 'c2' } };
    const p2 = { sentences: [{ transcript: 'Two' }], pagination: { next_cursor: '' } };
    expect(extractTranscriptCursor(p1)).toBe('c2');
    expect(extractTranscriptCursor(p2)).toBeNull();
    expect([extractTranscriptText(p1), extractTranscriptText(p2)].join('\n')).toBe('Rep: One\nTwo');
  });
});
