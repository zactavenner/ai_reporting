/**
 * Attaches the HMAC dashboard session token (minted by verify-password) to
 * operator-gated edge function calls. Server side re-verifies the signature and
 * the agency-admin role — this header alone grants nothing.
 */
export function dashboardAuthHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem('dashboard_session_token');
    return token ? { 'x-dashboard-token': token } : {};
  } catch {
    return {};
  }
}
