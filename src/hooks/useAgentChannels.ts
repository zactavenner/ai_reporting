import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AgentChannel = {
  id: string;
  scope: "agency" | "client";
  client_id: string | null;
  agent_id: string | null;
  kind: "agent" | "jarvis-hermes" | "jarvis-team";
  name: string;
  created_at: string;
};

export type AgentMessage = {
  id: string;
  channel_id: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  role: "agent" | "human" | "system";
  user_id: string | null;
  kind:
    | "message"
    | "command"
    | "handoff"
    | "escalation"
    | "task-comment"
    | "tool-call"
    | "model-call";
  body: string | null;
  payload: Record<string, any>;
  task_id: string | null;
  run_id: string | null;
  created_at: string;
};

export function useAgentChannelForAgent(agentId: string | null | undefined, scope: "agency" | "client" = "agency", clientId: string | null = null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["agent_channel", scope, clientId, agentId],
    enabled: !!agentId,
    queryFn: async (): Promise<AgentChannel | null> => {
      let q = (supabase as any)
        .from("agent_channels")
        .select("*")
        .eq("scope", scope)
        .eq("agent_id", agentId)
        .eq("kind", "agent");
      q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      if (data) return data as AgentChannel;
      // auto-create
      const { data: created, error: insErr } = await (supabase as any)
        .from("agent_channels")
        .insert({ scope, client_id: clientId, agent_id: agentId, kind: "agent", name: "#agent-" + (agentId || "").slice(0, 6) })
        .select()
        .single();
      if (insErr) throw insErr;
      qc.invalidateQueries({ queryKey: ["agent_channels"] });
      return created as AgentChannel;
    },
  });
}

export function useAgentMessages(channelId: string | null | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["agent_messages", channelId],
    enabled: !!channelId,
    queryFn: async (): Promise<AgentMessage[]> => {
      const { data, error } = await (supabase as any)
        .from("agent_messages")
        .select("*")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data || []) as AgentMessage[];
    },
  });

  useEffect(() => {
    if (!channelId) return;
    const ch = supabase
      .channel(`agent_messages:${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_messages", filter: `channel_id=eq.${channelId}` },
        () => qc.invalidateQueries({ queryKey: ["agent_messages", channelId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId, qc]);

  return query;
}

export function usePostAgentMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      channel_id: string;
      body: string;
      role?: AgentMessage["role"];
      kind?: AgentMessage["kind"];
      to_agent_id?: string | null;
      task_id?: string | null;
      payload?: Record<string, any>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await (supabase as any).from("agent_messages").insert({
        channel_id: input.channel_id,
        body: input.body,
        role: input.role || "human",
        kind: input.kind || "message",
        to_agent_id: input.to_agent_id || null,
        task_id: input.task_id || null,
        user_id: userData?.user?.id || null,
        payload: input.payload || {},
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["agent_messages", vars.channel_id] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed to post"),
  });
}

export function useAllAgencyChannels() {
  return useQuery({
    queryKey: ["agent_channels", "agency"],
    queryFn: async (): Promise<AgentChannel[]> => {
      const { data, error } = await (supabase as any)
        .from("agent_channels")
        .select("*")
        .eq("scope", "agency")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as AgentChannel[];
    },
  });
}