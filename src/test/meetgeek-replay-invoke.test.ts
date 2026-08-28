import { describe, it, expect } from 'vitest';
import {
  MAX_AUTO_REPLAY,
  buildReplayRequest,
  clampAutoReplayLimit,
  invokeReplayHydrationFailures,
} from '../../supabase/functions/_shared/meetgeekReplayInvoke.ts';

const KEY = 'service-role-key-abc123';
const URL_BASE = 'https://example.supabase.co';

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('meetgeek auto replay invocation', () => {
  it('bounds the limit at 50 and defaults to the cap', () => {
    expect(clampAutoReplayLimit(undefined)).toBe(MAX_AUTO_REPLAY);
    expect(clampAutoReplayLimit(0)).toBe(MAX_AUTO_REPLAY);
    expect(clampAutoReplayLimit(-5)).toBe(MAX_AUTO_REPLAY);
    expect(clampAutoReplayLimit(500)).toBe(50);
    expect(clampAutoReplayLimit(7)).toBe(7);
    expect(clampAutoReplayLimit('12')).toBe(12);
  });

  it('authorizes with the service-role key as Bearer and apikey, no password/client identity', () => {
    const { url, init } = buildReplayRequest({ supabaseUrl: URL_BASE + '/', serviceRoleKey: KEY, limit: 999 });
    expect(url).toBe(`${URL_BASE}/functions/v1/meetgeek-webhook`);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers.apikey).toBe(KEY);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ action: 'mg_replay_hydration_failures', limit: 50 });
    expect(Object.keys(body)).not.toContain('password');
    expect(Object.keys(body)).not.toContain('client_id');
  });

  it('returns whitelisted counts only on success', async () => {
    let seen: RequestInit | undefined;
    const res = await invokeReplayHydrationFailures({
      supabaseUrl: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl: (async (_u: any, init: any) => {
        seen = init;
        return okResponse({
          ok: true,
          requested: 50,
          eligible: 38,
          attempted: 38,
          succeeded: 30,
          skipped: 0,
          still_failing: 8,
          codes: { processed: 30, unauthorized: 8 },
          transcript: 'SECRET TRANSCRIPT',
          api_key: KEY,
        });
      }) as any,
    });
    expect(seen).toBeTruthy();
    expect(res.ok).toBe(true);
    expect(res.code).toBe('replayed');
    expect(res.summary).toEqual({
      requested: 50,
      eligible: 38,
      attempted: 38,
      succeeded: 30,
      skipped: 0,
      still_failing: 8,
      codes: { processed: 30, unauthorized: 8 },
    });
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('SECRET TRANSCRIPT');
  });

  it('fails safely with codes only (never throws) on network, http, parse and rejection', async () => {
    const network = await invokeReplayHydrationFailures({
      supabaseUrl: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl: (async () => { throw new Error('boom ' + KEY); }) as any,
    });
    expect(network).toEqual({ ok: false, code: 'replay_network_error' });

    const http = await invokeReplayHydrationFailures({
      supabaseUrl: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl: (async () => new Response('provider said ' + KEY, { status: 401 })) as any,
    });
    expect(http.ok).toBe(false);
    expect(http.code).toBe('replay_http_error');
    expect(JSON.stringify(http)).not.toContain(KEY);

    const parse = await invokeReplayHydrationFailures({
      supabaseUrl: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl: (async () => new Response('not json', { status: 200 })) as any,
    });
    expect(parse.code).toBe('replay_parse_error');

    const rejected = await invokeReplayHydrationFailures({
      supabaseUrl: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl: (async () => okResponse({ error: 'webhook_secret_not_configured' })) as any,
    });
    expect(rejected).toMatchObject({ ok: false, code: 'replay_rejected' });
  });

  it('does not attempt the call when configuration is missing', async () => {
    let called = 0;
    const res = await invokeReplayHydrationFailures({
      supabaseUrl: URL_BASE,
      serviceRoleKey: '',
      fetchImpl: (async () => { called += 1; return okResponse({ ok: true }); }) as any,
    });
    expect(called).toBe(0);
    expect(res).toEqual({ ok: false, code: 'replay_not_configured' });
  });

  it('makes exactly one attempt per call (cadence is the retry, no tight loop)', async () => {
    let calls = 0;
    await invokeReplayHydrationFailures({
      supabaseUrl: URL_BASE,
      serviceRoleKey: KEY,
      fetchImpl: (async () => { calls += 1; return new Response('', { status: 500 }); }) as any,
    });
    expect(calls).toBe(1);
  });
});
