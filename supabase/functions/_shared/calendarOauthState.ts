// Stateless, signed OAuth `state` so the public callback can prove the flow was
// started by an authorized operator without storing anything.
const enc = new TextEncoder();

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createOauthState(secret: string): Promise<string> {
  const payload = `${Date.now()}.${crypto.randomUUID()}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifyOauthState(state: string | null, secret: string, maxAgeMs = 15 * 60 * 1000): Promise<boolean> {
  if (!state || !secret) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  const expected = await sign(`${ts}.${nonce}`, secret);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;
  const age = Date.now() - Number(ts);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}