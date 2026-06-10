import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type RefKind = "avatar" | "product" | "brand" | "pdf" | "image" | "video" | "doc";

export interface ReferenceItem {
  id: string;
  client_id?: string | null;
  kind: RefKind;
  name: string;
  url: string;
  mime: string | null;
  notes: string | null;
  tags: string[] | null;
  created_at: string;
}

export function useAgencyReferences() {
  return useQuery({
    queryKey: ["agency-references"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agency_references" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ReferenceItem[];
    },
  });
}

export function useClientReferences(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-references", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_references" as any)
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ReferenceItem[];
    },
  });
}

export function useSaveReference(scope: "agency" | "client") {
  const qc = useQueryClient();
  const table = scope === "agency" ? "agency_references" : "client_references";
  return useMutation({
    mutationFn: async (r: Partial<ReferenceItem> & { kind: RefKind; name: string; url: string }) => {
      const { data, error } = await supabase.from(table as any).insert(r as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, vars) => {
      if (scope === "agency") qc.invalidateQueries({ queryKey: ["agency-references"] });
      else qc.invalidateQueries({ queryKey: ["client-references", vars.client_id] });
      toast.success("Reference added");
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });
}

export function useDeleteReference(scope: "agency" | "client") {
  const qc = useQueryClient();
  const table = scope === "agency" ? "agency_references" : "client_references";
  return useMutation({
    mutationFn: async ({ id, client_id }: { id: string; client_id?: string }) => {
      const { error } = await supabase.from(table as any).delete().eq("id", id);
      if (error) throw error;
      return { client_id };
    },
    onSuccess: (res) => {
      if (scope === "agency") qc.invalidateQueries({ queryKey: ["agency-references"] });
      else qc.invalidateQueries({ queryKey: ["client-references", res.client_id] });
    },
  });
}

export function buildMasterReferenceBlock(
  agency: ReferenceItem[] | undefined,
  client: ReferenceItem[] | undefined,
): string {
  const all = [...(agency ?? []), ...(client ?? [])];
  if (!all.length) return "";
  const lines: string[] = ["MASTER REFERENCES (always available; pull from these when relevant):"];
  for (const r of all) {
    const scope = (r as any).client_id ? "client" : "agency";
    lines.push(`- [${scope}/${r.kind}] ${r.name} — ${r.url}${r.notes ? ` (${r.notes})` : ""}`);
  }
  return lines.join("\n") + "\n\n";
}