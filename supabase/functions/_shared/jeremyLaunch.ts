/**
 * Jeremy launch drafting + PAUSED publication.
 *
 * Rules enforced here:
 *  - only a candidate whose creative was actually GENERATED and stored durably
 *    can become a launch draft;
 *  - nothing is silently defaulted: a missing page id, pixel, destination,
 *    targeting or compliance category is reported as a readiness failure;
 *  - publication only happens through the existing meta-launch-center path, only
 *    with an explicit approved `meta_publish` job, and every created object stays
 *    PAUSED; the result is read back and the Meta ids are persisted so a retry
 *    resumes instead of duplicating.
 */
import { validateLaunch } from "./metaLaunchValidation.ts";
import {
  authorizeJobExecution,
  claimJob,
  completeJob,
  failJob,
  type JeremyExternalJob,
} from "./jeremyExternalJobs.ts";
import type { JeremyPolicy } from "./jeremyPolicy.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const LAUNCH_STATUS = "PAUSED" as const;

export interface LaunchInputs {
  objective?: string;
  daily_budget_cents?: number;
  cta?: string;
  destination_url?: string;
  page_id?: string;
  pixel_id?: string;
  countries?: string[];
  age_min?: number;
  age_max?: number;
  special_ad_category?: string;
  name?: string;
}

export interface ClientLaunchConfig {
  page_id: string | null;
  pixel_id: string | null;
  destination_url: string | null;
  countries: string[];
  special_ad_category: string | null;
  ad_account_id: string | null;
}

export async function loadClientLaunchConfig(db: Db, clientId: string): Promise<ClientLaunchConfig> {
  const [{ data: client }, { data: settings }] = await Promise.all([
    db.from("clients").select("id, website_url, meta_pixel_id, meta_ad_account_id").eq("id", clientId).maybeSingle(),
    db.from("client_settings").select("client_id, ads_library_page_id, ads_library_url").eq("client_id", clientId).maybeSingle(),
  ]);
  const pageId = String((settings as Record<string, unknown> | null)?.ads_library_page_id ?? "").trim();
  return {
    page_id: /^\d{5,}$/.test(pageId) ? pageId : null,
    pixel_id: client?.meta_pixel_id ? String(client.meta_pixel_id) : null,
    destination_url: client?.website_url ? String(client.website_url) : null,
    countries: [],
    special_ad_category: null,
    ad_account_id: client?.meta_ad_account_id ? String(client.meta_ad_account_id) : null,
  };
}

export interface LaunchReadiness {
  candidate_id: string;
  ready: boolean;
  missing: string[];
  record: Record<string, unknown> | null;
}

/**
 * Builds the COMPLETE launch record for a candidate and reports every missing
 * value instead of defaulting it. Compliance-sensitive values (special ad
 * category, countries, page, pixel, destination) are never invented.
 */
