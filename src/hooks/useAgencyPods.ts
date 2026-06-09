import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AgencyPod {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface ClientPodAssignment {
  id: string;
  client_id: string;
  pod_id: string;
  is_lead: boolean;
  created_at: string;
  pod?: AgencyPod;
}

// Fetch all pods
export function useAgencyPods() {
  return useQuery({
    queryKey: ['agency-pods'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agency_pods')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return data as AgencyPod[];
    },
  });
}

// Create pod
export function useCreatePod() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (pod: { name: string; description?: string; color?: string }) => {
      const { data, error } = await supabase
        .from('agency_pods')
        .insert(pod)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-pods'] });
      toast.success('Pod created successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to create pod: ' + error.message);
    },
  });
}

// Update pod
export function useUpdatePod() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<AgencyPod> & { id: string }) => {
      const { data, error } = await supabase
        .from('agency_pods')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-pods'] });
      toast.success('Pod updated successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to update pod: ' + error.message);
    },
  });
}

// Delete pod
export function useDeletePod() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (podId: string) => {
      const { error } = await supabase
        .from('agency_pods')
        .delete()
        .eq('id', podId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-pods'] });
      queryClient.invalidateQueries({ queryKey: ['agency-members'] });
      toast.success('Pod deleted successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to delete pod: ' + error.message);
    },
  });
}

// Fetch pods assigned to a client
export function useClientPodAssignments(clientId?: string) {
  return useQuery({
    queryKey: ['client-pod-assignments', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_pod_assignments')
        .select('*, pod:agency_pods(*)')
        .eq('client_id', clientId!);
      
      if (error) throw error;
      return data as ClientPodAssignment[];
    },
    enabled: !!clientId,
  });
}

// Assign pod to client
export function useAssignPodToClient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ clientId, podId, isLead = false }: { clientId: string; podId: string; isLead?: boolean }) => {
      const { data, error } = await supabase
        .from('client_pod_assignments')
        .insert({
          client_id: clientId,
          pod_id: podId,
          is_lead: isLead,
        })
        .select()
        .single();
      
      if (error) throw error;

      // Auto round-robin assign a Media Buyer / Account Manager based on the pod type.
      try {
        await autoAssignRoleFromPod(clientId, podId);
      } catch (e) {
        console.warn('auto round-robin assignment failed', e);
      }

      return data;
    },
    onSuccess: (_, { clientId }) => {
      queryClient.invalidateQueries({ queryKey: ['client-pod-assignments', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: Error) => {
      toast.error('Failed to assign pod: ' + error.message);
    },
  });
}

// ----- Round-robin auto-assignment helpers -----

function detectRole(podName: string): 'media_buyer' | 'account_manager' | null {
  const n = (podName || '').toLowerCase();
  if (n.includes('media') && n.includes('buy')) return 'media_buyer';
  if (n.includes('account') && (n.includes('manage') || n.includes('mgmt'))) return 'account_manager';
  return null;
}

async function autoAssignRoleFromPod(clientId: string, podId: string) {
  // Look up the pod we just assigned
  const { data: pod } = await supabase
    .from('agency_pods')
    .select('id, name')
    .eq('id', podId)
    .maybeSingle();
  if (!pod) return;

  const role = detectRole(pod.name);
  if (!role) return;

  // Don't overwrite an existing assignment
  const { data: existing } = await supabase
    .from('client_assignments')
    .select('media_buyer, account_manager')
    .eq('client_id', clientId)
    .maybeSingle();
  if (existing && (existing as any)[role]) return;

  // Members in this pod (the eligible pool)
  const { data: members } = await supabase
    .from('agency_members')
    .select('id, name')
    .eq('pod_id', podId);
  if (!members || members.length === 0) return;

  // Current load: how many active clients each member already owns for this role
  const { data: loadRows } = await supabase
    .from('client_assignments')
    .select(role);
  const counts: Record<string, number> = {};
  for (const m of members) counts[m.name] = 0;
  for (const row of (loadRows || []) as any[]) {
    const who = row?.[role];
    if (who && who in counts) counts[who] += 1;
  }

  // Pick the member with fewest assignments, ties broken alphabetically for stable rotation
  const sorted = [...members].sort((a, b) => {
    const ca = counts[a.name] ?? 0;
    const cb = counts[b.name] ?? 0;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });
  const chosen = sorted[0];
  if (!chosen) return;

  // Upsert into client_assignments + mirror onto clients table
  const upsertPayload: Record<string, any> = { client_id: clientId };
  upsertPayload[role] = chosen.name;
  await supabase.from('client_assignments').upsert(upsertPayload as any, { onConflict: 'client_id' });

  const clientPatch: Record<string, any> = {};
  clientPatch[role] = chosen.name;
  await supabase.from('clients').update(clientPatch).eq('id', clientId);

  toast.success(`Auto-assigned ${role === 'media_buyer' ? 'Media Buyer' : 'Account Manager'}: ${chosen.name}`);
}

// Remove pod from client
export function useRemovePodFromClient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ clientId, podId }: { clientId: string; podId: string }) => {
      const { error } = await supabase
        .from('client_pod_assignments')
        .delete()
        .eq('client_id', clientId)
        .eq('pod_id', podId);
      
      if (error) throw error;
    },
    onSuccess: (_, { clientId }) => {
      queryClient.invalidateQueries({ queryKey: ['client-pod-assignments', clientId] });
    },
    onError: (error: Error) => {
      toast.error('Failed to remove pod: ' + error.message);
    },
  });
}

// Update pod assignment (for setting lead)
export function useUpdatePodAssignment() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ clientId, podId, isLead }: { clientId: string; podId: string; isLead: boolean }) => {
      // First, if setting as lead, unset all other leads for this client
      if (isLead) {
        await supabase
          .from('client_pod_assignments')
          .update({ is_lead: false })
          .eq('client_id', clientId);
      }
      
      const { data, error } = await supabase
        .from('client_pod_assignments')
        .update({ is_lead: isLead })
        .eq('client_id', clientId)
        .eq('pod_id', podId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { clientId }) => {
      queryClient.invalidateQueries({ queryKey: ['client-pod-assignments', clientId] });
    },
    onError: (error: Error) => {
      toast.error('Failed to update assignment: ' + error.message);
    },
  });
}

// Update member's pod assignment
export function useUpdateMemberPod() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ memberId, podId }: { memberId: string; podId: string | null }) => {
      const { data, error } = await supabase
        .from('agency_members')
        .update({ pod_id: podId })
        .eq('id', memberId)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-members'] });
      queryClient.invalidateQueries({ queryKey: ['agency-pods'] });
    },
    onError: (error: Error) => {
      toast.error('Failed to update member: ' + error.message);
    },
  });
}
