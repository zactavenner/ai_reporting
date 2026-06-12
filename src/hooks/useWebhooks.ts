import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState, useEffect, useCallback } from 'react';

export interface WebhookLog {
  id: string;
  client_id: string;
  webhook_type: string;
  status: string;
  payload: string | null;
  error_message: string | null;
  processed_at: string;
}

export interface WebhookMapping {
  // Contact fields
  nameField?: string;
  emailField?: string;
  phoneField?: string;
  // UTM fields
  utmSourceField?: string;
  utmMediumField?: string;
  utmCampaignField?: string;
  utmContentField?: string;
  utmTermField?: string;
  // Value fields
  valueField?: string;
  pipelineValueField?: string;
  dateField?: string;
  // Custom fields (array of {name, path})
  customFields?: Array<{ name: string; path: string }>;
  // Status fields
  statusField?: string;
  summaryField?: string;
  // Question fields
  zipCodeField?: string;
  willingToRelocateField?: string;
  relocateNYCField?: string;
  salesExperienceField?: string;
  outboundCallsField?: string;
}

export interface MappingFieldDefinition {
  key: keyof Omit<WebhookMapping, 'customFields'>;
  label: string;
  placeholder: string;
  expectedType: 'string' | 'number' | 'date';
  helperText?: string;
  group?: 'contact' | 'utm' | 'value' | 'other' | 'questions';
}

export interface WebhookDefinition {
  id: string;
  label: string;
  description: string;
  endpointSuffix: string;
  samplePayload: object;
  mappingFields: MappingFieldDefinition[];
  supportsCustomFields?: boolean;
}

