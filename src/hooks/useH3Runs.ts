/**
 * Typed hooks for the H3 creative run manager (h3_runs / h3_creatives /
 * h3_script_revisions / h3_creative_events). All transitions go through
 * `transition` so the audit trail is always written alongside the state change.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { H3State, H3RejectionCategory, H3QaResults } from "@/lib/h3Workflow";
import { nextState } from "@/lib/h3Workflow";

export type H3Run = {
  id: string;
  client_id: string | null;
  name: string;
  campaign_ref: string | null;
  notes: string | null;
  requires_counsel_review: boolean;
  created_at: string;
};

export type H3Creative = {
  id: string;
  run_id: string;
  client_id: string | null;
  campaign_ref: string | null;
  concept: string;
  provider: string;
  model: string;
  external_job_id: string | null;
  internal_generation_id: string;
  polling_ref: string | null;
  first_frame_asset_url: string | null;
  prompt: string | null;
  approved_script: string | null;
  approved_script_version: number | null;
  provider_status: string;
  workflow_state: H3State;
  provider_error: string | null;
  cost_amount: number | null;
  cost_currency: string | null;
  source_asset_url: string | null;
  final_asset_url: string | null;
  aspect_ratio: string;
  duration_seconds: number;
  source_resolution: string;
  final_resolution: string;
  audio_expected: boolean;
  transcript: string | null;
  captions_embedded: boolean;
  disclosures_embedded: boolean;
  automated_qa: H3QaResults;
  manual_qa_status: string | null;
  rejection_category: H3RejectionCategory | null;
  rejection_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  counsel_signoff_at: string | null;
  counsel_signoff_by: string | null;
  counsel_review_required: boolean;
  meta_ad_id: string | null;
  created_at: string;
  updated_at: string;
};

export type H3Event = {
  id: string;
  creative_id: string;
  event_type: string;
  from_state: H3State | null;
  to_state: H3State | null;
  detail: Record<string, unknown>;
  created_at: string;
};

const sb = supabase as any;

export function useH3Runs(clientId?: string | null) {
  return useQuery({
    queryKey: ["h3-runs", clientId ?? "all"],
    queryFn: async (): Promise<H3Run[]> => {
      let q = sb.from("h3_runs").select("*").order("created_at", { ascending: false });
      if (clientId) q = q.eq("client_id", clientId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as H3Run[];
    },
  });
}

export function useH3Creatives(runId?: string | null) {
  return useQuery({
    queryKey: ["h3-creatives", runId],
    enabled: !!runId,
    queryFn: async (): Promise<H3Creative[]> => {
      const { data, error } = await sb
        .from("h3_creatives")
        .select("*")
        .eq("run_id", runId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as H3Creative[];
    },
  });
}

export function useH3Events(creativeId?: string | null) {
  return useQuery({
    queryKey: ["h3-events", creativeId],
    enabled: !!creativeId,
    queryFn: async (): Promise<H3Event[]> => {
      const { data, error } = await sb
        .from("h3_creative_events")
        .select("*")
        .eq("creative_id", creativeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as H3Event[];
    },
  });
}

export function useH3ScriptRevisions(creativeId?: string | null) {
  return useQuery({
    queryKey: ["h3-scripts", creativeId],
    enabled: !!creativeId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("h3_script_revisions")
        .select("*")
        .eq("creative_id", creativeId)
        .order("version", { ascending: false });
      if (error) throw error;
      return (data ?? []) as {
        id: string; version: number; script: string; approved: boolean;
        approved_at: string | null; created_at: string;
      }[];
    },
  });
}

async function actor(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

async function logEvent(input: {
  creative_id: string;
  event_type: string;
  from_state?: H3State | null;
  to_state?: H3State | null;
  detail?: Record<string, unknown>;
}) {
  await sb.from("h3_creative_events").insert({
    creative_id: input.creative_id,
    event_type: input.event_type,
    from_state: input.from_state ?? null,
    to_state: input.to_state ?? null,
    detail: input.detail ?? {},
    actor: await actor(),
  });
}

export function useH3Mutations(runId?: string | null) {
  const qc = useQueryClient();
  const invalidate = (creativeId?: string) => {
    qc.invalidateQueries({ queryKey: ["h3-creatives", runId] });
    qc.invalidateQueries({ queryKey: ["h3-runs"] });
    if (creativeId) {
      qc.invalidateQueries({ queryKey: ["h3-events", creativeId] });
      qc.invalidateQueries({ queryKey: ["h3-scripts", creativeId] });
    }
  };

  /** Patch arbitrary creative fields (no state change). */
  const patch = useMutation({
    mutationFn: async ({ id, values, event }: { id: string; values: Partial<H3Creative>; event?: string }) => {
      const { error } = await sb.from("h3_creatives").update(values).eq("id", id);
      if (error) throw error;
      if (event) await logEvent({ creative_id: id, event_type: event, detail: { fields: Object.keys(values) } });
      return id;
    },
    onSuccess: (id) => invalidate(id),
    onError: (e: any) => toast.error("Update failed", { description: e?.message }),
  });

  /** Advance exactly one state. Never skips; DB trigger is the hard guard. */
  const advance = useMutation({
    mutationFn: async ({ creative, values }: { creative: H3Creative; values?: Partial<H3Creative> }) => {
      const to = nextState(creative.workflow_state);
      if (!to) throw new Error("Already at Meta Ready");
      const uid = await actor();
      const stamped: Record<string, unknown> = { workflow_state: to, ...(values ?? {}) };
      if (to === "submitted") { stamped.submitted_at = new Date().toISOString(); stamped.submitted_by = uid; }
      if (to === "approved") { stamped.approved_at = new Date().toISOString(); stamped.approved_by = uid; }
      if (to === "ready_for_review") { stamped.reviewed_at = null; }
      const { error } = await sb.from("h3_creatives").update(stamped).eq("id", creative.id);
      if (error) throw error;
      await logEvent({
        creative_id: creative.id,
        event_type: "transition",
        from_state: creative.workflow_state,
        to_state: to,
      });
      return creative.id;
    },
    onSuccess: (id) => { invalidate(id); toast.success("State advanced"); },
    onError: (e: any) => toast.error("Transition blocked", { description: e?.message }),
  });

  /** Reject → Draft with a required categorized reason. */
  const reject = useMutation({
    mutationFn: async ({ creative, category, reason }: { creative: H3Creative; category: H3RejectionCategory; reason: string }) => {
      if (!reason.trim()) throw new Error("A rejection reason is required");
      const { error } = await sb
        .from("h3_creatives")
        .update({
          workflow_state: "draft",
          rejection_category: category,
          rejection_reason: reason.trim(),
          manual_qa_status: "rejected",
          reviewed_at: new Date().toISOString(),
          reviewed_by: await actor(),
        })
        .eq("id", creative.id);
      if (error) throw error;
      await logEvent({
        creative_id: creative.id,
        event_type: "rejected",
        from_state: creative.workflow_state,
        to_state: "draft",
        detail: { category, reason: reason.trim() },
      });
      return creative.id;
    },
    onSuccess: (id) => { invalidate(id); toast.success("Returned to Draft"); },
    onError: (e: any) => toast.error("Rejection failed", { description: e?.message }),
  });

  const saveScriptRevision = useMutation({
    mutationFn: async ({ creative, script, approve }: { creative: H3Creative; script: string; approve: boolean }) => {
      const { data: rows } = await sb
        .from("h3_script_revisions").select("version").eq("creative_id", creative.id)
        .order("version", { ascending: false }).limit(1);
      const version = ((rows?.[0]?.version as number) ?? 0) + 1;
      const uid = await actor();
      const { error } = await sb.from("h3_script_revisions").insert({
        creative_id: creative.id, version, script, approved: approve,
        approved_by: approve ? uid : null, approved_at: approve ? new Date().toISOString() : null,
        created_by: uid,
      });
      if (error) throw error;
      if (approve) {
        await sb.from("h3_creatives")
          .update({ approved_script: script, approved_script_version: version })
          .eq("id", creative.id);
      }
      await logEvent({
        creative_id: creative.id, event_type: "script_revision",
        detail: { version, approved: approve },
      });
      return creative.id;
    },
    onSuccess: (id) => { invalidate(id); toast.success("Script revision saved"); },
    onError: (e: any) => toast.error("Script save failed", { description: e?.message }),
  });

  const createRun = useMutation({
    mutationFn: async (input: { client_id: string; name: string; campaign_ref?: string }) => {
      const { data, error } = await sb.from("h3_runs").insert({
        client_id: input.client_id, name: input.name,
        campaign_ref: input.campaign_ref || null, created_by: await actor(),
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["h3-runs"] }); toast.success("Run created"); },
    onError: (e: any) => toast.error("Could not create run", { description: e?.message }),
  });

  const createCreative = useMutation({
    mutationFn: async (input: { run_id: string; client_id: string | null; concept: string; campaign_ref?: string | null }) => {
      const { data, error } = await sb.from("h3_creatives").insert({
        run_id: input.run_id, client_id: input.client_id, concept: input.concept,
        campaign_ref: input.campaign_ref ?? null,
      }).select("id").single();
      if (error) throw error;
      await logEvent({ creative_id: data.id, event_type: "created", to_state: "draft" });
      return data.id as string;
    },
    onSuccess: (id) => { invalidate(id); toast.success("Draft creative added"); },
    onError: (e: any) => toast.error("Could not add creative", { description: e?.message }),
  });

  return { patch, advance, reject, saveScriptRevision, createRun, createCreative };
}

