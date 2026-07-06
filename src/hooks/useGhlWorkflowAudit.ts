import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const STALE_DAYS = 90;

export type ClientAuditRow = {
  clientId: string;
  clientName: string;
  hasCredentials: boolean;
  workflowCount: number;
  publishedCount: number;
  draftCount: number;
  staleCount: number;
  duplicateCount: number;
  lastSyncAt: string | null;
  lastSyncStatus: "success" | "error" | "never";
  lastSyncError: string | null;
};

function isStale(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() > STALE_DAYS * 24 * 60 * 60 * 1000;
}

export function useGhlWorkflowAudit() {
  return useQuery({
    queryKey: ["ghl-workflow-audit"],
    queryFn: async (): Promise<ClientAuditRow[]> => {
      const { data: clients, error: cErr } = await supabase
        .from("clients")
        .select("id, name, ghl_api_key, ghl_location_id, status")
        .in("status", ["active", "onboarding", "paused"])
        .order("name");
      if (cErr) throw cErr;
      const clientIds = (clients ?? []).map((c) => c.id);
      if (clientIds.length === 0) return [];

      const { data: workflows } = await supabase
        .from("ghl_workflows")
        .select("client_id, workflow_id, name_normalized, status, ghl_updated_at")
        .in("client_id", clientIds);

      const { data: runs } = await supabase
        .from("ghl_workflow_sync_runs")
        .select("client_id, status, started_at, error_message")
        .in("client_id", clientIds)
        .order("started_at", { ascending: false });

      const latestRun = new Map<string, { status: string; started_at: string; error_message: string | null }>();
      for (const r of runs ?? []) if (!latestRun.has(r.client_id)) latestRun.set(r.client_id, r);

      const byClient = new Map<string, Array<{ name_normalized: string; status: string | null; ghl_updated_at: string | null }>>();
      for (const w of workflows ?? []) {
        const list = byClient.get(w.client_id) ?? [];
        list.push(w);
        byClient.set(w.client_id, list);
      }

      return (clients ?? []).map((c) => {
        const wfs = byClient.get(c.id) ?? [];
        const dupNames = new Map<string, number>();
        for (const w of wfs) dupNames.set(w.name_normalized, (dupNames.get(w.name_normalized) ?? 0) + 1);
        const dupCount = wfs.filter((w) => (dupNames.get(w.name_normalized) ?? 0) > 1).length;
        const run = latestRun.get(c.id);
        return {
          clientId: c.id,
          clientName: c.name,
          hasCredentials: !!(c.ghl_api_key && c.ghl_location_id),
          workflowCount: wfs.length,
          publishedCount: wfs.filter((w) => w.status === "published").length,
          draftCount: wfs.filter((w) => w.status !== "published").length,
          staleCount: wfs.filter((w) => isStale(w.ghl_updated_at)).length,
          duplicateCount: dupCount,
          lastSyncAt: run?.started_at ?? null,
          lastSyncStatus: (run?.status as "success" | "error") ?? "never",
          lastSyncError: run?.error_message ?? null,
        };
      });
    },
  });
}

export function useRefreshGhlWorkflows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clientId?: string) => {
      const { data, error } = await supabase.functions.invoke("ghl-workflows-audit", {
        body: clientId ? { clientId } : {},
      });
      if (error) throw error;
      return data as { clients: number; workflows: number; successful: number; errors: Array<{ clientName: string; error: string }> };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["ghl-workflow-audit"] });
      qc.invalidateQueries({ queryKey: ["ghl-client-workflows"] });
      const errs = data.errors?.length ?? 0;
      toast.success(`Synced ${data.successful}/${data.clients} clients · ${data.workflows} workflows${errs ? ` · ${errs} errors` : ""}`);
    },
    onError: (e: Error) => toast.error(`Sync failed: ${e.message}`),
  });
}