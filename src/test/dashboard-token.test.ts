import { describe, it, expect } from 'vitest';
import {
  createDashboardToken,
  parseDashboardToken,
  DASHBOARD_TOKEN_TTL_MS,
} from '../../supabase/functions/_shared/dashboardTokenCore';

const SECRET = 'service-role-secret-for-tests';

describe('dashboard signed session token', () => {
  it('mints a 12-hour token that verifies', async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(DASHBOARD_TOKEN_TTL_MS).toBe(1000 * 60 * 60 * 12);
    const token = await createDashboardToken('member-1', SECRET, now);
    const parsed = await parseDashboardToken(token, SECRET, now + 1000);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.memberId).toBe('member-1');
      expect(parsed.payload.exp).toBe(now + DASHBOARD_TOKEN_TTL_MS);
    }
  });

  it('rejects a token past 12 hours', async () => {
    const now = Date.now();
    const token = await createDashboardToken('member-1', SECRET, now);
    const justInside = await parseDashboardToken(token, SECRET, now + DASHBOARD_TOKEN_TTL_MS - 1000);
    const justOutside = await parseDashboardToken(token, SECRET, now + DASHBOARD_TOKEN_TTL_MS + 1000);
    expect(justInside.ok).toBe(true);
    expect(justOutside).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a tampered payload (member escalation attempt)', async () => {
    const now = Date.now();
    const token = await createDashboardToken('member-1', SECRET, now);
    const [, sig] = token.split('.');
    const forgedPayload = btoa(JSON.stringify({ memberId: 'admin-999', exp: now + DASHBOARD_TOKEN_TTL_MS }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    expect(await parseDashboardToken(`${forgedPayload}.${sig}`, SECRET, now)).toEqual({
      ok: false, reason: 'bad_signature',
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createDashboardToken('member-1', 'other-secret');
    expect(await parseDashboardToken(token, SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects malformed input', async () => {
    expect(await parseDashboardToken(null, SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(await parseDashboardToken('nodot', SECRET)).toEqual({ ok: false, reason: 'malformed' });
    expect(await parseDashboardToken('!!!.sig', SECRET)).toEqual({ ok: false, reason: 'bad_payload' });
  });
});