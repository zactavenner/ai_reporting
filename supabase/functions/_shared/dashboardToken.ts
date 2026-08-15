// Verifies the HMAC dashboard_session_token minted by the verify-password
// edge function. The token has shape `<base64url(payload)>.<base64url(signature)>`
// where signature = HMAC-SHA256(payload, SUPABASE_SERVICE_ROLE_KEY) and it
// expires 12 hours after it is minted.
//
// Who may approve operator actions: any member row that still exists in
// agency_members. That table has no archived/disabled column today, so
// de-provisioning happens by deleting the row (which fails verification here).
// If an `is_archived`/`is_active` column is ever added, the filter below picks
// it up automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseDashboardToken } from './dashboardTokenCore.ts';

export interface DashboardMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export async function verifyDashboardToken(token: string | null | undefined): Promise<DashboardMember | null> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) return null;

  const parsed = await parseDashboardToken(token, secret);
  if (!parsed.ok) {
    console.warn('dashboard token rejected:', parsed.reason);
    return null;
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    secret,
  );
  const { data, error } = await admin
    .from('agency_members')
    .select('*')
    .eq('id', parsed.payload.memberId)
    .maybeSingle();
  if (error || !data) return null;

  // Reject de-provisioned members when the schema tracks that state.
  const row = data as Record<string, unknown>;
  if (row.is_archived === true || row.archived_at || row.is_active === false || row.disabled_at) return null;

  return data as DashboardMember;
}

export function readDashboardToken(req: Request, body: unknown): string | null {
  const header = req.headers.get('x-dashboard-token');
  if (header) return header;
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Dashboard ')) return auth.slice('Dashboard '.length);
  if (body && typeof body === 'object' && 'dashboard_session_token' in body) {
    const v = (body as Record<string, unknown>).dashboard_session_token;
    if (typeof v === 'string') return v;
  }
  return null;
}