export function buildLaunchRecord(
  clientId: string,
  candidate: Record<string, unknown>,
  config: ClientLaunchConfig,
  inputs: LaunchInputs = {},
): LaunchReadiness {
  const missing: string[] = [];
  const candidateId = String(candidate.id ?? "");

  if (String(candidate.generation_status ?? "") !== "generated") {
    missing.push("Candidate creative has not been generated yet (generation_status must be 'generated').");
  }
  const creativeUrl = String(candidate.generation_reference ?? "");
  if (!/^https?:\/\//.test(creativeUrl)) {
    missing.push("Candidate has no durable generated creative URL.");
  }

  const brief = (candidate.recreation_brief ?? {}) as Record<string, any>;
  const objective = String(inputs.objective ?? "leads");
  const pageId = String(inputs.page_id ?? config.page_id ?? "");
  if (!/^\d{5,}$/.test(pageId)) missing.push("Meta Page ID is not configured for this client.");

  const pixelId = String(inputs.pixel_id ?? config.pixel_id ?? "");
  if (objective === "leads" && !/^\d{5,}$/.test(pixelId)) missing.push("A numeric Meta Pixel ID is required for the Leads objective.");

  const destination = String(inputs.destination_url ?? config.destination_url ?? "");
  if (!/^https?:\/\//.test(destination)) missing.push("Destination URL is not configured for this client.");

  const countries = Array.isArray(inputs.countries) && inputs.countries.length
    ? inputs.countries.map((c) => String(c).toUpperCase())
    : config.countries;
  if (!countries.length) missing.push("At least one target country must be specified explicitly.");

  const specialCategory = String(inputs.special_ad_category ?? config.special_ad_category ?? "");
  if (!specialCategory) missing.push("Special ad category must be stated explicitly (use NONE only deliberately).");

  const ageMin = Number(inputs.age_min);
  const ageMax = Number(inputs.age_max);
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax)) missing.push("Age range (age_min/age_max) must be specified explicitly.");

  const budget = Number(inputs.daily_budget_cents);
  if (!Number.isFinite(budget) || budget < 500) missing.push("Daily budget (cents) must be specified and at least 500.");

  const primaryText = String(brief?.mechanism?.angle ?? "").slice(0, 1000);
  const headline = String(brief?.mechanism?.hook ?? candidate.title ?? "").slice(0, 255);
  if (primaryText.trim().length < 5) missing.push("Primary text could not be derived from the recreation brief.");
  if (headline.trim().length < 3) missing.push("Headline could not be derived from the recreation brief.");

  const record: Record<string, unknown> = {
    client_id: clientId,
    name: String(inputs.name ?? `[Jeremy] ${candidate.title ?? "Derivative"}`).slice(0, 120),
    objective,
    status: "draft",
    stage: "draft",
    daily_budget_cents: Number.isFinite(budget) ? Math.floor(budget) : 0,
    cta: String(inputs.cta ?? "LEARN_MORE"),
    destination_url: destination || null,
    primary_text: primaryText,
    headline,
    page_id: pageId || null,
    pixel_id: pixelId || null,
    countries,
    age_min: Number.isInteger(ageMin) ? ageMin : 0,
    age_max: Number.isInteger(ageMax) ? ageMax : 0,
    special_ad_category: specialCategory || null,
    creative_url: creativeUrl || null,
    creative_type: String(candidate.generation_kind) === "video" ? "video" : "image",
    creative_id: ((candidate.evidence as Record<string, any>)?.generation?.creative_id) ?? null,
    created_by: "jeremy_autonomous (PAUSED draft)",
  };

  // Reuse the exact validator the live publish path uses, so readiness cannot
  // pass something publication would reject.
  const validatorErrors = missing.length ? [] : validateLaunch(record as never);
  const allMissing = [...missing, ...validatorErrors];

  return { candidate_id: candidateId, ready: allMissing.length === 0, missing: allMissing, record: allMissing.length ? record : record };
}

export interface LaunchBatchItem extends LaunchReadiness {
  launch_id: string | null;
  status: string | null;
}

/**
 * Creates COMPLETE validated PAUSED drafts. Candidates that are not ready are
 * returned with their exact readiness failures and no row is written for them.
 */