/** Server-side provider connection + polling. Never re-submits a pending job. */
export function useH3ProviderConnection() {
  return useQuery({
    queryKey: ["h3-provider-connection"],
    staleTime: 60_000,
    queryFn: async (): Promise<{ connected: boolean; reason: string; provider: string }> => {
      const { data, error } = await supabase.functions.invoke("h3-provider-poll", {
        body: { action: "status" },
      });
      if (error) {
        return { connected: false, reason: "Provider status endpoint unreachable.", provider: "MiniMax Hailuo 3" };
      }
      return data as { connected: boolean; reason: string; provider: string };
    },
  });
}

/**
 * Agency-operator access state. H3 tables are RLS-restricted to JWT subjects
 * allowlisted in reporting_operator_users, so the client cannot read that
 * allowlist itself — the server answers instead. Surfaced honestly in the UI:
 * a non-operator sees a 403, and an empty allowlist sees the bootstrap notice.
 */
export type H3Access = {
  allowed: boolean;
  code?: "missing_token" | "invalid_token" | "not_operator" | "no_operators_provisioned" | "unreachable";
  status?: number;
  error?: string;
};

export function useH3Access() {
  return useQuery({
    queryKey: ["h3-access"],
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<H3Access> => {
      const { data, error } = await supabase.functions.invoke("h3-provider-poll", {
        body: { action: "access" },
      });
      if (error) {
        return {
          allowed: false,
          code: "unreachable",
          error: "Operator authorization endpoint unreachable — H3 access cannot be confirmed.",
        };
      }
      return data as H3Access;
    },
  });
}

export function useH3Poll(runId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (creativeIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("h3-provider-poll", {
        body: { action: "poll", creativeIds },
      });
      if (error) throw error;
      if ((data as any)?.connected === false) throw new Error((data as any).reason);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["h3-creatives", runId] });
      toast.success("Provider polled");
    },
    onError: (e: any) => toast.error("Polling unavailable", { description: e?.message }),
  });
}