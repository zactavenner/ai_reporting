import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';

export interface LeadQuestion {
  question: string;
  answer: any;
  source: string;
}

export interface GHLNote {
  id: string;
  body: string;
  userId?: string;
  dateAdded: string;
}

export interface Lead {
  id: string;
  client_id: string;
  external_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string | null;
  is_spam: boolean | null;
  created_at: string;
  updated_at: string;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  assigned_user?: string | null;
  pipeline_value?: number | null;
  custom_fields?: Record<string, any> | null;
  questions?: any[] | null;
  campaign_name?: string | null;
  ad_set_name?: string | null;
  ad_id?: string | null;
  ghl_synced_at?: string | null;
  ghl_notes?: GHLNote[] | null;
  opportunity_status?: string | null;
  opportunity_stage?: string | null;
  opportunity_stage_id?: string | null;
  opportunity_value?: number | null;
}

export interface Call {
  id: string;
  client_id: string;
  lead_id: string | null;
  external_id: string;
  scheduled_at: string | null;
  booked_at: string | null;
  showed: boolean | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
  is_reconnect?: boolean;
  recording_url?: string | null;
  summary?: string | null;
  quality_score?: number | null;
  transcript?: string | null;
  direction?: 'inbound' | 'outbound' | null;
  ghl_synced_at?: string | null;
  ghl_appointment_id?: string | null;
  ghl_calendar_id?: string | null;
  appointment_status?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

export function useLeads(clientId?: string, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['leads', clientId, startDate, endDate],
    queryFn: async () => {
      const data = await fetchAllRows((sb) => {
        let query = sb
          .from('leads')
          .select('*')
          .order('created_at', { ascending: false });
        
        if (clientId) {
          query = query.eq('client_id', clientId);
        }

        if (startDate) {
          query = query.gte('created_at', startDate + 'T00:00:00.000Z');
        }
        if (endDate) {
          const endNext = new Date(endDate + 'T00:00:00.000Z');
          endNext.setUTCDate(endNext.getUTCDate() + 1);
          query = query.lt('created_at', endNext.toISOString());
        }
        
        return query;
      });

      return data.map(lead => ({
        ...lead,
        ghl_notes: Array.isArray(lead.ghl_notes) ? (lead.ghl_notes as unknown as GHLNote[]) : null,
      })) as Lead[];
    },
  });
}

export function useCalls(clientId?: string, showedOnly?: boolean, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['calls', clientId, showedOnly, startDate, endDate],
    queryFn: async () => {
      // Fetch calls booked in date range (for "Booked" count)
      const bookedCalls = await fetchAllRows((sb) => {
        let query = sb
          .from('calls')
          .select('*')
          .order('booked_at', { ascending: false });

        if (clientId) {
          query = query.eq('client_id', clientId);
        }

        if (showedOnly) {
          query = query.eq('showed', true);
        }

        if (startDate) {
          query = query.gte('booked_at', startDate + 'T00:00:00.000Z');
        }
        if (endDate) {
          const endNext = new Date(endDate + 'T00:00:00.000Z');
          endNext.setUTCDate(endNext.getUTCDate() + 1);
          query = query.lt('booked_at', endNext.toISOString());
        }

        return query;
      });

      // Also fetch showed calls by scheduled_at in date range (matches RPC logic).
      // A call booked earlier but scheduled/attended in this range should count as a show.
      if (startDate && endDate) {
        const scheduledShows = await fetchAllRows((sb) => {
          let query = sb
            .from('calls')
            .select('*')
            .eq('showed', true)
            .order('scheduled_at', { ascending: false });

          if (clientId) {
            query = query.eq('client_id', clientId);
          }

          const endNext = new Date(endDate + 'T00:00:00.000Z');
          endNext.setUTCDate(endNext.getUTCDate() + 1);
          query = query.gte('scheduled_at', startDate + 'T00:00:00.000Z');
          query = query.lt('scheduled_at', endNext.toISOString());

          return query;
        });

        // Merge: include any showed calls from scheduled_at range not already in bookedCalls
        const existingIds = new Set(bookedCalls.map(c => c.id));
        for (const call of scheduledShows) {
          if (!existingIds.has(call.id)) {
            bookedCalls.push(call);
          }
        }
      }

      return bookedCalls as Call[];
    },
  });
}