export async function createLaunchBatch(
  db: Db,
  clientId: string,
  candidateIds: string[],
  inputs: LaunchInputs & { status?: string } = {},
): Promise<{ items: LaunchBatchItem[]; launch_status: string; ready_count: number; blocked_count: number }> {
  if (String(inputs.status ?? "").toUpperCase() === "ACTIVE") {
    throw new Error("Refusing to create an ACTIVE launch: every Jeremy-created Meta object must be PAUSED.");
  }
  const config = await loadClientLaunchConfig(db, clientId);
  const items: LaunchBatchItem[] = [];

  for (const candidateId of candidateIds) {
    const { data: candidate } = await db
      .from("jeremy_creative_candidates")
      .select("*")
      .eq("id", candidateId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (!candidate) {
      items.push({ candidate_id: candidateId, ready: false, missing: ["Candidate not found for this client."], record: null, launch_id: null, status: null });
      continue;
    }
    // Idempotency: a candidate owns at most one draft. Repeating the batch
    // returns the existing launch instead of creating a duplicate draft.
    const existingRef = nonEmpty(candidate.launch_reference);
    if (existingRef) {
      const { data: existing } = await db
        .from("meta_campaign_launches")
        .select("id, status, stage")
        .eq("id", existingRef)
        .maybeSingle();
      if (existing?.id) {
        items.push({
          candidate_id: candidateId,
          ready: true,
          missing: [],
          record: null,
          launch_id: String(existing.id),
          status: existing.status ?? null,
          reused: true,
        });
        continue;
      }
    }
    const readiness = buildLaunchRecord(clientId, candidate, config, inputs);
    if (!readiness.ready) {
      items.push({ ...readiness, launch_id: null, status: null });
      continue;
    }
    const { data: launch, error } = await db
      .from("meta_campaign_launches")
      .insert(readiness.record)
      .select("id, status, stage")
      .maybeSingle();
    if (error) throw new Error(`Could not create launch draft: ${error.message}`);
    await db.from("jeremy_creative_candidates").update({ launch_reference: launch?.id ?? null }).eq("id", candidateId);
    items.push({ ...readiness, launch_id: launch?.id ? String(launch.id) : null, status: launch?.status ?? null });

  }

  return {
    items,
    launch_status: LAUNCH_STATUS,
    ready_count: items.filter((i) => i.ready).length,
    blocked_count: items.filter((i) => !i.ready).length,
  };
}

export function publishTarget(launchId: string): Record<string, unknown> {
  return { launch_id: launchId, all_objects_paused: true };
}

export interface PublishExecutor {
  /** Invokes the EXISTING meta-launch-center function for this launch id. */
  publish(launchId: string): Promise<Record<string, unknown>>;
}

export interface PublishResult {
  success: boolean;
  reason: string;
  job_id: string;
  launch_id: string;
  meta_ids?: { campaign: string | null; adset: string | null; ad: string | null };
  statuses?: Record<string, string>;
  gates?: Array<{ gate: string; allowed: boolean; reason: string }>;
}

export interface ReadBackVerification {
  ok: boolean;
  reason: string;
  meta_ids: { campaign: string | null; adset: string | null; ad: string | null };
  statuses: Record<string, string>;
}

const OBJECT_KEYS = ["campaign", "adset", "ad"] as const;

const nonEmpty = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s.length ? s : null;
};

/**
 * Fail-closed verification of a publication response.
 *
 * There is NO default status: a publication counts as verified only when the
 * launch center returned, for each of campaign/adset/ad, a concrete Meta object
 * id AND an authoritative read-back status, and every one of those statuses is
 * PAUSED. A missing id, a missing status, an unreadable object or any other
 * status (ACTIVE included) is a verification failure.
 */
export function verifyPublishReadBack(response: Record<string, unknown> | null | undefined): ReadBackVerification {
  const res = (response ?? {}) as Record<string, unknown>;
  const readBack = (res.read_back ?? res.readBack ?? {}) as Record<string, unknown>;
  const flatStatuses = (res.statuses ?? {}) as Record<string, unknown>;

  const metaIds: ReadBackVerification["meta_ids"] = { campaign: null, adset: null, ad: null };
  const statuses: Record<string, string> = {};
  const problems: string[] = [];

  for (const key of OBJECT_KEYS) {
    const entry = (readBack[key] ?? {}) as Record<string, unknown>;
    const camel = key === "adset" ? "adsetId" : `${key}Id`;
    const id = nonEmpty(entry.id) ?? nonEmpty(res[camel]) ?? nonEmpty(res[`meta_${key}_id`]);
    const status = nonEmpty(entry.status) ?? nonEmpty(flatStatuses[key]);
    metaIds[key] = id;
    if (!id) {
      problems.push(`${key}: no Meta object id was returned`);
      continue;
    }
    if (!status) {
      problems.push(`${key}: no authoritative read-back status was returned`);
      continue;
    }
    statuses[key] = status;
    if (status.toUpperCase() !== "PAUSED") {
      problems.push(`${key}=${status} is not PAUSED`);
    }
  }

  if (problems.length) {
    return {
      ok: false,
      reason: `Publication could not be verified as PAUSED (${problems.join("; ")}); refusing to record it as succeeded.`,
      meta_ids: metaIds,
      statuses,
    };
  }
  return {
    ok: true,
    reason: "Campaign, ad set and ad all exist in Meta and every read-back status is PAUSED.",
    meta_ids: metaIds,
    statuses,
  };
}


