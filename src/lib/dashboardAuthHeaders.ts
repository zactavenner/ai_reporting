/**
 * Attaches the HMAC dashboard session token (minted by verify-password, valid
 * for 12 hours) to operator-gated edge function calls. The server re-verifies
 * the signature, the expiry and the member record — this header alone grants
 * nothing, and an expired token returns 401 so the operator signs in again.
 */
export function dashboardAuthHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem('dashboard_session_token');
    return token ? { 'x-dashboard-token': token } : {};
  } catch {
    return {};
  }
}

/**
 * Normalizes edge-function errors from operator-gated calls. An expired/invalid
 * dashboard session token is dropped from localStorage so the operator is asked
 * to sign in again instead of retrying with a dead token.
 */
export async function normalizeDashboardError(error: unknown): Promise<Error> {
  let message = (error as any)?.message || 'Request failed';
  let code = '';
  try {
    const payload = await (error as any)?.context?.json?.();
    if (payload?.error) message = String(payload.error);
    if (payload?.code) code = String(payload.code);
  } catch {
    /* keep original message */
  }
  if (code === 'invalid_token' || /invalid or expired dashboard session/i.test(message)) {
    try { localStorage.removeItem('dashboard_session_token'); } catch { /* ignore */ }
    return new Error('Your dashboard session expired. Please sign in again to continue.');
  }
  return new Error(message);
}
