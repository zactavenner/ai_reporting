/**
 * Single resolver for the GHL appointment webhook shared secret.
 *
 * Order: environment secret, then the service-role-only
 * `integration_secrets` row (provider = 'ghl_appointment_webhook').
 * The VALUE never leaves the server: callers may only ask whether it exists or
 * hand it to a constant-time comparison.
 */
export const GHL_APPOINTMENT_WEBHOOK_PROVIDER = 'ghl_appointment_webhook';

export const GHL_APPOINTMENT_WEBHOOK_ENV = 'GHL_APPOINTMENT_WEBHOOK_SECRET';

function readEnvSecret(): string {
  try {
    // Deno in production; absent under vitest.
    const env = (globalThis as any).Deno?.env;
    return (env?.get?.(GHL_APPOINTMENT_WEBHOOK_ENV) || '').trim();
  } catch {
    // Env permission denied — fall through to the private table.
    return '';
  }
}

export async function resolveGhlAppointmentWebhookSecret(
  supabase: any,
  envOverride?: string | null,
): Promise<string | null> {
  const env = (envOverride === undefined ? readEnvSecret() : (envOverride || '')).trim();
  if (env) return env;
  try {
    const { data, error } = await supabase
      .from('integration_secrets')
      .select('secret')
      .eq('provider', GHL_APPOINTMENT_WEBHOOK_PROVIDER)
      .maybeSingle();
    if (error) return null;
    const stored = (data?.secret || '').trim();
    return stored || null;
  } catch {
    // Never surface storage details; absence means fail closed upstream.
    return null;
  }
}

/** Status only — never the value. Uses the SAME resolver as verification. */
export async function ghlAppointmentWebhookSecretConfigured(
  supabase: any,
  envOverride?: string | null,
): Promise<boolean> {
  const secret = await resolveGhlAppointmentWebhookSecret(supabase, envOverride);
  return !!secret && secret.length >= 32;
}
