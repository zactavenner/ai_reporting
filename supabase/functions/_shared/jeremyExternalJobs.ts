/**
 * Jeremy external-job ledger — the ONLY way paid or external work happens.
 *
 * Every Apify discovery run, image generation, video generation and PAUSED Meta
 * publication is first QUOTED (cost + exact target), then explicitly APPROVED by
 * an operator, then atomically CLAIMED exactly once, then executed, then
 * verified and cost-recorded.
 *
 * Invariants enforced deterministically here:
 *  - a quote never consumes the single live idempotency key;
 *  - a job cannot execute without an operator approval record;
 *  - the scheduler may quote/prepare but may never approve paid work;
 *  - the request that executes must match the approved fingerprint exactly;
 *  - policy capability + positive per-run and monthly caps are revalidated at
 *    execution time, not just at quote time;
 *  - an unknown or stale cost refuses to spend.
 *
 * Pure logic + an injected already-authenticated db client, so the whole surface
 * is unit-testable without any provider.
 */
import { checkPaidCapability, type JeremyPolicy, type PaidCapability } from "./jeremyPolicy.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type JeremyJobKind = "apify_discovery" | "image_generation" | "video_generation" | "meta_publish";

export const JEREMY_JOB_KINDS: JeremyJobKind[] = [
  "apify_discovery",
  "image_generation",
  "video_generation",
  "meta_publish",
];

/** Minutes a quote stays valid. A stale quote can never authorise spend. */
export const QUOTE_TTL_MINUTES = 60;

export type JobStatus =
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "verification_failed"
  | "expired";

export interface JeremyExternalJob {
  id: string;
  client_id: string;
  cycle_id: string | null;
  candidate_id: string | null;
  launch_id: string | null;
  kind: JeremyJobKind;
  provider: string;
  target: Record<string, unknown>;
  request_fingerprint: string;
  idempotency_key: string;
  status: JobStatus;
  quote: Record<string, unknown>;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  quote_expires_at: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  provider_job_id: string | null;
  provider_response: Record<string, unknown> | null;
  verification: Record<string, unknown> | null;
  result_summary: Record<string, unknown> | null;
  error: string | null;
}

/** The paid capability a job kind consumes. `meta_publish` spends no model credits. */
export function capabilityForKind(kind: JeremyJobKind): PaidCapability | null {
  if (kind === "apify_discovery") return "discovery";
  if (kind === "image_generation" || kind === "video_generation") return "generation";
  return null;
}

const stable = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${k}=${stable((value as Record<string, unknown>)[k])}`)
      .join("&")}}`;
  }
  return String(value);
};

/**
 * The binding fingerprint of an external job: kind + client + the exact target
 * descriptor (targets, result limit, model, candidate, launch). Execution
 * recomputes it and refuses when it differs from the approved row, so a target
 * or model can never be swapped after approval.
 */
export function jobFingerprint(kind: JeremyJobKind, clientId: string, target: Record<string, unknown>): string {
  return `${kind}|${clientId}|${stable(target)}`;
}

/** The ONE stable live key for a job. A second live attempt loses to the unique index. */
export function jobLiveIdempotencyKey(fingerprint: string): string {
  return `live:${fingerprint}`;
}

/**
 * Quotes/dry runs get their own namespaced unique key so they can never consume
 * or race the single live claim.
 */
export function jobQuoteIdempotencyKey(
  fingerprint: string,
  nonce: string = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
): string {
  return `quote:${nonce}:${fingerprint}`;
}

export function isQuoteIdempotencyKey(key: string): boolean {
  return String(key ?? "").startsWith("quote:");
}

export interface QuoteInput {
  clientId: string;
  kind: JeremyJobKind;
  provider: string;
  target: Record<string, unknown>;
  /** Exact maximum cost of the run in USD. NaN/unknown is refused. */
  estimatedCostUsd: number;
  /**
   * Where the price came from (e.g. `jeremy_model_costs`, `apify_settings.config`)
   * and which configured version was used. A quote with no traceable price source
   * is refused, so no cost can be silently asserted from code constants.
   */
  costSource: string;
  costVersion: string;
  cycleId?: string | null;
  candidateId?: string | null;
  launchId?: string | null;
  requestedBy: string;
  quoteDetail?: Record<string, unknown>;
  ttlMinutes?: number;
}

export type QuoteReuseReason = "already_succeeded" | "in_flight" | "active_quote";

