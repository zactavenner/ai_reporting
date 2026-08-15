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
