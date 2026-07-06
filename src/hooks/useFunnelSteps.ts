import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface FunnelStep {
  id: string;
  client_id: string;
  campaign_id: string | null;
  parent_step_id: string | null;
  name: string;
  url: string;
  step_type: string;
  step_kind: 'page' | 'fb_lead_form' | 'ads' | 'sms' | 'email';
  ad_platform: 'facebook' | 'instagram' | null;
  sms_body: string | null;
  email_subject: string | null;
  email_from_name: string | null;
  email_body: string | null;
  messages: Array<{
    delay_days?: number;
    body?: string;
    subject?: string;
    from_name?: string;
  }> | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function useFunnelSteps(clientId?: string) {
  return useQuery({
    queryKey: ['funnel-steps', clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from('client_funnel_steps')
        .select('*')
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true });
      
      if (error) throw error;
      return data as FunnelStep[];
    },
    enabled: !!clientId,
  });
}

export function useCreateFunnelStep() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (step: {
      client_id: string;
      campaign_id?: string | null;
      parent_step_id?: string | null;
      name: string;
      url: string;
      sort_order?: number;
      step_kind?: string;
      ad_platform?: string | null;
      sms_body?: string | null;
      email_subject?: string | null;
      email_from_name?: string | null;
      email_body?: string | null;
      messages?: any;
    }) => {
      const { data, error } = await supabase
        .from('client_funnel_steps')
        .insert(step)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['funnel-steps', variables.client_id] });
      toast.success('Funnel step added successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to add funnel step: ' + error.message);
    },
  });
}

export function useUpdateFunnelStep() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, clientId, updates }: { id: string; clientId: string; updates: Partial<FunnelStep> }) => {
      const { data, error } = await supabase
        .from('client_funnel_steps')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, clientId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['funnel-steps', result.clientId] });
      toast.success('Funnel step updated');
    },
    onError: (error: any) => {
      toast.error('Failed to update funnel step: ' + error.message);
    },
  });
}

export function useDeleteFunnelStep() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId: string }) => {
      const { error } = await supabase
        .from('client_funnel_steps')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { id, clientId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['funnel-steps', result.clientId] });
      toast.success('Funnel step deleted');
    },
    onError: (error: any) => {
      toast.error('Failed to delete funnel step: ' + error.message);
    },
  });
}

export function useReorderFunnelSteps() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ clientId, orderedIds }: { clientId: string; orderedIds: string[] }) => {
      // Batch update sort_order for all steps
      const updates = orderedIds.map((id, index) => 
        supabase
          .from('client_funnel_steps')
          .update({ sort_order: index })
          .eq('id', id)
      );
      await Promise.all(updates);
      return { clientId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['funnel-steps', result.clientId] });
      toast.success('Funnel order updated');
    },
    onError: (error: any) => {
      toast.error('Failed to reorder funnel steps: ' + error.message);
    },
  });
}
