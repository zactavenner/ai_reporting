import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const sb = supabase as any;

export type AgentConnectorKind =
  | "supabase_table"
  | "supabase_composite"
  | "webhook"
  | "storage";

export type AgentConnector = {
  id: string;
  agent_id: string;
  client_id: string | null;
  kind: AgentConnectorKind;
  label: string;
  target: string;
  filters: Record<string, any>;
  row_limit: number;
  refresh_interval_minutes: number;
  is_active: boolean;
  last_tested_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_row_count: number | null;
  created_at: string;
  updated_at: string;
};

export type ConnectorTestResult = {
  connector_id: string;
  label: string;
  kind: string;
  target: string;
  status: "ok" | "error";
  row_count?: number;
  duration_ms?: number;
  sample?: any;
  error?: string;
};

export const CONNECTOR_KINDS: { value: AgentConnectorKind; label: string; hint: string }[] = [
  { value: "supabase_table", label: "Database table", hint: "Query a table directly (e.g. daily_metrics)" },
  { value: "supabase_composite", label: "Composite action", hint: "Aggregate function (e.g. get_top_performers)" },
  { value: "webhook", label: "Webhook feed", hint: "Recent webhook_logs rows for a source" },
  { value: "storage", label: "Storage bucket", hint: "List files in a bucket (e.g. creatives)" },
];

export const CONNECTOR_TARGET_SUGGESTIONS: Record<AgentConnectorKind, string[]> = {
  supabase_table: [
    "clients", "daily_metrics", "leads", "calls", "funded_investors",
    "meta_campaigns", "meta_ad_sets", "meta_ads", "creatives", "tasks",
    "client_funnel_steps", "pipeline_opportunities", "chat_conversations",
    "alert_configs", "data_discrepancies",
  ],
  supabase_composite: [
    "get_top_performers", "get_client_source_metrics", "get_client_spend_days",
    "get_client_spend_freshness", "get_sync_queue_stats", "agent_cost_mtd",
    "find_unenriched_leads",
  ],
  webhook: ["ghl", "meta", "stripe"],
  storage: ["creatives", "task-files", "gpt-files", "live-ads", "agent-files"],
};

function key(agentId: string | null, clientId: string | null) {
  return ["agent_connectors", agentId, clientId];
}

export function useAgentConnectors(agentId: string | null, clientId: string | null = null) {
  return useQuery({
    queryKey: key(agentId, clientId),
    enabled: !!agentId,
    queryFn: async (): Promise<AgentConnector[]> => {
      let q = sb.from("agent_connectors").select("*").eq("agent_id", agentId).order("created_at", { ascending: true });
      q = clientId === null ? q.is("client_id", null) : q.or(`client_id.is.null,client_id.eq.${clientId}`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as AgentConnector[];
    },
  });
}

export function useSaveAgentConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<AgentConnector> & { agent_id: string }) => {
      const { id, ...payload } = input as any;
      const { data, error } = id
        ? await sb.from("agent_connectors").update(payload).eq("id", id).select().single()
        : await sb.from("agent_connectors").insert(payload).select().single();
      if (error) throw error;
      return data as AgentConnector;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["agent_connectors", vars.agent_id, null] });
      qc.invalidateQueries({ queryKey: ["agent_connectors", vars.agent_id, vars.client_id ?? null] });
      toast.success("Connector saved");
    },
    onError: (e: any) => toast.error(`Save failed: ${e?.message || e}`),
  });
}

export function useDeleteAgentConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; agent_id: string; client_id: string | null }) => {
      const { error } = await sb.from("agent_connectors").delete().eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (vars) => {
      qc.invalidateQueries({ queryKey: ["agent_connectors", vars.agent_id, null] });
      qc.invalidateQueries({ queryKey: ["agent_connectors", vars.agent_id, vars.client_id] });
      toast.success("Connector removed");
    },
    onError: (e: any) => toast.error(`Delete failed: ${e?.message || e}`),
  });
}

export function useTestAgentConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { connector_id?: string; agent_id?: string; client_id: string | null }) => {
      const { data, error } = await supabase.functions.invoke("agent-connector-run", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return ((data as any).results || []) as ConnectorTestResult[];
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["agent_connectors"] }),
    onError: (e: any) => toast.error(`Connector test failed: ${e?.message || e}`),
  });
}