export interface QuoteResult {
  success: boolean;
  job?: JeremyExternalJob;
  error?: string;
  /** True when an existing job was returned instead of creating a new quote. */
  reused?: boolean;
  reuse_reason?: QuoteReuseReason;
  /** Why the paid capability gate would allow/refuse this job right now. */
  policy_gate?: { allowed: boolean; reason: string };
}

/** Statuses that still block a fresh quote for the same exact target. */
const ACTIVE_STATUSES = ["awaiting_approval", "approved"];
const IN_FLIGHT_STATUSES = ["claimed", "running"];
/** Statuses after which re-quoting the same target is legitimate. */
export const REQUOTABLE_STATUSES = ["rejected", "failed", "verification_failed", "expired"];

const isTimeExpired = (row: Record<string, unknown>, now: number): boolean => {
  const at = row.quote_expires_at ? Date.parse(String(row.quote_expires_at)) : NaN;
  return Number.isFinite(at) && now > at;
};

/**
 * Creates an awaiting_approval quote for this exact target.
 *
 * A quote NEVER spends and NEVER takes the single live execution key — its
 * idempotency key is quote-namespaced. De-duplication is by
 * (client, fingerprint, status), so:
 *  - a succeeded job is returned as-is (no duplicate execution of the same target);
 *  - an in-flight (claimed/running) job is returned rather than re-quoted;
 *  - an unexpired awaiting/approved quote is returned rather than duplicated;
 *  - a rejected, failed, verification_failed or expired job does NOT block a
 *    fresh quote with a fresh expiry, and any time-expired active quote is first
 *    marked expired so it stops blocking forever.
 */
