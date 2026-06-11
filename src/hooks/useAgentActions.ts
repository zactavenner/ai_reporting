import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AgentAction {
  id: string;
  agent_run_id: string | null;
  agent_id: string | null;
  client_id: string;
  client_name?: string;
  action_type: string;
  action_label: string;
  approval_tier: 'auto' | 'approval_slack' | 'approval_ui' | 'manual_only';
  status: 'pending' | 'approved' | 'executed' | 'rejected' | 'failed' | 'rolled_back';
  before_state: Record<string, any>;
  after_state: Record<string, any>;
  rollback_payload: Record<string, any>;
  executed_at: string | null;
  executed_by: string | null;
  error_message: string | null;
  reasoning: string | null;
  confidence: number | null;
  metadata: Record<string, any>;
  created_at: string;
}

export function usePendingActions() {
  return useQuery({
    queryKey: ['agent-actions-pending'],
    queryFn: async (): Promise<AgentAction[]> => {
      const { data, error } = await supabase
        .from('v_pending_agent_actions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as AgentAction[];
    },
    refetchInterval: 30 * 1000,
  });
}

export function useClientActions(clientId: string | undefined, limit = 20) {
  return useQuery({
    queryKey: ['agent-actions', clientId, limit],
    queryFn: async (): Promise<AgentAction[]> => {
      if (!clientId) return [];
      const { data, error } = await supabase
        .from('agent_actions')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as AgentAction[];
    },
    enabled: !!clientId,
  });
}

export function useApproveAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ actionId, approvedBy }: { actionId: string; approvedBy: string }) => {
      const { error } = await supabase
        .from('agent_actions')
        .update({ status: 'approved', executed_by: approvedBy })
        .eq('id', actionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-actions-pending'] });
      queryClient.invalidateQueries({ queryKey: ['agent-actions'] });
    },
  });
}

export function useRejectAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ actionId, rejectedBy }: { actionId: string; rejectedBy: string }) => {
      const { error } = await supabase
        .from('agent_actions')
        .update({ status: 'rejected', executed_by: rejectedBy, executed_at: new Date().toISOString() })
        .eq('id', actionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-actions-pending'] });
      queryClient.invalidateQueries({ queryKey: ['agent-actions'] });
    },
  });
}

export function useRollbackAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (actionId: string) => {
      const { error } = await supabase
        .from('agent_actions')
        .update({ status: 'rolled_back' })
        .eq('id', actionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-actions'] });
    },
  });
}
