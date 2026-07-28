// Thin client for the whatsapp-dashboard edge function.
// Uses the dashboard_session_token from localStorage (minted by verify-password)
// because the app runs on custom auth, not Supabase Auth.
import { supabase } from '@/integrations/supabase/client';

export async function whatsappDashboard<T = any>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('dashboard_session_token') : null;
  if (!token) throw new Error('Not signed in — refresh and log back in.');
  const { data, error } = await supabase.functions.invoke('whatsapp-dashboard', {
    body: { action, dashboard_session_token: token, ...extra },
    headers: { 'x-dashboard-token': token },
  });
  if (error) throw new Error(error.message || 'whatsapp-dashboard failed');
  if (data && typeof data === 'object' && 'error' in data && (data as any).error) {
    throw new Error((data as any).error);
  }
  return data as T;
}