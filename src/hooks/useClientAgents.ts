import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AgentType = "creatives" | "copy" | "strategy" | "custom";

export interface ClientAgent {
  id: string;
  client_id: string;
  handle: string;
  name: string;
  agent_type: AgentType;
  model: string | null;
  system_prompt: string | null;
  knowledge_md: string | null;
  reference_files: Array<{ url: string; name: string; mime?: string }> | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientAgentProfile {
  client_id: string;
  profile_md: string;
  brand_kit: Record<string, any>;
  notes: string;
  updated_at?: string;
}

export function useClientAgents(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-agents", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_agents" as any)
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ClientAgent[];
    },
  });
}

export function useClientAgentProfile(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-agent-profile", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_agent_profiles" as any)
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? { client_id: clientId, profile_md: "", brand_kit: {}, notes: "" }) as unknown as ClientAgentProfile;
    },
  });
}

export function useUpsertClientAgentProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: ClientAgentProfile) => {
      const { data, error } = await supabase
        .from("client_agent_profiles" as any)
        .upsert(p, { onConflict: "client_id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["client-agent-profile", vars.client_id] });
      toast.success("Agent folder saved");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });
}

export function useSaveClientAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agent: Partial<ClientAgent> & { client_id: string }) => {
      const payload: any = { ...agent };
      const { data, error } = agent.id
        ? await supabase.from("client_agents" as any).update(payload).eq("id", agent.id).select().single()
        : await supabase.from("client_agents" as any).insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["client-agents", vars.client_id] });
      toast.success("Agent saved");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save agent"),
  });
}

export function useDeleteClientAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, client_id }: { id: string; client_id: string }) => {
      const { error } = await supabase.from("client_agents" as any).delete().eq("id", id);
      if (error) throw error;
      return { client_id };
    },
    onSuccess: ({ client_id }) => {
      qc.invalidateQueries({ queryKey: ["client-agents", client_id] });
      toast.success("Agent removed");
    },
  });
}

/**
 * Find @handle mentions in a message and return the matched agents +
 * a cleaned user text. Used by AI Studio to inject agent context.
 */
export function extractAgentMentions(text: string, agents: ClientAgent[]) {
  const matched: ClientAgent[] = [];
  const lowered = (text || "").toLowerCase();
  for (const a of agents) {
    if (!a.enabled) continue;
    const tag = `@${a.handle.toLowerCase()}`;
    if (lowered.includes(tag)) matched.push(a);
  }
  return matched;
}

export function buildAgentContextBlock(agents: ClientAgent[]): string {
  if (!agents.length) return "";
  const blocks = agents.map((a) => {
    const parts: string[] = [];
    parts.push(`### Agent: ${a.name} (@${a.handle}) — type: ${a.agent_type}`);
    if (a.system_prompt?.trim()) parts.push(`Role / system instructions:\n${a.system_prompt.trim()}`);
    if (a.knowledge_md?.trim()) parts.push(`Knowledge base:\n${a.knowledge_md.trim()}`);
    if (a.reference_files?.length) {
      parts.push(
        `Reference files:\n${a.reference_files.map((f) => `- ${f.name}: ${f.url}`).join("\n")}`,
      );
    }
    return parts.join("\n\n");
  });
  return `You are operating as the following client agent(s). Follow their role and use their knowledge as the primary source of truth for this turn.\n\n${blocks.join(
    "\n\n---\n\n",
  )}\n\n---\nUser request follows:\n`;
}