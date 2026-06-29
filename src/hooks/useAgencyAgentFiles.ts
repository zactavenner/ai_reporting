import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { bytesToTokensApprox } from "@/lib/modelRegistry";

export type AgencyAgentFile = {
  id: string;
  agent_id: string;
  client_id: string | null;
  name: string;
  mime: string | null;
  size_bytes: number;
  lines: number | null;
  storage_path: string;
  created_at: string;
};

function queryKey(agentId: string | null, clientId: string | null) {
  return ["agency_agent_files", agentId, clientId];
}

/**
 * Lists files for an agent. When `clientId` is null we get the *master* files
 * (client_id IS NULL). When given, we get the master files PLUS the per-client
 * addendum, both labelled via `scope`.
 */
export function useAgencyAgentFiles(agentId: string | null, clientId: string | null = null) {
  return useQuery({
    queryKey: queryKey(agentId, clientId),
    enabled: !!agentId,
    queryFn: async (): Promise<(AgencyAgentFile & { scope: "master" | "client" })[]> => {
      let q = (supabase as any)
        .from("agency_agent_files")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false });
      if (clientId === null) q = q.is("client_id", null);
      else q = q.or(`client_id.is.null,client_id.eq.${clientId}`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: AgencyAgentFile) => ({
        ...r,
        scope: r.client_id ? "client" : "master",
      }));
    },
  });
}

export function useUploadAgencyAgentFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { agentId: string; clientId: string | null; file: File }) => {
      const { agentId, clientId, file } = input;
      const ext = file.name.split(".").pop() || "bin";
      const path = `${agentId}/${clientId || "master"}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("agent-files").upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
      if (up.error) throw up.error;

      // Try a quick line count for text-ish files
      let lines: number | null = null;
      if (file.size < 2_000_000 && /text|json|markdown|csv|md|yaml|xml|html/i.test(file.type || file.name)) {
        try { lines = (await file.text()).split(/\r?\n/).length; } catch { /* ignore */ }
      }

      const { error } = await (supabase as any).from("agency_agent_files").insert({
        agent_id: agentId,
        client_id: clientId,
        name: file.name,
        mime: file.type || null,
        size_bytes: file.size,
        lines,
        storage_path: path,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: queryKey(vars.agentId, null) });
      qc.invalidateQueries({ queryKey: queryKey(vars.agentId, vars.clientId) });
      toast.success("File uploaded");
    },
    onError: (e: any) => toast.error(`Upload failed: ${e?.message || e}`),
  });
}

export function useDeleteAgencyAgentFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; storage_path: string; agentId: string; clientId: string | null }) => {
      await supabase.storage.from("agent-files").remove([input.storage_path]).catch(() => {});
      const { error } = await (supabase as any).from("agency_agent_files").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: queryKey(vars.agentId, null) });
      qc.invalidateQueries({ queryKey: queryKey(vars.agentId, vars.clientId) });
    },
  });
}

export function useAgentFileSignedUrl() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage.from("agent-files").createSignedUrl(path, 60 * 30);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

/** Approx token usage for the capacity bar. */
export function totalTokensForFiles(files: { size_bytes: number }[]): number {
  return files.reduce((sum, f) => sum + bytesToTokensApprox(f.size_bytes), 0);
}