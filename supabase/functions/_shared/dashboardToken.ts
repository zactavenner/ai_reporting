// Verifies the HMAC dashboard_session_token minted by the verify-password
// edge function. The token has shape `<base64url(payload)>.<base64url(signature)>`
// where signature = HMAC-SHA256(payload, SUPABASE_SERVICE_ROLE_KEY).
// Returns the resolved agency_members row (or null).
import { createClient } from 'npm:@supabase/supabase-js@2';

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export interface DashboardMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

export async function verifyDashboardToken(token: string | null | undefined): Promise<DashboardMember | null> {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) return null;

  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return null;

  let payload: { memberId?: string; exp?: number };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (!payload?.memberId || !payload?.exp || Date.now() > payload.exp) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64)),
  );
  if (base64UrlEncode(expected) !== sigB64) return null;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    secret,
  );
  const { data, error } = await admin
    .from('agency_members')
    .select('id, name, email, role')
    .eq('id', payload.memberId)
    .maybeSingle();
  if (error || !data) return null;
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