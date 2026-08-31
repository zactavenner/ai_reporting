import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { dashboardAuthHeaders } from '@/lib/dashboardAuthHeaders';
import { toast } from 'sonner';

/**
 * Agency persona endpoints (Jeremy AI and any future persona). The endpoint URL
 * carries a bearer token, so it never reaches the browser: everything goes
 * through the operator-gated `agency-personas` function, which returns the
 * masked `v_agency_personas` projection.
 */
export interface AgencyPersona {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  mcp_host: string | null;
  has_token: boolean;
  created_at: string;
  updated_at: string;
}

async function callPersonas<T = any>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('agency-personas', {
    body: payload,
    headers: dashboardAuthHeaders(),
  });
  if (error) throw new Error((data as any)?.error || error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export function useAgencyPersonas() {
  return useQuery({
    queryKey: ['agency-personas'],
    queryFn: async () => {
      const d = await callPersonas<{ personas: AgencyPersona[] }>({ action: 'list' });
      return d.personas ?? [];
    },
    staleTime: 60_000,
  });
}

export function useSaveAgencyPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      id?: string;
      name: string;
      slug?: string;
      description?: string | null;
      mcp_url?: string;
      is_active?: boolean;
      is_default?: boolean;
    }) => callPersonas({ action: 'upsert', ...p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency-personas'] });
      toast.success('Persona saved');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save persona'),
  });
}

export function useSetDefaultPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callPersonas({ action: 'set_default', id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency-personas'] });
      toast.success('Default persona updated');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to set default'),
  });
}

export function useDeleteAgencyPersona() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => callPersonas({ action: 'delete', id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agency-personas'] });
      toast.success('Persona removed');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to remove persona'),
  });
}

export function useTestAgencyPersona() {
  return useMutation({
    mutationFn: (slug: string) =>
      callPersonas<{ reply: string; polls: number; elapsed_ms: number }>({ action: 'test', slug }),
    onError: (e: any) => toast.error(e.message || 'Persona did not reply'),
  });
}
