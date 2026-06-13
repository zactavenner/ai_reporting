import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AgencySettings {
  id: string;
  ai_prompt_agency: string;
  ai_prompt_client: string;
  openai_api_key: string | null;
  gemini_api_key: string | null;
  api_usage_limit: number;
  meetgeek_api_key: string | null;
  meetgeek_webhook_secret: string | null;
  kpi_google_doc_url: string | null;
  kpi_google_sheet_url: string | null;
  hermes_api_key?: string | null;
  hermes_callback_url?: string | null;
  hermes_enabled?: boolean;
  standup_slack_channel_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function useAgencySettings() {
  return useQuery({
    queryKey: ['agency-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agency_settings')
        .select('*')
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      
      // Return defaults if no settings exist
      if (!data) {
        return {
          ai_prompt_agency: 'You are an expert advertising agency performance analyst. Analyze the uploaded files and provided metrics to give actionable insights for the agency portfolio.',
          ai_prompt_client: 'You are an expert advertising performance analyst. Analyze the uploaded files and provided metrics to give actionable insights for this specific client.',
          openai_api_key: null,
          gemini_api_key: null,
          api_usage_limit: 100,
          meetgeek_api_key: null,
          meetgeek_webhook_secret: null,
          kpi_google_doc_url: null,
          kpi_google_sheet_url: null,
        } as AgencySettings;
      }
      
      return data as AgencySettings;
    },
  });
}

export function useUpdateAgencySettings() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (settings: Partial<AgencySettings>) => {
      // Get existing settings first
      const { data: existing } = await supabase
        .from('agency_settings')
        .select('id')
        .limit(1)
        .maybeSingle();
      
      if (existing) {
        const { data, error } = await supabase
          .from('agency_settings')
          .update(settings)
          .eq('id', existing.id)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('agency_settings')
          .insert(settings)
          .select()
          .single();
        
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-settings'] });
    },
  });
}
