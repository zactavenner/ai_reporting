import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ClientSettings, KPIThresholds, getThresholdsFromSettings } from './useClientSettings';

const defaultSettings: Omit<ClientSettings, 'id' | 'client_id'> = {
  cpl_threshold_yellow: 50,
  cpl_threshold_red: 100,
  cost_per_call_threshold_yellow: 100,
  cost_per_call_threshold_red: 200,
  cost_per_show_threshold_yellow: 150,
  cost_per_show_threshold_red: 300,
  cost_per_investor_threshold_yellow: 500,
  cost_per_investor_threshold_red: 1000,
  cost_of_capital_threshold_yellow: 5,
  cost_of_capital_threshold_red: 10,
  funded_investor_label: 'Funded Investors',
  mrr: 0,
  ad_spend_fee_threshold: 30000,
  ad_spend_fee_percent: 10,
  monthly_ad_spend_target: 0,
  daily_ad_spend_target: null,
  total_raise_amount: 0,
  default_lead_pipeline_value: 0,
};

export function useAllClientSettings(clientIds: string[]) {
  // Reuse the full-settings cache so both hooks share one network request.
  const full = useAllClientFullSettings(clientIds);
  const data: Record<string, KPIThresholds> = {};
  if (full.data) {
    for (const id of Object.keys(full.data)) {
      data[id] = getThresholdsFromSettings(full.data[id]);
    }
  }
  return { ...full, data } as unknown as ReturnType<typeof useAllClientFullSettings> & { data: Record<string, KPIThresholds> };
}

// New hook to get full settings for revenue calculations
export function useAllClientFullSettings(clientIds: string[]) {
  return useQuery({
    queryKey: ['all-client-full-settings', clientIds],
    queryFn: async () => {
      if (clientIds.length === 0) return {};
      
      const { data, error } = await supabase
        .from('client_settings')
        .select('*')
        .in('client_id', clientIds);
      
      if (error) throw error;
      
      const result: Record<string, ClientSettings> = {};
      
      for (const clientId of clientIds) {
        const settings = data?.find(s => s.client_id === clientId);
        if (settings) {
          result[clientId] = settings as ClientSettings;
        } else {
          result[clientId] = {
            id: '',
            client_id: clientId,
            ...defaultSettings,
          };
        }
      }
      
      return result;
    },
    enabled: clientIds.length > 0,
  });
}
