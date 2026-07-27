import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type JournalEntry = {
  id: string;
  client_id: string;
  agent_id: string;
  entry_type: "run" | "reflection" | "lesson" | "note";
  scope: "daily" | "weekly" | "monthly" | "adhoc";
  title: string;
  body_md: string;
  metadata: Record<string, any>;
  tokens_used: number | null;
  cost_usd: number | null;
  created_at: string;
};

export function useAgentJournal(clientId: string | null, agentId: string | null) {
  return useQuery({
    queryKey: ["agent_journal", clientId, agentId],
    enabled: !!clientId && !!agentId,
    queryFn: async (): Promise<JournalEntry[]> => {
      const { data, error } = await (supabase as any)
        .from("client_agent_journal")
        .select("*")
        .eq("client_id", clientId)
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as JournalEntry[];
    },
  });
}

export function useAddJournalNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { client_id: string; agent_id: string; title: string; body_md: string }) => {
      const { error } = await supabase.functions.invoke("agent-journal", {
        body: { action: "log", entry_type: "note", scope: "adhoc", ...input },
      });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["agent_journal", v.client_id, v.agent_id] });
      toast.success("Note added to journal");
    },
    onError: (e: any) => toast.error(`Add failed: ${e?.message || e}`),
  });
}

export function useDeleteJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; client_id: string; agent_id: string }) => {
      const { error } = await (supabase as any).from("client_agent_journal").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["agent_journal", v.client_id, v.agent_id] }),
  });
}

export function useReflectAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { client_id: string; agent_id: string; window_days: number }) => {
      const { data, error } = await supabase.functions.invoke("agent-journal", {
        body: { action: "reflect", ...input },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { reflection: string; new_rules: string; entries_reviewed: number };
    },
    onSuccess: (data, v) => {
      qc.invalidateQueries({ queryKey: ["agent_journal", v.client_id, v.agent_id] });
      qc.invalidateQueries({ queryKey: ["client_agent_override", v.client_id, v.agent_id] });
      toast.success(`Reflection saved · ${data.entries_reviewed} entries reviewed${data.new_rules ? " · memory updated" : ""}`);
    },
    onError: (e: any) => toast.error(`Reflection failed: ${e?.message || e}`),
  });
}