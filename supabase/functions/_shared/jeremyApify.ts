/**
 * Apify Instagram discovery — pure request/cost/ingest logic.
 *
 * No secrets and no network are read here: the caller injects an already
 * resolved token and a fetch implementation, so every branch (cost, caps,
 * pagination, ingestion, dedup) is unit-testable without calling Apify.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export type ScrapeType = "profile" | "hashtag" | "url";

export const DEFAULT_ACTOR_ID = "apify~instagram-scraper";
export const MAX_RESULTS_PER_TARGET = 200;
export const MAX_TARGETS_PER_RUN = 10;

const round2 = (v: number) => Math.round(v * 100) / 100;


export interface DiscoveryTarget {
  scrapeType: ScrapeType;
  targets: string[];
  resultsLimit: number;
}

export interface NormalizedTarget extends DiscoveryTarget {
  actorId: string;
  max_results: number;
}

export function normalizeDiscoveryTarget(input: {
  scrapeType?: unknown;
  targets?: unknown;
  resultsLimit?: unknown;
  actorId?: unknown;
}): { ok: true; target: NormalizedTarget } | { ok: false; error: string } {
  const scrapeType = String(input.scrapeType ?? "");
  if (!["profile", "hashtag", "url"].includes(scrapeType)) {
    return { ok: false, error: "scrapeType must be one of profile, hashtag, url." };
  }
  const rawTargets = Array.isArray(input.targets) ? input.targets.map((t) => String(t).trim()).filter(Boolean) : [];
  const targets = [...new Set(rawTargets)].sort();
  if (!targets.length) return { ok: false, error: "At least one target is required." };
  if (targets.length > MAX_TARGETS_PER_RUN) {
    return { ok: false, error: `At most ${MAX_TARGETS_PER_RUN} targets per run (received ${targets.length}).` };
  }
  const limitRaw = Number(input.resultsLimit);
  if (!Number.isFinite(limitRaw) || limitRaw < 1) return { ok: false, error: "resultsLimit must be a positive number." };
  const resultsLimit = Math.min(MAX_RESULTS_PER_TARGET, Math.floor(limitRaw));
  const actorId = String(input.actorId || DEFAULT_ACTOR_ID);
  return {
    ok: true,
    target: { scrapeType: scrapeType as ScrapeType, targets, resultsLimit, actorId, max_results: targets.length * resultsLimit },
  };
}

/**
 * Exact maximum cost of a run. The unit price must be passed in from configured
 * settings — there is no code-constant fallback, so an unconfigured price yields
 * NaN and every caller refuses to spend.
 */
export function estimateApifyCostUsd(target: NormalizedTarget, costPerResultUsd: number): number {
  const unit = Number(costPerResultUsd);
  if (!Number.isFinite(unit) || unit <= 0) return NaN;
  return round2(Math.max(0.01, target.max_results * unit));
}


