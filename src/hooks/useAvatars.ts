import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Avatar, AvatarStyle } from '@/types';

// Fetch all avatars (for admin view)
export function useAllAvatars() {
  return useQuery({
    queryKey: ['avatars', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('avatars')
        .select('*')
        .order('is_stock', { ascending: false })
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as Avatar[];
    },
    staleTime: 300000, // 5 min
  });
}

export function useAvatars(clientId?: string | null) {
  return useQuery({
    queryKey: ['avatars', clientId],
    queryFn: async () => {
      let query = supabase
        .from('avatars')
        .select('*')
        .order('is_stock', { ascending: false })
        .order('created_at', { ascending: false });
      
      if (clientId) {
        // Get stock avatars OR avatars for this client
        query = query.or(`is_stock.eq.true,client_id.eq.${clientId}`);
      } else {
        // Just stock avatars
        query = query.eq('is_stock', true);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as Avatar[];
    },
  });
}

export function useStockAvatars() {
  return useQuery({
    queryKey: ['avatars', 'stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('avatars')
        .select('*')
        .eq('is_stock', true)
        .order('name');
      
      if (error) throw error;
      return data as Avatar[];
    },
  });
}

export function useCreateAvatar() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (avatar: {
      client_id?: string;
      name: string;
      description?: string;
      gender?: string;
      age_range?: string;
      ethnicity?: string;
      style?: AvatarStyle;
      image_url: string;
      is_stock?: boolean;
    }) => {
      const { data, error } = await supabase
        .from('avatars')
        .insert(avatar)
        .select()
        .single();
      
      if (error) throw error;
      return data as Avatar;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['avatars'] });
    },
  });
}

export function useDeleteAvatar() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('avatars')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['avatars'] });
    },
  });
}

/** Clone a stock avatar (and all its looks) into a specific client's library. */
export function useCloneStockAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stockAvatarId, clientId }: { stockAvatarId: string; clientId: string }) => {
      const { data, error } = await supabase.functions.invoke('clone-stock-avatar', {
        body: { stockAvatarId, clientId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to clone avatar');
      return data as { avatarId: string; alreadyAssigned?: boolean; looksCopied?: number };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['avatars'] }),
  });
}

/** Run GPT-5 vision analysis on an avatar and persist the style profile to metadata. */
export function useAnalyzeAvatarStyle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ avatarId }: { avatarId: string }) => {
      const { data, error } = await supabase.functions.invoke('analyze-avatar-style', {
        body: { avatarId, persist: true },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Analysis failed');
      return data as { profile: Record<string, unknown> };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['avatars'] }),
  });
}
