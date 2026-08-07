import { describe, it, expect } from 'vitest';
import {
  GHL_APPOINTMENT_WEBHOOK_PROVIDER,
  ghlAppointmentWebhookSecretConfigured,
  resolveGhlAppointmentWebhookSecret,
} from '../../supabase/functions/_shared/webhookSecret';

/** Minimal stand-in for the service-role client, recording what was queried. */
function fakeSupabase(row: { secret: string } | null, opts: { error?: boolean; throws?: boolean } = {}) {
  const calls: Array<{ table: string; provider?: string }> = [];
  return {
    calls,
    from(table: string) {
      const entry: { table: string; provider?: string } = { table };
      calls.push(entry);
      const builder: any = {
        select: () => builder,
        eq: (_col: string, val: string) => {
          entry.provider = val;
          return builder;
        },
        maybeSingle: async () => {
          if (opts.throws) throw new Error('permission denied for table integration_secrets');
          if (opts.error) return { data: null, error: { message: 'permission denied' } };
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

const STRONG = 'b'.repeat(48);

describe('ghl appointment webhook secret resolver', () => {
  it('prefers the environment secret and never touches the private table', async () => {
    const sb = fakeSupabase({ secret: 'from-table-'.padEnd(40, 'x') });
    expect(await resolveGhlAppointmentWebhookSecret(sb, STRONG)).toBe(STRONG);
    expect(sb.calls).toHaveLength(0);
  });

  it('falls back to integration_secrets for the ghl_appointment_webhook provider', async () => {
    const sb = fakeSupabase({ secret: STRONG });
    expect(await resolveGhlAppointmentWebhookSecret(sb, '')).toBe(STRONG);
    expect(sb.calls[0]).toEqual({ table: 'integration_secrets', provider: GHL_APPOINTMENT_WEBHOOK_PROVIDER });
    expect(GHL_APPOINTMENT_WEBHOOK_PROVIDER).toBe('ghl_appointment_webhook');
  });

  it('trims stored whitespace and treats blank rows as absent', async () => {
    expect(await resolveGhlAppointmentWebhookSecret(fakeSupabase({ secret: `  ${STRONG}  ` }), '')).toBe(STRONG);
    expect(await resolveGhlAppointmentWebhookSecret(fakeSupabase({ secret: '   ' }), '')).toBeNull();
    expect(await resolveGhlAppointmentWebhookSecret(fakeSupabase(null), '')).toBeNull();
  });

  it('fails closed when the private table read errors or throws', async () => {
    expect(await resolveGhlAppointmentWebhookSecret(fakeSupabase(null, { error: true }), '')).toBeNull();
    expect(await resolveGhlAppointmentWebhookSecret(fakeSupabase(null, { throws: true }), '')).toBeNull();
  });

  it('status helper uses the same resolver and enforces the 32-char floor', async () => {
    expect(await ghlAppointmentWebhookSecretConfigured(fakeSupabase({ secret: STRONG }), '')).toBe(true);
    expect(await ghlAppointmentWebhookSecretConfigured(fakeSupabase({ secret: 'a'.repeat(31) }), '')).toBe(false);
    expect(await ghlAppointmentWebhookSecretConfigured(fakeSupabase(null), '')).toBe(false);
    expect(await ghlAppointmentWebhookSecretConfigured(fakeSupabase(null), STRONG)).toBe(true);
  });

  it('never returns the secret value from the status helper', async () => {
    const status = await ghlAppointmentWebhookSecretConfigured(fakeSupabase({ secret: STRONG }), '');
    expect(JSON.stringify(status)).not.toContain(STRONG);
    expect(typeof status).toBe('boolean');
  });
});
