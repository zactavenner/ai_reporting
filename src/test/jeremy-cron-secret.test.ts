import { describe, expect, it } from 'vitest';
import {
  authorizeJeremyCron,
  readJeremyCronSecret,
  JEREMY_CRON_HEADER,
  timingSafeEqual,
} from '../../supabase/functions/_shared/jeremyCronSecret';

const STORED = 'a'.repeat(64);

function db(secret: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: secret ? { secret } : null, error: null }),
        }),
      }),
    }),
  };
}

describe('jeremy cron scheduler secret', () => {
  it('rejects a missing secret', async () => {
    expect(await authorizeJeremyCron(db(STORED), null)).toBe(false);
    expect(await authorizeJeremyCron(db(STORED), '')).toBe(false);
  });

  it('rejects a wrong secret of the same length', async () => {
    expect(await authorizeJeremyCron(db(STORED), 'b'.repeat(64))).toBe(false);
  });

  it('rejects a short/low-entropy secret', async () => {
    expect(await authorizeJeremyCron(db('short'), 'short')).toBe(false);
  });

  it('fails closed when nothing is provisioned', async () => {
    expect(await authorizeJeremyCron(db(null), STORED)).toBe(false);
  });

  it('accepts the provisioned scheduler secret', async () => {
    expect(await authorizeJeremyCron(db(STORED), STORED)).toBe(true);
  });

  it('reads the secret from the header only, never the body', () => {
    const req = new Request('https://example.com', {
      method: 'POST',
      headers: { [JEREMY_CRON_HEADER]: STORED },
      body: JSON.stringify({ secret: 'in-body' }),
    });
    expect(readJeremyCronSecret(req)).toBe(STORED);
    expect(readJeremyCronSecret(new Request('https://example.com'))).toBeNull();
  });

  it('compares in constant time by length', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });
});

describe('jeremy cron force bypass', () => {
  it('no longer exists anywhere in the cron function', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('supabase/functions/jeremy-review-cron/index.ts', 'utf8');
    expect(src).not.toMatch(/force/i);
    // The gate is unconditional: no `body.source === "cron"` guard remains.
    expect(src).not.toMatch(/body\.source/);
    expect(src).toMatch(/authorizeJeremyCron/);
  });
});