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

/**
 * Both the Edge environment secret and the provisioned `integration_secrets`
 * row are valid schedulers: pg_cron reads the table inline, while manual
 * platform-side scheduling can use the environment value. Either one alone is
 * sufficient; neither is ever returned to a caller.
 */
// deno-lint-ignore no-explicit-any
async function resolveSecrets(supabase: any): Promise<string[]> {
  const candidates: string[] = [];
  const env = envSecret();
  if (env) candidates.push(env);
  try {
    const { data, error } = await supabase
      .from('integration_secrets')
      .select('secret')
      .eq('provider', JEREMY_CRON_PROVIDER)
      .maybeSingle();
    if (!error) {
      const stored = (data?.secret || '').trim();
      if (stored) candidates.push(stored);
    }
  } catch {
    // Never surface storage details; absence means fail closed.
  }
  return candidates.filter((s) => s.length >= 32);
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
  const expected = await resolveSecrets(supabase);
  let ok = false;
  for (const secret of expected) {
    // Constant-time per candidate; no early exit on match.
    if (timingSafeEqual(candidate, secret)) ok = true;
  }
  return ok;
}

/** Reads the scheduler secret from the request header only (never the body). */
export function readJeremyCronSecret(req: Request): string | null {
  return req.headers.get(JEREMY_CRON_HEADER);
}