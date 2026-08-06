import { supabase } from '@/integrations/supabase/client';

/**
 * Calls the MeetGeek bridge and surfaces the server's authorization message.
 * Reads/config writes are gated by the reporting-operator allowlist, so a 403
 * can mean "not an operator" or "no operators provisioned yet" (bootstrap).
 */
export async function invokeMeetgeek<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('meetgeek-webhook', { body });
  if (error) {
    let message = error.message;
    try {
      const payload = await (error as any).context?.json?.();
      if (payload?.error) message = String(payload.error);
    } catch {
      /* keep original message */
    }
    throw new Error(message);
  }
  if ((data as any)?.error) throw new Error(String((data as any).error));
  return data as T;
}
