/**
 * Internal authentication for the Reporting 5.0 daily run.
 *
 * The secret is NEVER hardcoded and never returned to a caller. It is resolved
 * from the environment first (`DAILY_REPORT_RUN_SECRET`) and otherwise from the
 * service-role-only `integration_secrets` row (provider = 'daily_report_run'),
 * which is what pg_cron reads inline so no cron command stores plaintext.
 */
export const DAILY_REPORT_RUN_PROVIDER = 'daily_report_run';
export const DAILY_REPORT_RUN_ENV = 'DAILY_REPORT_RUN_SECRET';

function envSecret(): string {
  try {
    return ((globalThis as any).Deno?.env?.get?.(DAILY_REPORT_RUN_ENV) || '').trim();
  } catch {
    return '';
  }
}

async function resolveSecret(supabase: any): Promise<string | null> {
  const env = envSecret();
  if (env) return env;
  try {
    const { data, error } = await supabase
      .from('integration_secrets')
      .select('secret')
      .eq('provider', DAILY_REPORT_RUN_PROVIDER)
      .maybeSingle();
    if (error) return null;
    const stored = (data?.secret || '').trim();
    return stored || null;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Fail-closed: an unset secret authorizes nobody. */
export async function authorizeDailyReportRun(
  supabase: any,
  presented: string | null | undefined,
): Promise<boolean> {
  const candidate = (presented || '').trim();
  if (!candidate || candidate.length < 16) return false;
  const expected = await resolveSecret(supabase);
  if (!expected || expected.length < 16) return false;
  return timingSafeEqual(candidate, expected);
}