import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface AiCallRecord {
  id: string;
  client_id: string | null;
  call_id: string;
  provider: string | null;
  ai_agent: string | null;
  is_ai_caller: boolean | null;
  appointment_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  assigned_user: string | null;
  campaign: string | null;
  direction: string | null;
  call_status: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  connected: boolean | null;
  answered: boolean | null;
  qualified: boolean | null;
  appointment_booked: boolean | null;
  appointment_date: string | null;
  appointment_status: string | null;
  follow_up_required: boolean | null;
  recording_url: string | null;
  transcript: string | null;
  speaker_segments: { speaker: string; text: string }[] | null;
  transcription_status: string | null;
  summary: string | null;
  outcome: string | null;
  sentiment: string | null;
  intent_score: number | null;
  next_step: string | null;
  follow_up_date: string | null;
  objections: string[] | null;
  important_quotes: string[] | null;
  investment_amount: number | null;
  investment_range: string | null;
  investment_timeline: string | null;
  accredited: string | null;
  tags: string[] | null;
  analyzed_at: string | null;
  created_at: string;
}

export interface AiCallerFilters {
  clientId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
}

/** All AI-placed outbound calls for a client (transcript-searchable). */
export function useAiCallerCalls(filters: AiCallerFilters = {}) {
  return useQuery({
    queryKey: ['ai-caller-calls', filters],
    queryFn: async () => {
      let query = (supabase.from('phone_call_records' as any) as any)
        .select('*')
        .eq('is_ai_caller', true)
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(2000);

      if (filters.clientId) query = query.eq('client_id', filters.clientId);
      if (filters.startDate) query = query.gte('started_at', `${filters.startDate}T00:00:00.000Z`);
      if (filters.endDate) {
        const next = new Date(`${filters.endDate}T00:00:00.000Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        query = query.lt('started_at', next.toISOString());
      }
      if (filters.search?.trim()) {
        const term = filters.search.trim().replace(/[%,]/g, ' ');
        query = query.or(
          `transcript.ilike.%${term}%,summary.ilike.%${term}%,contact_name.ilike.%${term}%,contact_phone.ilike.%${term}%,next_step.ilike.%${term}%`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AiCallRecord[];
    },
    refetchInterval: 60_000,
  });
}

/** Re-run transcription + AI analysis for one AI call. */
export function useReanalyzeAiCall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string) => {
      const { data, error } = await supabase.functions.invoke('ai-caller-webhook', {
        body: { password: 'HPA1234$', action: 'analyze', record_id: recordId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success('Call re-analyzed');
      queryClient.invalidateQueries({ queryKey: ['ai-caller-calls'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Analysis failed'),
  });
}

/** Update appointment status on an AI-booked appointment. */
export function useUpdateAiCallAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, status }: { recordId: string; status: string }) => {
      const { error } = await (supabase.from('phone_call_records' as any) as any)
        .update({ appointment_status: status })
        .eq('id', recordId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Appointment updated');
      queryClient.invalidateQueries({ queryKey: ['ai-caller-calls'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Update failed'),
  });
}