export async function quoteJob(db: Db, policy: JeremyPolicy, input: QuoteInput): Promise<QuoteResult> {
  const cost = Number(input.estimatedCostUsd);
  if (!Number.isFinite(cost) || cost < 0) {
    return { success: false, error: "Exact cost is unknown; refusing to quote a job that could spend an unbounded amount." };
  }
  const costSource = String(input.costSource ?? "").trim();
  const costVersion = String(input.costVersion ?? "").trim();
  if (!costSource || !costVersion) {
    return {
      success: false,
      error: "Refusing to quote without a configured price source and version; a cost may never be asserted from code constants.",
    };
  }
  const capability = capabilityForKind(input.kind);
  let gate = { allowed: true, reason: "No model/provider credits are spent by this job kind." };
  if (capability) {
    const mtd = await monthToDateJobCost(db, input.clientId, capability);
    const check = checkPaidCapability(policy, capability, cost, mtd);
    gate = { allowed: check.allowed, reason: check.reason };
  }

  const fingerprint = jobFingerprint(input.kind, input.clientId, input.target);
  const now = Date.now();

  const { data: siblings } = await db
    .from("jeremy_external_jobs")
    .select("*")
    .eq("client_id", input.clientId)
    .eq("request_fingerprint", fingerprint);
  const rows = (siblings ?? []) as JeremyExternalJob[];

  const succeeded = rows.find((r) => String(r.status) === "succeeded");
  if (succeeded) {
    return { success: true, job: succeeded, reused: true, reuse_reason: "already_succeeded", policy_gate: gate };
  }
  const inFlight = rows.find((r) => IN_FLIGHT_STATUSES.includes(String(r.status)));
  if (inFlight) {
    return { success: true, job: inFlight, reused: true, reuse_reason: "in_flight", policy_gate: gate };
  }
  const active = rows.find((r) => ACTIVE_STATUSES.includes(String(r.status)) && !isTimeExpired(r as never, now));
  if (active) {
    return { success: true, job: active, reused: true, reuse_reason: "active_quote", policy_gate: gate };
  }
  // Any remaining active-status row is past its expiry: retire it so a fresh,
  // correctly priced quote can be issued.
  for (const stale of rows.filter((r) => ACTIVE_STATUSES.includes(String(r.status)))) {
    await db.from("jeremy_external_jobs").update({ status: "expired" }).eq("id", stale.id).in("status", ACTIVE_STATUSES);
  }

  const ttl = Math.max(1, input.ttlMinutes ?? QUOTE_TTL_MINUTES);
  const { data, error } = await db
    .from("jeremy_external_jobs")
    .insert({
      client_id: input.clientId,
      cycle_id: input.cycleId ?? null,
      candidate_id: input.candidateId ?? null,
      launch_id: input.launchId ?? null,
      kind: input.kind,
      provider: input.provider,
      target: input.target,
      request_fingerprint: fingerprint,
      idempotency_key: jobQuoteIdempotencyKey(fingerprint),
      status: "awaiting_approval",
      estimated_cost_usd: cost,
      quote_expires_at: new Date(now + ttl * 60_000).toISOString(),
      requested_by: input.requestedBy,
      quote: {
        ...(input.quoteDetail ?? {}),
        maximum_cost_usd: cost,
        cost_source: costSource,
        cost_version: costVersion,
        capability,
        policy_gate: gate,
        quoted_at: new Date(now).toISOString(),
        quote_ttl_minutes: ttl,
        live_execution_key: jobLiveIdempotencyKey(fingerprint),
      },
    })
    .select("*")
    .maybeSingle();
  if (error) {
    // The database enforces one non-requotable quote per client+fingerprint, so
    // two concurrent quote attempts cannot both create a row. The loser of the
    // race reads back and reuses the winner instead of failing.
    const conflict = String((error as { code?: string }).code ?? "") === "23505" ||
      /duplicate key|unique constraint/i.test(String(error.message ?? ""));
    if (conflict) {
      const { data: winner } = await db
        .from("jeremy_external_jobs")
        .select("*")
        .eq("client_id", input.clientId)
        .eq("request_fingerprint", fingerprint)
        .not("status", "in", `(${REQUOTABLE_STATUSES.join(",")})`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (winner) {
        return { success: true, job: winner as JeremyExternalJob, reused: true, reuse_reason: "concurrent_quote", policy_gate: gate };
      }
    }
    return { success: false, error: error.message };
  }
  return { success: true, job: data as JeremyExternalJob, reused: false, policy_gate: gate };

}

/**
 * Operator approval. Only status/approved_by/approved_at are written — every
 * binding column is immutable in the database, so an approval can never carry a
 * changed target, price or expiry. The scheduler is refused here as well as at
 * the endpoint, so a self-approving automated caller cannot exist.
 */
export async function approveJob(db: Db, jobId: string, approvedBy: string) {
  const actor = String(approvedBy ?? "").trim();
  if (!actor || /^scheduler/i.test(actor) || actor === "mcp" || actor === "service_role") {
    return { success: false as const, error: "Only an authenticated operator may approve a paid or external job." };
  }
  const { data, error } = await db
    .from("jeremy_external_jobs")
    .update({ status: "approved", approved_by: actor, approved_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "awaiting_approval")
    .select("*")
    .maybeSingle();
  if (error) return { success: false as const, error: error.message };
  if (!data) return { success: false as const, error: "Job not found or no longer awaiting approval." };
  return { success: true as const, job: data as JeremyExternalJob };
}

/** Rejection is recorded in decided_by/decided_at: the approval actor is write-once. */
export async function rejectJob(db: Db, jobId: string, decidedBy: string) {
  const { data, error } = await db
    .from("jeremy_external_jobs")
    .update({ status: "rejected", decided_by: String(decidedBy ?? "operator"), decided_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["awaiting_approval", "approved"])
    .select("id, status")
    .maybeSingle();
  if (error) return { success: false as const, error: error.message };
  return data ? { success: true as const, job: data } : { success: false as const, error: "Job not found or already started." };
}


export interface AuthorizeJobInput {
  clientId: string;
  kind: JeremyJobKind;
  /** Recomputed from the caller's actual request payload. */
  target: Record<string, unknown>;
  actor: string;
  /** A quote/dry run may be authorised without an approval record. */
  dryRun?: boolean;
}

export interface AuthorizeJobResult {
  allowed: boolean;
  reason: string;
  job?: JeremyExternalJob;
  gates: Array<{ gate: string; allowed: boolean; reason: string }>;
}

/**
 * Fail-closed revalidation of every deterministic condition immediately before a
 * provider is touched. Nothing is trusted from the caller except the ids.
 */
export async function authorizeJobExecution(
  db: Db,
  policy: JeremyPolicy,
  jobId: string,
  input: AuthorizeJobInput,
): Promise<AuthorizeJobResult> {
  const gates: AuthorizeJobResult["gates"] = [];
  const deny = (reason: string, job?: JeremyExternalJob): AuthorizeJobResult => ({ allowed: false, reason, job, gates });

  if (!jobId) return deny("An approved external job id is required; ad-hoc provider calls are refused.");

  const { data: job } = await db.from("jeremy_external_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return deny("Unknown job id: no persisted quote/approval record to execute.");
  if (String(job.client_id) !== input.clientId) return deny("Job belongs to a different client; refusing.", job);
  if (String(job.kind) !== input.kind) return deny("Job kind does not match the requested operation; refusing.", job);

  const fingerprint = jobFingerprint(input.kind, input.clientId, input.target);
  if (fingerprint !== String(job.request_fingerprint)) {
    gates.push({ gate: "payload_binding", allowed: false, reason: "Request target/model/limit does not match the approved quote." });
    return deny("Request does not match the approved quote (target, limit, model or candidate changed).", job);
  }
  gates.push({ gate: "payload_binding", allowed: true, reason: "Request matches the approved quote exactly." });

  // Exactly-once per target: a different job that already SUCCEEDED for this
  // fingerprint means the work is done. A second execution requires a genuinely
  // different (newly quoted and approved) target.
  const { data: siblings } = await db
    .from("jeremy_external_jobs")
    .select("id, status")
    .eq("client_id", input.clientId)
    .eq("request_fingerprint", fingerprint)
    .eq("status", "succeeded");
  const done = (siblings ?? []).find((r: Record<string, unknown>) => String(r.id) !== String(jobId));
  if (done) {
    gates.push({ gate: "single_execution", allowed: false, reason: `Job ${done.id} already completed this exact target.` });
    return deny("This exact target has already been executed successfully; change the target or duration to run new work.", job);
  }
  gates.push({ gate: "single_execution", allowed: true, reason: "No prior successful execution of this exact target." });


  if (job.status !== "approved") {
    gates.push({ gate: "approval", allowed: false, reason: `Job status is "${job.status}", not approved.` });
    return deny(`Job is "${job.status}": an explicit operator approval is required before any provider call.`, job);
  }
  if (!job.approved_by || /^scheduler/i.test(String(job.approved_by))) {
    gates.push({ gate: "approval", allowed: false, reason: "No operator approval actor recorded." });
    return deny("The approval record has no operator actor; the scheduler may not approve paid work.", job);
  }
  gates.push({ gate: "approval", allowed: true, reason: `Approved by ${job.approved_by} at ${job.approved_at}.` });

  const expires = job.quote_expires_at ? Date.parse(String(job.quote_expires_at)) : NaN;
  if (Number.isFinite(expires) && Date.now() > expires) {
    await db.from("jeremy_external_jobs").update({ status: "expired" }).eq("id", jobId).eq("status", "approved");
    gates.push({ gate: "quote_freshness", allowed: false, reason: "The approved quote has expired." });
    return deny("The approved cost quote has expired; re-quote and re-approve before spending.", job);
  }
  gates.push({ gate: "quote_freshness", allowed: true, reason: "Quote is within its validity window." });

  const cost = Number(job.estimated_cost_usd);
  if (!Number.isFinite(cost)) {
    gates.push({ gate: "cost_known", allowed: false, reason: "Quoted cost is unknown." });
    return deny("Quoted cost is unknown; refusing to spend.", job);
  }
  gates.push({ gate: "cost_known", allowed: true, reason: `Quoted maximum cost $${cost}.` });

  const capability = capabilityForKind(input.kind);
  if (capability) {
    const mtd = await monthToDateJobCost(db, input.clientId, capability, jobId);
    const check = checkPaidCapability(policy, capability, cost, mtd);
    gates.push({ gate: `paid_${capability}`, allowed: check.allowed, reason: check.reason });
    if (!check.allowed) return deny(check.reason, job);
  } else {
    gates.push({ gate: "paid_capability", allowed: true, reason: "This job spends no model/provider credits." });
  }

  return { allowed: true, reason: "All deterministic gates passed.", job: job as JeremyExternalJob, gates };
}

/**
 * Atomic single-claim. Uses the database RPC when available (real Postgres) and
 * falls back to a conditional UPDATE, which is equally atomic in Postgres.
 */
export async function claimJob(db: Db, jobId: string, claimedBy: string): Promise<JeremyExternalJob | null> {
  if (typeof db.rpc === "function") {
    const { data, error } = await db.rpc("claim_jeremy_external_job", { p_job_id: jobId, p_claimed_by: claimedBy });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as JeremyExternalJob | null;
    }
  }
  const { data } = await db
    .from("jeremy_external_jobs")
    .update({ status: "claimed", claimed_by: claimedBy, claimed_at: new Date().toISOString(), started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "approved")
    .select("*")
    .maybeSingle();
  return (data ?? null) as JeremyExternalJob | null;
}

export async function markJobRunning(db: Db, jobId: string, providerJobId: string | null) {
  await db.from("jeremy_external_jobs").update({ status: "running", provider_job_id: providerJobId }).eq("id", jobId);
}

export async function completeJob(
  db: Db,
  jobId: string,
  patch: {
    status?: "succeeded" | "verification_failed";
    actualCostUsd?: number | null;
    providerJobId?: string | null;
    providerResponse?: Record<string, unknown> | null;
    verification?: Record<string, unknown> | null;
    resultSummary?: Record<string, unknown> | null;
  },
) {
  const { data } = await db
    .from("jeremy_external_jobs")
    .update({
      status: patch.status ?? "succeeded",
      actual_cost_usd: patch.actualCostUsd ?? null,
      provider_job_id: patch.providerJobId ?? null,
      provider_response: patch.providerResponse ?? null,
      verification: patch.verification ?? null,
      result_summary: patch.resultSummary ?? null,
      completed_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", jobId)
    .select("*")
    .maybeSingle();
  return (data ?? null) as JeremyExternalJob | null;
}

export async function failJob(db: Db, jobId: string, message: string, providerResponse?: Record<string, unknown> | null) {
  await db
    .from("jeremy_external_jobs")
    .update({ status: "failed", error: message.slice(0, 2000), provider_response: providerResponse ?? null, completed_at: new Date().toISOString() })
    .eq("id", jobId);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Month-to-date committed cost for a paid capability. Quotes awaiting approval
 * and rejected jobs never count; anything claimed or beyond counts at its actual
 * cost when known, otherwise at its quote.
 */
export async function monthToDateJobCost(
  db: Db,
  clientId: string,
  capability: PaidCapability,
  excludeJobId?: string,
): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data } = await db
    .from("jeremy_external_jobs")
    .select("id, kind, status, estimated_cost_usd, actual_cost_usd")
    .eq("client_id", clientId)
    .gte("created_at", monthStart.toISOString());
  const kinds = capability === "discovery" ? ["apify_discovery"] : ["image_generation", "video_generation"];
  const committed = ["claimed", "running", "succeeded", "verification_failed", "failed"];
  const rows = (data ?? []).filter(
    (r: Record<string, unknown>) =>
      kinds.includes(String(r.kind)) && committed.includes(String(r.status)) && String(r.id) !== String(excludeJobId ?? ""),
  );
  return round2(
    rows.reduce((sum: number, r: Record<string, unknown>) => {
      const actual = Number(r.actual_cost_usd);
      const est = Number(r.estimated_cost_usd);
      return sum + (Number.isFinite(actual) ? actual : Number.isFinite(est) ? est : 0);
    }, 0),
  );
}

export async function getJob(db: Db, jobId: string): Promise<JeremyExternalJob | null> {
  const { data } = await db.from("jeremy_external_jobs").select("*").eq("id", jobId).maybeSingle();
  return (data ?? null) as JeremyExternalJob | null;
}

export async function listJobs(
  db: Db,
  clientId: string,
  opts: { kind?: JeremyJobKind; status?: JobStatus; cycleId?: string; limit?: number } = {},
): Promise<JeremyExternalJob[]> {
  let q = db
    .from("jeremy_external_jobs")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, opts.limit ?? 50)));
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.cycleId) q = q.eq("cycle_id", opts.cycleId);
  const { data } = await q;
  return (data ?? []) as JeremyExternalJob[];
}

/** Cost caps + month-to-date usage, for the operator UI. */
export async function costPosture(db: Db, policy: JeremyPolicy, clientId: string) {
  const [discovery, generation] = await Promise.all([
    monthToDateJobCost(db, clientId, "discovery"),
    monthToDateJobCost(db, clientId, "generation"),
  ]);
  return {
    discovery: {
      enabled: policy.paid_discovery_enabled,
      per_run_cap_usd: policy.paid_discovery_per_run_cap_usd,
      monthly_cap_usd: policy.paid_discovery_monthly_cap_usd,
      month_to_date_usd: discovery,
      remaining_usd: round2(Math.max(0, policy.paid_discovery_monthly_cap_usd - discovery)),
    },
    generation: {
      enabled: policy.paid_generation_enabled,
      per_run_cap_usd: policy.paid_generation_per_run_cap_usd,
      monthly_cap_usd: policy.paid_generation_monthly_cap_usd,
      month_to_date_usd: generation,
      remaining_usd: round2(Math.max(0, policy.paid_generation_monthly_cap_usd - generation)),
    },
  };
}
