/**
 * Scheduler authentication for the automatic Media Buyer (JEREMY) review.
 *
 * The secret is never hardcoded and never returned to a caller. It resolves
 * from the environment first (`JEREMY_CRON_SECRET`) and otherwise from the
 * service-role-only `integration_secrets` row (provider = 'jeremy_review_cron'),
 * which is what pg_cron reads inline so no cron command stores plaintext.
 *
 * Fail-closed: an unset secret authorizes nobody. The anon key is NEVER
 * accepted as scheduler authentication.
 */
export const JEREMY_CRON_PROVIDER = 'jeremy_review_cron';
export const JEREMY_CRON_ENV = 'JEREMY_CRON_SECRET';
export const JEREMY_CRON_HEADER = 'x-jeremy-cron-secret';

function envSecret(): string {
  try {
    // deno-lint-ignore no-explicit-any
    return (((globalThis as any).Deno?.env?.get?.(JEREMY_CRON_ENV)) || '').trim();
  } catch {
    return '';
  }
}

// deno-lint-ignore no-explicit-any
async function resolveSecret(supabase: any): Promise<string | null> {
  const env = envSecret();
  if (env) return env;
  try {
    const { data, error } = await supabase
      .from('integration_secrets')
      .select('secret')
      .eq('provider', JEREMY_CRON_PROVIDER)
      .maybeSingle();
    if (error) return null;
    const stored = (data?.secret || '').trim();
    return stored || null;
  } catch {
    return null;
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only for a request presenting the exact scheduler secret. */
export async function authorizeJeremyCron(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  presented: string | null | undefined,
): Promise<boolean> {
  const candidate = (presented || '').trim();
  if (!candidate || candidate.length < 32) return false;
  const expected = await resolveSecret(supabase);
  if (!expected || expected.length < 32) return false;
  return timingSafeEqual(candidate, expected);
}

/** Reads the scheduler secret from the request header only (never the body). */
export function readJeremyCronSecret(req: Request): string | null {
  return req.headers.get(JEREMY_CRON_HEADER);
}