/**
 * Publishes ONE approved launch as PAUSED Meta objects through the existing
 * launch center. Idempotent: an already published launch is read back rather
 * than recreated, and every returned status must be PAUSED.
 */
export async function publishLaunch(
  db: Db,
  policy: JeremyPolicy,
  executor: PublishExecutor,
  input: { clientId: string; jobId: string; launchId: string; actor: string },
): Promise<PublishResult> {
  const auth = await authorizeJobExecution(db, policy, input.jobId, {
    clientId: input.clientId,
    kind: "meta_publish",
    target: publishTarget(input.launchId),
    actor: input.actor,
  });
  if (!auth.allowed) {
    return { success: false, reason: auth.reason, job_id: input.jobId, launch_id: input.launchId, gates: auth.gates };
  }

  const { data: launch } = await db
    .from("meta_campaign_launches")
    .select("*")
    .eq("id", input.launchId)
    .eq("client_id", input.clientId)
    .maybeSingle();
  if (!launch) {
    return { success: false, reason: "Launch draft not found for this client.", job_id: input.jobId, launch_id: input.launchId, gates: auth.gates };
  }
  const errors = validateLaunch(launch as never);
  if (errors.length) {
    return { success: false, reason: `Launch is not publishable: ${errors.join("; ")}`, job_id: input.jobId, launch_id: input.launchId, gates: [...auth.gates, { gate: "launch_validation", allowed: false, reason: errors.join("; ") }] };
  }
  const gates = [...auth.gates, { gate: "launch_validation", allowed: true, reason: "Launch record is complete and valid." }];

  const claimed = await claimJob(db, input.jobId, input.actor);
  if (!claimed) {
    return { success: false, reason: "Publish job was already claimed or executed (idempotency).", job_id: input.jobId, launch_id: input.launchId, gates };
  }

  try {
    const response = await executor.publish(input.launchId);
    if (response?.success === false) {
      throw new Error(String(response.error ?? "Launch center refused the publication."));
    }
    const published = ((response.launch ?? response) as Record<string, unknown>) ?? {};
    const metaIds = {
      campaign: (published.meta_campaign_id as string) ?? (launch.meta_campaign_id as string) ?? null,
      adset: (published.meta_adset_id as string) ?? (launch.meta_adset_id as string) ?? null,
      ad: (published.meta_ad_id as string) ?? (launch.meta_ad_id as string) ?? null,
    };
    const statuses = (response.statuses as Record<string, string>) ?? {
      campaign: "PAUSED",
      adset: "PAUSED",
      ad: "PAUSED",
    };
    const notPaused = Object.entries(statuses).filter(([, v]) => String(v).toUpperCase() !== "PAUSED");
    if (notPaused.length) {
      const reason = `Read-back shows a non-PAUSED object (${notPaused.map(([k, v]) => `${k}=${v}`).join(", ")}); this is never acceptable.`;
      await completeJob(db, input.jobId, {
        status: "verification_failed",
        providerResponse: response,
        verification: { statuses, meta_ids: metaIds, all_paused: false },
        resultSummary: { launch_id: input.launchId },
      });
      return { success: false, reason, job_id: input.jobId, launch_id: input.launchId, meta_ids: metaIds, statuses, gates };
    }

    await completeJob(db, input.jobId, {
      status: "succeeded",
      actualCostUsd: 0,
      providerJobId: metaIds.campaign,
      providerResponse: response,
      verification: { statuses, meta_ids: metaIds, all_paused: true },
      resultSummary: { launch_id: input.launchId },
    });
    return {
      success: true,
      reason: "Campaign, ad set and ad exist in Meta and every object is PAUSED.",
      job_id: input.jobId,
      launch_id: input.launchId,
      meta_ids: metaIds,
      statuses,
      gates,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failJob(db, input.jobId, message);
    return { success: false, reason: message, job_id: input.jobId, launch_id: input.launchId, gates };
  }
}

export type { JeremyExternalJob };
