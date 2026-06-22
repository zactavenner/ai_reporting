import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { uploadOfferFile } from './useClientOffers';

export interface OfferFile {
  id: string;
  offer_id: string;
  client_id: string;
  file_url: string;
  file_name: string;
  file_type: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  sort_order: number;
  created_at: string;
  tags: string[];
  role: string | null;
}

export function useOfferFiles(offerId?: string) {
  return useQuery({
    queryKey: ['offer-files', offerId],
    queryFn: async () => {
      if (!offerId) return [];
      const { data, error } = await supabase
        .from('client_offer_files' as any)
        .select('*')
        .eq('offer_id', offerId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as OfferFile[];
    },
    enabled: !!offerId,
  });
}

export function useAddOfferFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId, clientId, file, uploadedBy, role }: {
      offerId: string;
      clientId: string;
      file: File;
      uploadedBy?: string;
      role?: string;
    }) => {
      const result = await uploadOfferFile(clientId, file);
      const fileType = file.name.split('.').pop()?.toLowerCase() || 'unknown';
      // Auto-pick a sensible default role for image uploads.
      const isImage = /^(png|jpe?g|gif|webp|svg)$/i.test(fileType);
      const defaultRole = role || (isImage ? 'reference' : null);

      const { data, error } = await supabase
        .from('client_offer_files' as any)
        .insert({
          offer_id: offerId,
          client_id: clientId,
          file_url: result.url,
          file_name: file.name,
          file_type: fileType,
          file_size_bytes: file.size,
          uploaded_by: uploadedBy || 'Unknown',
          role: defaultRole,
          tags: defaultRole ? [defaultRole] : [],
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['offer-files', vars.offerId] });
      toast.success('File added to offer');
    },
    onError: (err: Error) => {
      toast.error(`Failed to upload: ${err.message}`);
    },
  });
}

export function useUpdateOfferFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, offerId, updates }: {
      id: string;
      offerId: string;
      updates: Partial<Pick<OfferFile, 'role' | 'tags'>>;
    }) => {
      const { error } = await supabase
        .from('client_offer_files' as any)
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
      return offerId;
    },
    onSuccess: (offerId) => {
      queryClient.invalidateQueries({ queryKey: ['offer-files', offerId] });
    },
    onError: (err: Error) => toast.error(`Failed to update tag: ${err.message}`),
  });
}

export function useDeleteOfferFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, offerId }: { id: string; offerId: string }) => {
      const { error } = await supabase
        .from('client_offer_files' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
      return offerId;
    },
    onSuccess: (offerId) => {
      queryClient.invalidateQueries({ queryKey: ['offer-files', offerId] });
      toast.success('File removed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete: ${err.message}`);
    },
  });
}
