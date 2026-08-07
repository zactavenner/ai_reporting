/**
 * Single resolver for the GHL appointment webhook shared secret.
 *
 * Order: environment secret, then the service-role-only
 * `integration_secrets` row (provider = 'ghl_appointment_webhook').
 * The VALUE never leaves the server: callers may only ask whether it exists or
 * hand it to a constant-time comparison.
 */
export const GHL_APPOINTMENT_WEBHOOK_PROVIDER = 'ghl_appointment_webhook';

export async function resolveGhlAppointmentWebhookSecret(supabase: any): Promise<string | null> {
  const env = (Deno.env.get('GHL_APPOINTMENT_WEBHOOK_SECRET') || '').trim();
  if (env) return env;
  const { data } = await supabase
    .from('integration_secrets')
    .select('secret')
    .eq('provider', GHL_APPOINTMENT_WEBHOOK_PROVIDER)
    .maybeSingle();
  const stored = (data?.secret || '').trim();
  return stored || null;
}

/** Status only — never the value. Uses the SAME resolver as verification. */
export async function ghlAppointmentWebhookSecretConfigured(supabase: any): Promise<boolean> {
  const secret = await resolveGhlAppointmentWebhookSecret(supabase);
  return !!secret && secret.length >= 32;
}
