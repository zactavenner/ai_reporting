import { useMemo } from 'react';
import { useClients, type Client } from './useClients';

/**
 * Active clients in agency-dashboard order, used by the Daily Huddle client
 * walkthrough. Paused / on-hold clients are excluded; onboarding + active stay
 * in. Realtime is handled inside `useClients()` so reordering or pausing a
 * client on the dashboard flows into the running huddle automatically.
 */
export function useHuddleClients() {
  const query = useClients();
  const clients = useMemo<Client[]>(() => {
    return (query.data || []).filter(
      (c) => c.status !== 'paused' && c.status !== 'on_hold' && c.status !== 'inactive',
    );
  }, [query.data]);
  return { clients, isLoading: query.isLoading, error: query.error };
}