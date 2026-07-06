import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STALE_DAYS } from "./useGhlWorkflowAudit";

export type WorkflowRow = {
  workflow_id: string;
  name: string;
  name_normalized: string;
  status: string | null;
  version: number | null;
  ghl_created_at: string | null;
  ghl_updated_at: string | null;
  fetched_at: string;
  isStale: boolean;
  isDraft: boolean;
  isDuplicate: boolean;
  hasChanges: boolean;
  recentChanges: Array<{ field: string; old_value: string | null; new_value: string | null; changed_at: string }>;
};

export function useGhlClientWorkflows(clientId: string | null) {
  return useQuery({
    queryKey: ["ghl-client-workflows", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<WorkflowRow[]> => {
      const { data: workflows, error } = await supabase
        .from("ghl_workflows")
        .select("workflow_id, name, name_normalized, status, version, ghl_created_at, ghl_updated_at, fetched_at")
        .eq("client_id", clientId!)
        .order("name");
      if (error) throw error;

      const { data: history } = await supabase
        .from("ghl_workflow_history")
        .select("workflow_id, field, old_value, new_value, changed_at")
        .eq("client_id", clientId!)
        .order("changed_at", { ascending: false })
        .limit(500);

      const historyByWf = new Map<string, Array<{ field: string; old_value: string | null; new_value: string | null; changed_at: string }>>();
      for (const h of history ?? []) {
        const list = historyByWf.get(h.workflow_id) ?? [];
        list.push(h);
        historyByWf.set(h.workflow_id, list);
      }

      const dupNames = new Map<string, number>();
      for (const w of workflows ?? []) dupNames.set(w.name_normalized, (dupNames.get(w.name_normalized) ?? 0) + 1);

      const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const weekAgo = nowMs - 7 * 24 * 60 * 60 * 1000;

      return (workflows ?? []).map((w) => {
        const changes = historyByWf.get(w.workflow_id) ?? [];
        const recent = changes.filter((c) => new Date(c.changed_at).getTime() > weekAgo);
        return {
          ...w,
          isStale: !!w.ghl_updated_at && nowMs - new Date(w.ghl_updated_at).getTime() > staleMs,
          isDraft: w.status !== "published",
          isDuplicate: (dupNames.get(w.name_normalized) ?? 0) > 1,
          hasChanges: recent.length > 0,
          recentChanges: changes.slice(0, 5),
        };
      });
    },
  });
}