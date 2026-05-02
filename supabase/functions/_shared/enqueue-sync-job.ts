// Shared helper for enqueuing sync_queue jobs from any edge function.
// Idempotency: if `idempotency_key` collides, the insert is treated as a no-op
// (the unique index sync_queue_idempotency_key_unique enforces dedup).
//
// Usage:
//   import { enqueueLeadUpsert } from "../_shared/enqueue-sync-job.ts";
//   await enqueueLeadUpsert(supabase, {
//     client_id, external_id, source: "webhook", provider: "ghl",
//     fields: { lead_name, email, phone, ... },
//   });

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type EnqueueLeadUpsertArgs = {
  client_id: string;
  external_id: string;
  source: "webhook" | "cursor_sync" | "master_sync" | "manual" | "reconciliation";
  provider?: "ghl" | "meta" | "manual";
  fields: Record<string, unknown>;
  priority?: number; // 1 = highest, 10 = lowest. Default: webhook=1, others=5
};

function defaultPriority(source: EnqueueLeadUpsertArgs["source"]): number {
  switch (source) {
    case "webhook": return 1;
    case "manual": return 2;
    case "cursor_sync": return 4;
    case "master_sync": return 6;
    case "reconciliation": return 7;
    default: return 5;
  }
}

export async function enqueueLeadUpsert(
  supabase: SupabaseClient,
  args: EnqueueLeadUpsertArgs,
): Promise<{ enqueued: boolean; job_id?: string; reason?: string }> {
  const idempotency_key = `lead_upsert:${args.client_id}:${args.external_id}:${args.source}`;

  const { data, error } = await supabase
    .from("sync_queue")
    .insert({
      client_id: args.client_id,
      sync_type: "lead_upsert",
      source: args.source,
      provider: args.provider ?? null,
      external_id: args.external_id,
      payload: { fields: args.fields, source: args.source, provider: args.provider ?? null },
      idempotency_key,
      priority: args.priority ?? defaultPriority(args.source),
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    // Unique violation = job already enqueued (and possibly already completed)
    if (error.code === "23505") {
      return { enqueued: false, reason: "duplicate_idempotency_key" };
    }
    console.error("[enqueueLeadUpsert] insert failed:", error);
    return { enqueued: false, reason: error.message };
  }

  return { enqueued: true, job_id: data.id };
}
