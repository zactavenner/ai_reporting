import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CustomTab {
  id: string;
  client_id: string;
  name: string;
  url: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function useCustomTabs(clientId?: string) {
  return useQuery({
    queryKey: ['custom-tabs', clientId],
    queryFn: async () => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from('client_custom_tabs')
        .select('*')
        .eq('client_id', clientId)
        .order('sort_order', { ascending: true });
      
      if (error) throw error;
      return data as CustomTab[];
    },
    enabled: !!clientId,
  });
}

export function useCreateCustomTab() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (tab: { client_id: string; name: string; url: string }) => {
      const { data, error } = await supabase
        .from('client_custom_tabs')
        .insert(tab)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['custom-tabs', variables.client_id] });
      toast.success('Tab created successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to create tab: ' + error.message);
    },
  });
}

export function useDeleteCustomTab() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId: string }) => {
      const { error } = await supabase
        .from('client_custom_tabs')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { id, clientId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['custom-tabs', result.clientId] });
      toast.success('Tab deleted successfully');
    },
    onError: (error: any) => {
      toast.error('Failed to delete tab: ' + error.message);
    },
  });
}

export function useUpdateCustomTab() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, clientId, name, url }: { id: string; clientId: string; name: string; url: string }) => {
      const { data, error } = await supabase
        .from('client_custom_tabs')
        .update({ name, url })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { ...data, clientId };
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['custom-tabs', result.clientId] });
      toast.success('Link updated');
    },
    onError: (error: any) => {
      toast.error('Failed to update link: ' + error.message);
    },
  });
}