/** The Apify actor input for this target. */
export function buildActorInput(target: NormalizedTarget): Record<string, unknown> {
  const base: Record<string, unknown> = {
    resultsLimit: target.resultsLimit,
    resultsType: "posts",
    addParentData: false,
  };
  if (target.scrapeType === "profile") return { ...base, username: target.targets };
  if (target.scrapeType === "hashtag") return { ...base, hashtags: target.targets.map((t) => t.replace(/^#/, "")) };
  return { ...base, directUrls: target.targets };
}

export interface ApifySettingsRow {
  id?: string;
  api_token?: string | null;
  actor_id?: string | null;
  is_active?: boolean | null;
  monthly_spend_limit_cents?: number | null;
  current_month_spend_cents?: number | null;
  spend_reset_date?: string | null;
  config?: Record<string, unknown> | null;
}

/**
 * The client-scoped Apify setting, falling back to the agency-wide row. The
 * token is resolved server-side only and is never returned to a caller.
 */
export async function resolveApifySettings(db: Db, clientId: string): Promise<ApifySettingsRow | null> {
  const { data: scoped } = await db.from("apify_settings").select("*").eq("client_id", clientId).maybeSingle();
  if (scoped) return scoped as ApifySettingsRow;
  const { data: global } = await db.from("apify_settings").select("*").is("client_id", null).limit(1).maybeSingle();
  return (global ?? null) as ApifySettingsRow | null;
}

export interface ApifyBudgetGate {
  allowed: boolean;
  reason: string;
  monthly_limit_usd: number;
  month_to_date_usd: number;
}

/** The Apify account's own monthly spend limit — enforced IN ADDITION to Jeremy policy caps. */
export function checkApifyMonthlyLimit(settings: ApifySettingsRow | null, estimatedCostUsd: number): ApifyBudgetGate {
  const limitUsd = Number(settings?.monthly_spend_limit_cents ?? 0) / 100;
  const usedUsd = Number(settings?.current_month_spend_cents ?? 0) / 100;
  if (!settings) return { allowed: false, reason: "No Apify settings are configured.", monthly_limit_usd: 0, month_to_date_usd: 0 };
  if (settings.is_active === false) {
    return { allowed: false, reason: "Apify integration is disabled.", monthly_limit_usd: limitUsd, month_to_date_usd: usedUsd };
  }
  if (!settings.api_token) {
    return { allowed: false, reason: "No Apify API token is configured.", monthly_limit_usd: limitUsd, month_to_date_usd: usedUsd };
  }
  if (!(limitUsd > 0)) {
    return { allowed: false, reason: "Apify has no positive monthly spend limit configured; refusing to spend.", monthly_limit_usd: limitUsd, month_to_date_usd: usedUsd };
  }
  if (!Number.isFinite(estimatedCostUsd)) {
    return { allowed: false, reason: "Apify run cost is unknown; refusing to spend.", monthly_limit_usd: limitUsd, month_to_date_usd: usedUsd };
  }
  if (usedUsd + estimatedCostUsd > limitUsd) {
    return {
      allowed: false,
      reason: `Run would exceed the Apify monthly limit $${limitUsd} (already $${usedUsd}).`,
      monthly_limit_usd: limitUsd,
      month_to_date_usd: usedUsd,
    };
  }
  return { allowed: true, reason: "Within the Apify monthly spend limit.", monthly_limit_usd: limitUsd, month_to_date_usd: usedUsd };
}

export interface ConfiguredUnitCost {
  /** NaN when no positive unit price is configured — callers must refuse. */
  usd: number;
  source: string;
  version: string;
}

/**
 * The Apify unit price comes ONLY from configured settings
 * (`apify_settings.config.cost_per_result_usd`). There is deliberately no
 * hard-coded published price: an unconfigured price fails closed.
 */
export function configuredCostPerResult(settings: ApifySettingsRow | null): ConfiguredUnitCost {
  const config = (settings?.config ?? {}) as Record<string, unknown>;
  const configured = Number(config.cost_per_result_usd);
  const version = String(config.cost_version ?? config.cost_per_result_version ?? "").trim();
  if (!Number.isFinite(configured) || configured <= 0) {
    return { usd: NaN, source: "apify_settings.config.cost_per_result_usd", version: version || "unset" };
  }
  return {
    usd: configured,
    source: "apify_settings.config.cost_per_result_usd",
    version: version || "unversioned",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider calls (fetch injected)
// ─────────────────────────────────────────────────────────────────────────────

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const APIFY_BASE = "https://api.apify.com/v2";

/** Apify run statuses that mean the run finished successfully. */
export const APIFY_SUCCESS_STATUS = "SUCCEEDED";
export const APIFY_TERMINAL_STATUSES = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT", "TIMED_OUT"];

export interface ApifyRunResult {
  runId: string;
  datasetId: string | null;
  status: string;
  usageUsd: number | null;
  raw: Record<string, unknown>;
}

/**
 * A run may only be ingested when it reached the terminal SUCCEEDED status AND
 * exposes a dataset. RUNNING/READY (the wait timed out) and FAILED/ABORTED/
 * TIMED-OUT are never treated as success.
 */
export function assertRunIngestible(run: ApifyRunResult): { ok: true } | { ok: false; error: string } {
  const status = String(run.status ?? "").toUpperCase();
  if (status !== APIFY_SUCCESS_STATUS) {
    const detail = APIFY_TERMINAL_STATUSES.includes(status)
      ? `Apify run ${run.runId || "(no id)"} finished with status ${status || "UNKNOWN"}.`
      : `Apify run ${run.runId || "(no id)"} did not finish within the wait window (status ${status || "UNKNOWN"}); refusing to treat it as success.`;
    return { ok: false, error: detail };
  }
  if (!run.datasetId) {
    return { ok: false, error: `Apify run ${run.runId || "(no id)"} succeeded but returned no dataset id; nothing can be ingested.` };
  }
  return { ok: true };
}

/** Starts the actor synchronously (run-sync) and returns the run + dataset ids. */
export async function runApifyActor(
  fetchImpl: FetchLike,
  token: string,
  target: NormalizedTarget,
  opts: { timeoutSecs?: number } = {},
): Promise<ApifyRunResult> {
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(target.actorId)}/runs?waitForFinish=${Math.min(300, opts.timeoutSecs ?? 120)}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildActorInput(target)),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Apify run failed [${res.status}]: ${JSON.stringify(body).slice(0, 400)}`);
  }
  const run = (body?.data ?? body) as Record<string, unknown>;
  const usage = Number((run?.usageTotalUsd ?? (run?.usage as Record<string, unknown>)?.totalUsd) as unknown);
  return {
    runId: String(run?.id ?? ""),
    datasetId: run?.defaultDatasetId ? String(run.defaultDatasetId) : null,
    status: String(run?.status ?? "UNKNOWN"),
    usageUsd: Number.isFinite(usage) ? round2(usage) : null,
    raw: run,
  };

}

/** Reads the run's dataset with real pagination, bounded by the approved limit. */
export async function fetchDatasetItems(
  fetchImpl: FetchLike,
  token: string,
  datasetId: string,
  maxItems: number,
  pageSize = 100,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  while (out.length < maxItems) {
    const limit = Math.min(pageSize, maxItems - out.length);
    const res = await fetchImpl(
      `${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Apify dataset read failed [${res.status}]: ${text.slice(0, 300)}`);
    }
    const page = (await res.json().catch(() => [])) as Record<string, unknown>[];
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    offset += page.length;
    if (page.length < limit) break;
  }
  return out.slice(0, maxItems);
}

/** Maps one Apify Instagram item onto an `instagram_creatives` row. */
export function mapItemToCreative(item: Record<string, unknown>, clientId: string): Record<string, unknown> | null {
  const postId = String(item.id ?? item.shortCode ?? item.shortcode ?? "").trim();
  const url = String(item.url ?? (postId ? `https://www.instagram.com/p/${item.shortCode ?? postId}/` : "")).trim();
  if (!postId && !url) return null;
  const type = String(item.type ?? item.productType ?? "").toLowerCase();
  const postType = type.includes("video") || type.includes("clip") || item.videoUrl ? "video" : type.includes("sidecar") ? "carousel" : "image";
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    client_id: clientId,
    platform_post_id: postId || url,
    source_url: url || null,
    image_url: (item.displayUrl ?? item.imageUrl ?? null) as string | null,
    video_url: (item.videoUrl ?? null) as string | null,
    media_url: (item.videoUrl ?? item.displayUrl ?? item.imageUrl ?? null) as string | null,
    thumbnail_url: (item.displayUrl ?? item.thumbnailUrl ?? null) as string | null,
    caption: item.caption ? String(item.caption).slice(0, 4000) : null,
    hashtags: Array.isArray(item.hashtags) ? (item.hashtags as unknown[]).map(String).slice(0, 40) : null,
    post_type: postType,
    owner_username: item.ownerUsername ? String(item.ownerUsername) : null,
    likes_count: num(item.likesCount ?? item.likes),
    comments_count: num(item.commentsCount ?? item.comments),
    views_count: num(item.videoViewCount ?? item.videoPlayCount ?? item.views),
    status: "scraped",
  };
}

export interface IngestResult {
  fetched: number;
  ingested: number;
  duplicates: number;
  creative_ids: string[];
}

/**
 * Idempotent ingestion: an item already present for this client (same
 * platform_post_id) is counted as a duplicate rather than inserted again.
 */
export async function ingestCreatives(
  db: Db,
  clientId: string,
  items: Record<string, unknown>[],
): Promise<IngestResult> {
  const rows = items.map((i) => mapItemToCreative(i, clientId)).filter(Boolean) as Record<string, unknown>[];
  const ids: string[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const { data: existing } = await db
      .from("instagram_creatives")
      .select("id")
      .eq("client_id", clientId)
      .eq("platform_post_id", row.platform_post_id)
      .maybeSingle();
    if (existing?.id) {
      duplicates += 1;
      continue;
    }
    const { data, error } = await db
      .from("instagram_creatives")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error) {
      // A concurrent run inserted the same post — treat as duplicate, never fail the job.
      duplicates += 1;
      continue;
    }
    if (data?.id) ids.push(String(data.id));
  }
  return { fetched: items.length, ingested: ids.length, duplicates, creative_ids: ids };
}

/** Records real spend against the Apify monthly limit. */
/**
 * Atomic month-to-date spend accounting via the `increment_apify_spend` RPC, so
 * two concurrent runs can never both write a stale read-modify-write total and
 * silently blow past the monthly limit.
 */
export async function recordApifySpend(db: Db, settings: ApifySettingsRow | null, actualCostUsd: number) {
  if (!settings?.id || !Number.isFinite(actualCostUsd) || actualCostUsd <= 0) return;
  const cents = Math.round(actualCostUsd * 100);
  const { error } = await db.rpc("increment_apify_spend", { p_settings_id: settings.id, p_cents: cents });
  if (error) throw new Error(`Failed to record Apify spend atomically: ${error.message}`);
}

