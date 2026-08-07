/**
 * Agency-operator authorization boundary.
 *
 * This is NOT investor/lead authorization and NOT a tenant scope. It answers a
 * single question: is the caller a provisioned HPA reporting operator allowed to
 * read meeting/transcript data and write MeetGeek configuration for ANY client?
 *
 * A valid Supabase JWT alone is never sufficient: the live project has no
 * verified client-to-user membership mapping, so a signed-in user must also be
 * explicitly allowlisted in `reporting_operator_users` (service-role only).
 *
 * Because this app authenticates the agency team through the password+name gate
 * (no rows in auth.users), a second identity is accepted: the HMAC-signed
 * `dashboard_session_token` minted server-side by `verify-password`. That token
 * is only honoured when it verifies against the service-role signing key AND it
 * resolves to an `agency_members` row whose role is in OPERATOR_ROLES. Public
 * report viewers never hold such a token, so they gain nothing.
 */
import { verifyDashboardToken, readDashboardToken } from './dashboardToken.ts';

/** Only these agency roles may act as reporting operators. */
const OPERATOR_ROLES = new Set(['admin', 'owner']);

export type OperatorAuth =
  | { ok: true; userId: string | null; via: 'service_role' | 'operator' | 'dashboard_admin'; memberId?: string; memberName?: string }
  | { ok: false; status: 401 | 403; error: string; code: 'missing_token' | 'invalid_token' | 'not_operator' | 'no_operators_provisioned' };

/** True when the allowlist is empty — admin bootstrap state. */
export async function hasProvisionedOperators(supabase: any): Promise<boolean> {
  const { count, error } = await supabase
    .from('reporting_operator_users')
    .select('user_id', { count: 'exact', head: true });
  if (error) return false;
  return (count ?? 0) > 0;
}

export async function authorizeOperator(
  req: Request,
  supabase: any,
  createClient: any,
  body?: unknown,
): Promise<OperatorAuth> {
  // 1. Dashboard (password-gate) identity — the live agency login path.
  const dashboardToken = readDashboardToken(req, body);
  if (dashboardToken) {
    const member = await verifyDashboardToken(dashboardToken);
    if (member && OPERATOR_ROLES.has(String(member.role || '').toLowerCase())) {
      return { ok: true, userId: null, via: 'dashboard_admin', memberId: member.id, memberName: member.name };
    }
    if (member) {
      return {
        ok: false,
        status: 403,
        error: 'Forbidden: your dashboard account is not an agency admin',
        code: 'not_operator',
      };
    }
    return { ok: false, status: 401, error: 'Invalid or expired dashboard session', code: 'invalid_token' };
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Authorization bearer token required', code: 'missing_token' };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Authorization bearer token required', code: 'missing_token' };
  }

  // Trusted server-side callers (cron, other edge functions).
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (serviceKey && token === serviceKey) return { ok: true, userId: null, via: 'service_role' };

  let userId: string | null = null;
  try {
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await authClient.auth.getClaims(token);
    const claims: any = data?.claims;
    if (error || !claims?.sub) {
      return { ok: false, status: 401, error: 'Invalid or expired session', code: 'invalid_token' };
    }
    userId = String(claims.sub);
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired session', code: 'invalid_token' };
  }

  // Allowlist lookup runs with the service client so it cannot be spoofed.
  const { data: operator } = await supabase
    .from('reporting_operator_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (operator?.user_id) return { ok: true, userId, via: 'operator' };

  const provisioned = await hasProvisionedOperators(supabase);
  if (!provisioned) {
    return {
      ok: false,
      status: 403,
      error:
        'Operator bootstrap required: no reporting operators are provisioned yet. An administrator must add the first user to the operator allowlist (reporting_operator_users) before meeting data can be read or MeetGeek settings changed.',
      code: 'no_operators_provisioned',
    };
  }

  return {
    ok: false,
    status: 403,
    error: 'Forbidden: your account is not a provisioned reporting operator',
    code: 'not_operator',
  };
}
