import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AgencyAgent = {
  id: string;
  slug: string;
  name: string;
  role: string;
  icon: string | null;
  default_model: string;
  system_prompt: string;
  allowed_creative_types: string[];
  is_active: boolean;
  sort_order: number;
  memory_md?: string | null;
  instructions_md?: string | null;
  connectors?: string[] | null;
  capabilities?: { models?: string[] } | null;
};

export type AgencyAgentTraining = {
  id: string;
  agent_id: string;
  kind: "doc" | "url" | "note" | "example";
  title: string;
  body: string | null;
  file_url: string | null;
  weight: number;
  created_at: string;
};

export type ClientBrain = {
  client_id: string;
  voice: string | null;
  icp: string | null;
  brand_guidelines: string | null;
  do_not_say: string | null;
  learnings: any[];
};

export type OfferTraining = {
  id: string;
  offer_id: string;
  client_id: string | null;
  creative_type: "static" | "video" | "copy" | "reporting" | "media_buying";
  title: string;
  body: string | null;
  asset_url: string | null;
  weight: number;
};

export const AGENCY_AGENT_MODELS = [
  { value: "openrouter/owl-alpha", label: "Owl Alpha (default)" },
  { value: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "openai/gpt-5", label: "GPT-5" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
];

export const CREATIVE_TYPES = ["static", "video", "copy", "reporting", "media_buying"] as const;

export function useAgencyAgents() {
  return useQuery({
    queryKey: ["agency_agents"],
    queryFn: async (): Promise<AgencyAgent[]> => {
      const { data, error } = await (supabase as any)
        .from("agency_agents")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as AgencyAgent[];
    },
  });
}

export function useUpdateAgencyAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<AgencyAgent> & { id: string }) => {
      const { id, ...patch } = input;
      const { error } = await (supabase as any).from("agency_agents").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agency_agents"] });
      toast.success("Agent updated");
    },
    onError: (e: any) => toast.error(`Update failed: ${e?.message || e}`),
  });
}

export function useAgencyAgentTraining(agentId: string | null) {
  return useQuery({
    queryKey: ["agency_agent_training", agentId],
    enabled: !!agentId,
    queryFn: async (): Promise<AgencyAgentTraining[]> => {
      const { data, error } = await (supabase as any)
        .from("agency_agent_training")
        .select("*")
        .eq("agent_id", agentId)
        .order("weight", { ascending: false });
      if (error) throw error;
      return (data || []) as AgencyAgentTraining[];
    },
  });
}

export function useAddAgencyAgentTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<AgencyAgentTraining, "id" | "created_at">) => {
      const { error } = await (supabase as any).from("agency_agent_training").insert(input);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["agency_agent_training", vars.agent_id] });
      toast.success("Training added");
    },
    onError: (e: any) => toast.error(`Add failed: ${e?.message || e}`),
  });
}

export function useDeleteAgencyAgentTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; agent_id: string }) => {
      const { error } = await (supabase as any).from("agency_agent_training").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["agency_agent_training", vars.agent_id] }),
  });
}

export function useClientBrain(clientId: string | null) {
  return useQuery({
    queryKey: ["client_brain", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<ClientBrain | null> => {
      const { data, error } = await (supabase as any)
        .from("client_brain")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return (data as ClientBrain) || null;
    },
  });
}

export function useUpsertClientBrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<ClientBrain> & { client_id: string }) => {
      const { error } = await (supabase as any).from("client_brain").upsert(input, { onConflict: "client_id" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["client_brain", vars.client_id] });
      toast.success("Client brain saved");
    },
    onError: (e: any) => toast.error(`Save failed: ${e?.message || e}`),
  });
}

export function useOfferTraining(offerId: string | null) {
  return useQuery({
    queryKey: ["client_offer_training", offerId],
    enabled: !!offerId,
    queryFn: async (): Promise<OfferTraining[]> => {
      const { data, error } = await (supabase as any)
        .from("client_offer_training")
        .select("*")
        .eq("offer_id", offerId)
        .order("weight", { ascending: false });
      if (error) throw error;
      return (data || []) as OfferTraining[];
    },
  });
}

export function useAddOfferTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<OfferTraining, "id">) => {
      const { error } = await (supabase as any).from("client_offer_training").insert(input);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["client_offer_training", vars.offer_id] });
      toast.success("Offer training added");
    },
    onError: (e: any) => toast.error(`Add failed: ${e?.message || e}`),
  });
}

export function useDeleteOfferTraining() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; offer_id: string }) => {
      const { error } = await (supabase as any).from("client_offer_training").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["client_offer_training", vars.offer_id] }),
  });
}