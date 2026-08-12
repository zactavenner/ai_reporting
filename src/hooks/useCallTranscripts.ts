import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CallTranscriptRecord {
  id: string;
  client_id: string | null;
  call_id: string;
  provider: string | null;
  appointment_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  assigned_user: string | null;
  assigned_user_phone: string | null;
  campaign: string | null;
  direction: string | null;
  call_status: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  connected: boolean | null;
  recording_url: string | null;
  transcript: string | null;
  speaker_segments: { speaker: string; text: string }[] | null;
  transcription_status: string;
  transcription_error: string | null;
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
  commitment_level: string | null;
  tags: string[] | null;
  analyzed_at: string | null;
  ghl_synced_at: string | null;
  created_at: string;
}

interface Filters {
  startDate?: string;
  endDate?: string;
  clientId?: string;
  search?: string;
}

export function useCallTranscripts(filters: Filters = {}) {
  return useQuery({
    queryKey: ['call-transcripts', filters],
    queryFn: async () => {
      let query = (supabase.from('phone_call_records' as any) as any)
        .select('*')
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(1000);

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
          `transcript.ilike.%${term}%,summary.ilike.%${term}%,contact_name.ilike.%${term}%,next_step.ilike.%${term}%`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as CallTranscriptRecord[];
    },
    refetchInterval: 60_000,
  });
}

/** Re-run transcription + AI analysis for a single call record. */
export function useReprocessCall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, analyzeOnly }: { recordId: string; analyzeOnly?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('call-transcription', {
        body: {
          password: 'HPA1234$',
          action: analyzeOnly ? 'analyze_only' : 'reprocess',
          record_id: recordId,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success('Call processed');
      queryClient.invalidateQueries({ queryKey: ['call-transcripts'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Processing failed'),
  });
}

/** Kick the pending-queue worker manually. */
export function useProcessPendingCalls() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('call-transcription', {
        body: { password: 'HPA1234$', action: 'process_pending', limit: 10 },
      });
      if (error) throw error;
      return data as { processed: number };
    },
    onSuccess: (data) => {
      toast.success(`Processed ${data?.processed ?? 0} pending call(s)`);
      queryClient.invalidateQueries({ queryKey: ['call-transcripts'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Queue run failed'),
  });
}
