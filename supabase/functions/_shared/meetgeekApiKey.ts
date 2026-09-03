// Single server-only resolver for the agency MeetGeek provider API key.
//
// Order:
//   1. the service-role-only `public.integration_secrets` row
//      (provider = 'meetgeek_api_key'; RLS on, zero policies, zero grants) —
//      this is the rotatable store the agency provisions,
//   2. the MEETGEEK_API_KEY environment secret as a legacy fallback.
//
// The DB row wins deliberately: platform env secrets are immutable once created,
// so a stale env value must never shadow a freshly provisioned key.
//
// `agency_settings` is intentionally NOT consulted: that table is publicly
// readable, so a provider credential must never be stored there.
//
// The value never leaves the server: it is only ever handed to an Authorization
// header. Nothing here logs, returns, or echoes the key.

export const MEETGEEK_API_KEY_ENV = 'MEETGEEK_API_KEY';
export const MEETGEEK_API_KEY_PROVIDER = 'meetgeek_api_key';

function readEnv(name: string): string {
  try {
    const env = (globalThis as any).Deno?.env;
    return (env?.get?.(name) || '').trim();
  } catch {
    return '';
  }
}

/** Returns the key, or '' when none is configured. */
export async function resolveMeetgeekApiKey(supabase: any): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('integration_secrets')
      .select('secret')
      .eq('provider', MEETGEEK_API_KEY_PROVIDER)
      .maybeSingle();
    if (!error) {
      const stored = typeof data?.secret === 'string' ? data.secret.trim() : '';
      if (stored) return stored;
    }
  } catch {
    // fall through to the env fallback
  }
  return readEnv(MEETGEEK_API_KEY_ENV);
}

/** Status only — never the value. Uses the SAME resolver as real reads. */
export async function meetgeekApiKeyConfigured(supabase: any): Promise<boolean> {
  return (await resolveMeetgeekApiKey(supabase)).length > 0;
}

/** Explicit region pin, if the operator set one. */
export function meetgeekRegionEnv(): string {
  return readEnv('MEETGEEK_REGION');
}
