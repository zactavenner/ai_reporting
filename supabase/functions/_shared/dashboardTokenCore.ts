// Pure crypto/encoding core for the dashboard signed session token.
// No secrets, no env, no network — safe to unit-test directly.
// Token shape: `<base64url(payload)>.<base64url(HMAC-SHA256(payload, secret))>`

/** Signed dashboard sessions live for 12 hours. */
export const DASHBOARD_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

export interface DashboardTokenPayload {
  memberId: string;
  exp: number;
}

export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlEncodeText(text: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(text));
}

export function base64UrlDecodeBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function signPayload(payloadB64: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64)));
  return base64UrlEncodeBytes(sig);
}

/** Mints a 12-hour signed session token for an agency member. */
export async function createDashboardToken(
  memberId: string,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const payloadB64 = base64UrlEncodeText(JSON.stringify({ memberId, exp: now + DASHBOARD_TOKEN_TTL_MS }));
  return `${payloadB64}.${await signPayload(payloadB64, secret)}`;
}

export type TokenFailure = 'malformed' | 'bad_payload' | 'expired' | 'bad_signature';

/**
 * Verifies shape, signature and expiry. Returns the payload or a failure
 * reason — it does NOT decide authorization (the caller resolves the member).
 */
export async function parseDashboardToken(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): Promise<{ ok: true; payload: DashboardTokenPayload } | { ok: false; reason: TokenFailure }> {
  if (!token || typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return { ok: false, reason: 'malformed' };

  let payload: Partial<DashboardTokenPayload>;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeBytes(payloadB64)));
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }
  if (!payload?.memberId || !payload?.exp) return { ok: false, reason: 'bad_payload' };

  if (await signPayload(payloadB64, secret) !== sigB64) return { ok: false, reason: 'bad_signature' };
  if (now > Number(payload.exp)) return { ok: false, reason: 'expired' };

  return { ok: true, payload: { memberId: String(payload.memberId), exp: Number(payload.exp) } };
}