export const WEBHOOK_DEFINITIONS: WebhookDefinition[] = [
  {
    id: 'lead',
    label: '1. New Lead + Pipeline Value',
    endpointSuffix: 'lead',
    description: 'Trigger on Form Submit or Contact Created. Captures contact info, UTMs, and pipeline value.',
    samplePayload: {
      contact: {
        id: "ghl_123456",
        email: "lead@example.com",
        phone: "+15550000000",
        firstName: "John",
        lastName: "Doe",
        name: "John Doe",
        custom_fields: { 
          estimated_value: "1500.00",
          question_1: "Answer to first question",
          question_2: "Answer to second question"
        },
        attribution: {
          utm_source: "facebook",
          utm_medium: "paid",
          utm_campaign: "summer_sale",
          utm_content: "ad_v1",
          utm_term: "investment"
        }
      }
    },
    supportsCustomFields: true,
    mappingFields: [
      // Contact fields
      { key: 'nameField', label: 'Name Field', placeholder: 'contact.name', expectedType: 'string', group: 'contact', helperText: 'Full name or use firstName + lastName' },
      { key: 'emailField', label: 'Email Field', placeholder: 'contact.email', expectedType: 'string', group: 'contact' },
      { key: 'phoneField', label: 'Phone Field', placeholder: 'contact.phone', expectedType: 'string', group: 'contact' },
      // UTM fields
      { key: 'utmSourceField', label: 'UTM Source', placeholder: 'contact.attribution.utm_source', expectedType: 'string', group: 'utm' },
      { key: 'utmMediumField', label: 'UTM Medium', placeholder: 'contact.attribution.utm_medium', expectedType: 'string', group: 'utm' },
      { key: 'utmCampaignField', label: 'UTM Campaign', placeholder: 'contact.attribution.utm_campaign', expectedType: 'string', group: 'utm' },
      { key: 'utmContentField', label: 'UTM Content', placeholder: 'contact.attribution.utm_content', expectedType: 'string', group: 'utm' },
      { key: 'utmTermField', label: 'UTM Term', placeholder: 'contact.attribution.utm_term', expectedType: 'string', group: 'utm' },
      // Value
      { key: 'pipelineValueField', label: 'Pipeline Value', placeholder: 'contact.custom_fields.estimated_value', expectedType: 'number', group: 'value', helperText: 'Total estimated deal value' },
      // Custom question fields
      { key: 'zipCodeField', label: 'Current Zip Code', placeholder: 'contact.custom_fields.zip_code', expectedType: 'string', group: 'questions', helperText: 'What is your current zip code?' },
      { key: 'willingToRelocateField', label: 'Willing to Relocate', placeholder: 'contact.custom_fields.willing_to_relocate', expectedType: 'string', group: 'questions', helperText: 'Are you willing to relocate if you are hired?' },
      { key: 'relocateNYCField', label: 'Relocate to NYC', placeholder: 'contact.custom_fields.relocate_nyc', expectedType: 'string', group: 'questions', helperText: 'Are you located in or willing to relocate to New York City?' },
      { key: 'salesExperienceField', label: 'Sales/BD Experience', placeholder: 'contact.custom_fields.sales_experience', expectedType: 'string', group: 'questions', helperText: 'Do you have sales or business development experience?' },
      { key: 'outboundCallsField', label: 'Outbound Calls Comfort', placeholder: 'contact.custom_fields.outbound_calls', expectedType: 'string', group: 'questions', helperText: 'Are you comfortable making 50+ outbound calls per day?' },
    ]
  },
  {
    id: 'booked',
    label: '2. Booked Call',
    endpointSuffix: 'booked',
    description: 'Trigger when Appointment Status is confirmed.',
    samplePayload: {
      appointment: {
        id: "app_987",
        status: "confirmed",
        contactId: "ghl_123456",
        meta: { start_time: "2024-01-15T10:00:00Z" }
      }
    },
    mappingFields: []
  },
  {
    id: 'showed',
    label: '3. Showed Call',
    endpointSuffix: 'showed',
    description: 'Trigger when Appointment Status is marked as Showed.',
    samplePayload: {
      appointment: {
        id: "app_987",
        status: "showed"
      }
    },
    mappingFields: []
  },
  {
    id: 'reconnect',
    label: '4. Reconnect Call Booked',
    endpointSuffix: 'reconnect',
    description: 'Trigger when a reconnect/follow-up call is scheduled.',
    samplePayload: {
      appointment: {
        id: "app_reconnect_123",
        status: "confirmed",
        contactId: "ghl_123456",
        meta: { start_time: "2024-01-20T14:00:00Z" }
      }
    },
    mappingFields: []
  },
  {
    id: 'reconnect-showed',
    label: '5. Reconnect Call Showed',
    endpointSuffix: 'reconnect-showed',
    description: 'Trigger when a reconnect call is marked as Showed.',
    samplePayload: {
      appointment: {
        id: "app_reconnect_123",
        status: "showed"
      }
    },
    mappingFields: []
  },
  {
    id: 'committed',
    label: '6. Committed Investors + Amount',
    endpointSuffix: 'committed',
    description: 'Trigger when an investor commits. Include the commitment dollar amount.',
    samplePayload: {
      opportunity: {
        id: "opp_123",
        status: "won",
        stage: "Committed",
        contactId: "ghl_123456",
        details: { monetary_value: 50000.00, currency: "USD" }
      }
    },
    mappingFields: [
      { key: 'valueField', label: 'Commitment Amount', placeholder: 'opportunity.details.monetary_value', expectedType: 'number', group: 'value', helperText: 'Dollar amount of commitment' }
    ]
  },
  {
    id: 'funded',
    label: '7. Funded Investors + Amount',
    endpointSuffix: 'funded',
    description: 'Trigger when funds are received. Include the funded dollar amount.',
    samplePayload: {
      opportunity: {
        id: "opp_555",
        status: "won",
        stage: "Funded",
        contactId: "ghl_123456",
        details: { monetary_value: 50000.00 }
      }
    },
    mappingFields: [
      { key: 'valueField', label: 'Funded Amount', placeholder: 'opportunity.details.monetary_value', expectedType: 'number', group: 'value', helperText: 'Dollar amount funded' }
    ]
  },
  {
    id: 'ad-spend',
    label: '8. Ad Spend & Media Metrics',
    endpointSuffix: 'ad-spend',
    description: 'Push daily ad spend, impressions, clicks, and frequency from ad platforms.',
    samplePayload: {
      report: {
        date: "2024-01-15",
        platform: "facebook",
        metrics: { 
          spend: "145.50", 
          impressions: 4500, 
          clicks: 120,
          frequency: 1.85
        }
      }
    },
    mappingFields: [
      { key: 'valueField', label: 'Spend Amount', placeholder: 'report.metrics.spend', expectedType: 'number', group: 'value' },
      { key: 'dateField', label: 'Date Field', placeholder: 'report.date', expectedType: 'date', group: 'other' },
      { key: 'impressionsField' as any, label: 'Impressions', placeholder: 'report.metrics.impressions', expectedType: 'number', group: 'value' },
      { key: 'clicksField' as any, label: 'Clicks', placeholder: 'report.metrics.clicks', expectedType: 'number', group: 'value' },
      { key: 'frequencyField' as any, label: 'Frequency', placeholder: 'report.metrics.frequency', expectedType: 'number', group: 'value', helperText: 'Average times ad shown per person' }
    ]
  },
  {
    id: 'bad-lead',
    label: '9. Bad Leads',
    endpointSuffix: 'bad-lead',
    description: 'Trigger to mark a lead as spam or unqualified.',
    samplePayload: {
      event: {
        contact_id: "ghl_123456",
        disposition: { reason: "spam", notes: "Bot traffic detected" }
      }
    },
    mappingFields: []
  },
];

export function useWebhookLogs(clientId: string | undefined) {
  return useQuery({
    queryKey: ['webhook-logs', clientId],
    queryFn: async () => {
      if (!clientId) return [];
      
      const { data, error } = await supabase
        .from('webhook_logs')
        .select('*')
        .eq('client_id', clientId)
        .order('processed_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data as WebhookLog[];
    },
    enabled: !!clientId,
    refetchInterval: 30000,
  });
}

export function useWebhookMappings(clientId: string | undefined) {
  return useQuery({
    queryKey: ['webhook-mappings', clientId],
    queryFn: async () => {
      if (!clientId) return {};
      
      const { data, error } = await supabase
        .from('client_settings')
        .select('webhook_mappings')
        .eq('client_id', clientId)
        .maybeSingle();
      
      if (error) throw error;
      return (data?.webhook_mappings || {}) as Record<string, WebhookMapping>;
    },
    enabled: !!clientId,
  });
}

export function useUpdateWebhookMappings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      clientId,
      mappings
    }: {
      clientId: string;
      mappings: Record<string, WebhookMapping>;
    }) => {
      // First check if settings exist
      const { data: existing } = await supabase
        .from('client_settings')
        .select('id')
        .eq('client_id', clientId)
        .maybeSingle();

      let result;
      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from('client_settings')
          .update({ webhook_mappings: mappings as any })
          .eq('client_id', clientId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('client_settings')
          .insert({ client_id: clientId, webhook_mappings: mappings as any })
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      return result;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['webhook-mappings', variables.clientId] });
      toast.success('Webhook mappings saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save mappings: ${error.message}`);
    },
  });
}

export function useClearWebhookLogs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from('webhook_logs')
        .delete()
        .eq('client_id', clientId);

      if (error) throw error;
    },
    onSuccess: (_, clientId) => {
      queryClient.invalidateQueries({ queryKey: ['webhook-logs', clientId] });
      toast.success('Webhook logs cleared');
    },
    onError: (error: Error) => {
      toast.error(`Failed to clear logs: ${error.message}`);
    },
  });
}

export function useClientWebhookSecret(clientId: string | undefined) {
  return useQuery({
    queryKey: ['client-webhook-secret', clientId],
    queryFn: async () => {
      if (!clientId) return null;
      
      const { data, error } = await supabase
        .from('clients')
        .select('webhook_secret')
        .eq('id', clientId)
        .single();
      
      if (error) throw error;
      return data?.webhook_secret as string | null;
    },
    enabled: !!clientId,
  });
}

export function useRegenerateWebhookSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      // Generate a new secret on the client side
      const newSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const { error } = await supabase
        .from('clients')
        .update({ webhook_secret: newSecret })
        .eq('id', clientId);

      if (error) throw error;
      return newSecret;
    },
    onSuccess: (_, clientId) => {
      queryClient.invalidateQueries({ queryKey: ['client-webhook-secret', clientId] });
      toast.success('Webhook secret regenerated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to regenerate secret: ${error.message}`);
    },
  });
}

// Hook for live testing - waits for real webhook to arrive
export function useLiveWebhookTest(clientId: string | undefined, webhookType: string | null) {
  const [isListening, setIsListening] = useState(false);
  const [receivedPayload, setReceivedPayload] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  const TEST_DURATION = 120; // 2 minutes

  // Poll for new webhook logs when listening
  const { data: logs, refetch } = useQuery({
    queryKey: ['live-test-logs', clientId, webhookType, startTime],
    queryFn: async () => {
      if (!clientId || !webhookType || !startTime) return [];
      
      const startDate = new Date(startTime).toISOString();
      const { data, error } = await supabase
        .from('webhook_logs')
        .select('*')
        .eq('client_id', clientId)
        .eq('webhook_type', webhookType)
        .gte('processed_at', startDate)
        .order('processed_at', { ascending: false })
        .limit(1);
      
      if (error) throw error;
      return data as WebhookLog[];
    },
    enabled: isListening && !!clientId && !!webhookType && !!startTime,
    refetchInterval: isListening ? 3000 : false,
  });

  // Check for new webhook
  useEffect(() => {
    if (logs && logs.length > 0 && isListening) {
      const log = logs[0];
      try {
        const payload = log.payload ? JSON.parse(log.payload) : null;
        setReceivedPayload(payload);
        setIsListening(false);
        toast.success('Webhook received! You can now map the fields.');
      } catch {
        setReceivedPayload(log.payload);
      }
    }
  }, [logs, isListening]);

  // Timer countdown
  useEffect(() => {
    if (!isListening || !startTime) return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = TEST_DURATION - elapsed;
      
      if (remaining <= 0) {
        setIsListening(false);
        setTimeRemaining(0);
        toast.error('Test timed out. No webhook received within 2 minutes.');
      } else {
        setTimeRemaining(remaining);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isListening, startTime]);

  const startListening = useCallback(() => {
    setReceivedPayload(null);
    setStartTime(Date.now());
    setTimeRemaining(TEST_DURATION);
    setIsListening(true);
    toast.info('Listening for webhook... Send a webhook from GoHighLevel within 2 minutes.');
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);
    setTimeRemaining(0);
  }, []);

  const clearPayload = useCallback(() => {
    setReceivedPayload(null);
    setStartTime(null);
  }, []);

  return {
    isListening,
    receivedPayload,
    timeRemaining,
    startListening,
    stopListening,
    clearPayload,
  };
}

// Helper to extract all paths from a JSON object
export function extractJsonPaths(obj: any, prefix = ''): string[] {
  const paths: string[] = [];
  
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const key of Object.keys(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      paths.push(path);
      
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        paths.push(...extractJsonPaths(obj[key], path));
      }
    }
  }
  
  return paths;
}

// Helper to get value from nested path
export function getValueByPath(obj: any, path: string): any {
  if (!path || !obj) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
    } else {
      current = current[part];
    }
  }
  return current;
}
