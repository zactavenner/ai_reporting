/**
 * Jeremy Autonomous Creative & Media Buyer — the durable end-to-end loop.
 *
 * discovery → selection → recreation → launch → analysis → action → verification
 *
 * Invariants enforced here, deterministically and server-side:
 *  - every newly created Meta object is PAUSED; nothing is ever activated;
 *  - default autonomy mode is shadow (decisions recorded, never executed);
 *  - auto actions may PAUSE but never delete;
 *  - scaling is budget increase only, clamped by policy (+20% default, +30% hard);
 *  - every provider mutation is idempotently claimed, audited, and read back
 *    from Meta; a mismatch is never reported as success;
 *  - paid discovery/generation refuse to run unless explicitly enabled AND capped.
 *
 * The Meta provider is injected so the whole loop is testable and so builds and
 * tests can run in dry-run mode without touching a live ad account.
 */

import {
  computeKpiSnapshot,
  evaluateCoverage,
  rankByContract,
  decisionBasis,
  kpiContract,
  JEREMY_KPI_CONTRACT_VERSION,
  type CoverageResult,
  type KpiSnapshot,
} from "./jeremyKpiContract.ts";
import {
  quoteJob,
  listJobs,
  costPosture,
  type JeremyExternalJob,
} from "./jeremyExternalJobs.ts";
import {
  createLaunchBatch as createLaunchBatchRecord,
  buildLaunchRecord,
  loadClientLaunchConfig,
  LAUNCH_STATUS,
  type LaunchInputs,
  type LaunchReadiness,
} from "./jeremyLaunch.ts";
import {
  generationTarget,
  jobKindFor,
  loadModelRate,
  pickGenerationModel,
  quoteGenerationCostUsd,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
} from "./jeremyGeneration.ts";
import {
  loadPolicy,
  checkPaidCapability,
  checkSampleFloors,
  checkCooldown,
  checkMode,
  clampScale,
  isDestructiveAction,
  type JeremyPolicy,
  type JeremyAction,
} from "./jeremyPolicy.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type CycleStage = "discovery" | "selection" | "recreation" | "launch" | "analysis" | "action" | "verification";

export interface MetaProvider {
  /** Reads the live provider state for an entity — used for read-back verification. */
  read(entityType: string, entityId: string): Promise<Record<string, unknown>>;
  /** Applies a mutation. Never called in shadow mode or dry runs. */
  mutate(entityType: string, entityId: string, params: Record<string, string>): Promise<Record<string, unknown>>;
}

/** A provider that reads nothing and refuses to mutate — used for shadow/dry runs. */
export const dryRunProvider: MetaProvider = {
  read: async () => ({ dry_run: true }),
  mutate: async () => {
    throw new Error("dry-run provider refuses provider mutations");
  },
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// Cycles
// ─────────────────────────────────────────────────────────────────────────────

export async function startCycle(db: Db, clientId: string, policy: JeremyPolicy, triggeredBy: string) {
  const { data, error } = await db
    .from("jeremy_cycles")
    .insert({
      client_id: clientId,
      mode: policy.mode,
      stage: "discovery",
      status: "running",
      triggered_by: triggeredBy,
      stage_timestamps: { discovery: new Date().toISOString() },
    })
    .select("*")
    .single();
  if (error) throw new Error(`Could not start cycle: ${error.message}`);
  return data;
}

export async function advanceCycle(
  db: Db,
  cycleId: string,
  stage: CycleStage,
  patch: Record<string, unknown> = {},
) {
  const { data: current } = await db.from("jeremy_cycles").select("stage_timestamps, evidence").eq("id", cycleId).maybeSingle();
  const stamps = { ...(current?.stage_timestamps ?? {}), [stage]: new Date().toISOString() };
  const evidence = { ...(current?.evidence ?? {}), ...(patch.evidence as Record<string, unknown> ?? {}) };
  const { error } = await db
    .from("jeremy_cycles")
    .update({ stage, stage_timestamps: stamps, evidence, ...omit(patch, ["evidence"]) })
    .eq("id", cycleId);
  if (error) throw new Error(`Could not advance cycle: ${error.message}`);
}

function omit(obj: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) out[k] = v;
  return out;
}

export async function failCycle(db: Db, cycleId: string, stage: CycleStage, message: string) {
  await db
    .from("jeremy_cycles")
    .update({ stage, status: "failed", error_state: { message, at: new Date().toISOString() }, completed_at: new Date().toISOString() })
    .eq("id", cycleId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage + KPI snapshot
// ─────────────────────────────────────────────────────────────────────────────

export async function buildCoverage(db: Db, clientId: string, policy: JeremyPolicy, windowDays = 30): Promise<{
  coverage: CoverageResult;
  totals: { spend: number; leads: number; qualified: number; funded: number; funded_dollars: number };
}> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const { data: metrics } = await db
    .from("daily_metrics")
    .select("ad_spend, leads, spam_leads, calls, showed_calls, funded_investors, funded_dollars, unattributed_leads, date, updated_at")
    .eq("client_id", clientId)
    .gte("date", since);

  const rows = metrics ?? [];
  const totals = rows.reduce(
    (acc: Record<string, number>, r: Record<string, unknown>) => ({
      spend: acc.spend + num(r.ad_spend),
      leads: acc.leads + num(r.leads),
      qualified: acc.qualified + Math.max(0, num(r.leads) - num(r.spam_leads)),
      funded: acc.funded + num(r.funded_investors),
      funded_dollars: acc.funded_dollars + num(r.funded_dollars),
      unattributed: acc.unattributed + num(r.unattributed_leads),
    }),
    { spend: 0, leads: 0, qualified: 0, funded: 0, funded_dollars: 0, unattributed: 0 },
  );

  const latest = rows
    .map((r: Record<string, unknown>) => (r.updated_at ? Date.parse(String(r.updated_at)) : NaN))
    .filter((t: number) => Number.isFinite(t))
    .sort((a: number, b: number) => b - a)[0];
  const freshness = Number.isFinite(latest) ? (Date.now() - latest) / 3_600_000 : null;

  const coverage = evaluateCoverage(
    {
      total_leads: totals.leads,
      attributed_leads: Math.max(0, totals.leads - totals.unattributed),
      freshness_hours: freshness,
      funded_count: totals.funded,
      qualified_leads: totals.qualified,
    },
    {
      min_attribution_coverage: policy.min_attribution_coverage,
      min_qualified_leads: policy.min_qualified_leads,
      min_funded_count: policy.min_funded_count,
    },
  );

  return { coverage, totals };
}

export async function saveKpiSnapshot(
  db: Db,
  clientId: string,
  cycleId: string | null,
  snapshot: KpiSnapshot,
  coverage: CoverageResult,
  windowDays: number,
) {
  const { data } = await db
    .from("jeremy_kpi_snapshots")
    .insert({
      client_id: clientId,
      cycle_id: cycleId,
      contract_version: JEREMY_KPI_CONTRACT_VERSION,
      window_days: windowDays,
      primary_outcomes: snapshot.primary_outcomes,
      media_diagnostics: snapshot.media_diagnostics,
      creative_diagnostics: snapshot.creative_diagnostics,
      reliability: snapshot.reliability,
      coverage: coverage as unknown as Record<string, unknown>,
    })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

export interface Candidate {
  source_type: "meta_account" | "client_library" | "scraped_ad" | "client_live_ad" | "viral_video" | "apify_social";
  source_reference: string;
  source_url: string | null;
  title: string;
  evidence: Record<string, unknown>;
  kpi: KpiSnapshot;
}

export interface DiscoveryOptions {
  includeApify?: boolean;
  /** Expected paid cost of an Apify discovery run, in USD. */
  apifyExpectedCostUsd?: number;
  limit?: number;
}

export interface DiscoveryResult {
  candidates: Candidate[];
  sources: Record<string, number>;
  paid_discovery: { requested: boolean; allowed: boolean; reason: string };
}

/**
 * Unifies current-account winners, the client's own creative library, scraped
 * ads, live-ad intelligence and viral video sources into one candidate model.
 * Paid Apify discovery only runs when the policy allows and caps it.
 */
export async function discoverWinners(
  db: Db,
  clientId: string,
  policy: JeremyPolicy,
  opts: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const limit = Math.min(50, Math.max(1, opts.limit ?? 25));
  const candidates: Candidate[] = [];

  const [{ data: ads }, { data: creatives }, { data: scraped }, { data: liveAds }, { data: viral }, { data: social }] = await Promise.all([
    db.from("meta_ads").select("*").eq("client_id", clientId).order("spend", { ascending: false }).limit(limit),
    db.from("creatives").select("id, title, file_url, headline, body_copy, cta_text, ai_performance_score, platform, status").eq("client_id", clientId).order("ai_performance_score", { ascending: false, nullsFirst: false }).limit(limit),
    db.from("scraped_ads").select("id, headline, body, image_url, video_url, source, source_url, advertiser_name, reach, views, platform").eq("client_id", clientId).order("scraped_at", { ascending: false }).limit(limit),
    db.from("client_live_ads").select("id, headline, primary_text, thumbnail_url, ad_library_url, page_name, media_type, ai_analysis").eq("client_id", clientId).order("scraped_at", { ascending: false }).limit(limit),
    db.from("viral_videos").select("id, caption, video_url, thumbnail_url, views, likes, platform").eq("client_id", clientId).order("views", { ascending: false, nullsFirst: false }).limit(limit),
    // Apify-sourced social posts ingested by run-instagram-scrape.
    db.from("instagram_creatives").select("id, caption, source_url, media_url, video_url, image_url, thumbnail_url, post_type, owner_username, likes_count, comments_count, views_count, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(limit),
  ]);

  for (const a of ads ?? []) {
    candidates.push({
      source_type: "meta_account",
      source_reference: String(a.meta_ad_id ?? a.id),
      source_url: a.preview_url ?? null,
      title: String(a.name ?? "Unnamed ad"),
      evidence: {
        spend: num(a.spend),
        funded: num(a.attributed_funded),
        funded_dollars: num(a.attributed_funded_dollars),
        leads: num(a.attributed_leads),
        headline: a.headline,
        body: a.body,
        media_type: a.media_type,
        thumbnail: a.thumbnail_url ?? a.video_thumbnail_url,
      },
      kpi: computeKpiSnapshot(a),
    });
  }
  for (const c of creatives ?? []) {
    candidates.push({
      source_type: "client_library",
      source_reference: String(c.id),
      source_url: c.file_url ?? null,
      title: String(c.title ?? "Library creative"),
      evidence: { ai_performance_score: c.ai_performance_score, headline: c.headline, body: c.body_copy, cta: c.cta_text, status: c.status },
      kpi: computeKpiSnapshot({ ctr: num(c.ai_performance_score) / 10 }),
    });
  }
  for (const s of scraped ?? []) {
    candidates.push({
      source_type: "scraped_ad",
      source_reference: String(s.id),
      source_url: s.source_url ?? null,
      title: String(s.headline ?? s.advertiser_name ?? "Scraped ad"),
      evidence: { advertiser: s.advertiser_name, headline: s.headline, body: s.body, reach: s.reach, views: s.views, platform: s.platform, media: s.video_url ?? s.image_url },
      kpi: computeKpiSnapshot({ impressions: num(s.reach) || num(s.views) }),
    });
  }
  for (const l of liveAds ?? []) {
    candidates.push({
      source_type: "client_live_ad",
      source_reference: String(l.id),
      source_url: l.ad_library_url ?? null,
      title: String(l.headline ?? l.page_name ?? "Live ad"),
      evidence: { headline: l.headline, body: l.primary_text, media_type: l.media_type, ai_analysis: l.ai_analysis },
      kpi: computeKpiSnapshot({}),
    });
  }
  for (const v of viral ?? []) {
    candidates.push({
      source_type: "viral_video",
      source_reference: String(v.id),
      source_url: v.video_url ?? null,
      title: String(v.caption ?? "Viral video").slice(0, 120),
      evidence: { views: v.views, likes: v.likes, platform: v.platform },
      kpi: computeKpiSnapshot({ impressions: num(v.views), video_3s_views: num(v.likes) }),
    });
  }

  for (const p of social ?? []) {
    candidates.push({
      source_type: "apify_social",
      source_reference: String(p.id),
      source_url: p.source_url ?? null,
      title: String(p.caption ?? p.owner_username ?? "Instagram post").slice(0, 120),
      evidence: {
        owner: p.owner_username,
        likes: num(p.likes_count),
        comments: num(p.comments_count),
        views: num(p.views_count),
        media_type: p.post_type,
        media: p.video_url ?? p.media_url ?? p.image_url,
        thumbnail: p.thumbnail_url,
        provider: "apify",
      },
      kpi: computeKpiSnapshot({ impressions: num(p.views_count), video_3s_views: num(p.likes_count), clicks: num(p.comments_count) }),
    });
  }

  // Paid Apify social discovery — refuses unless explicitly enabled and capped.
  const requested = opts.includeApify === true;
  let paid = { requested, allowed: false, reason: "not requested" };
  if (requested) {
    const gate = checkPaidCapability(policy, "discovery", opts.apifyExpectedCostUsd ?? NaN, await monthToDatePaidCost(db, clientId, "discovery"));
    paid = { requested, allowed: gate.allowed, reason: gate.reason };
    // A paid run is never launched from here: it goes through the external-job
    // ledger (quote → operator approval → run-instagram-scrape), and its results
    // are ingested above as `apify_social` candidates on the next discovery.
  }

  const sources: Record<string, number> = {};
  for (const c of candidates) sources[c.source_type] = (sources[c.source_type] ?? 0) + 1;
  return { candidates, sources, paid_discovery: paid };
}

async function monthToDatePaidCost(db: Db, clientId: string, kind: "discovery" | "generation"): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data } = await db
    .from("jeremy_creative_candidates")
    .select("actual_cost_usd, expected_cost_usd, generation_kind")
    .eq("client_id", clientId)
    .gte("created_at", monthStart.toISOString());
  if (!data) return 0;
  const relevant = kind === "generation" ? data.filter((r: Record<string, unknown>) => r.generation_kind) : data;
  return round2(relevant.reduce((s: number, r: Record<string, unknown>) => s + num(r.actual_cost_usd ?? r.expected_cost_usd), 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection + recreation briefs
// ─────────────────────────────────────────────────────────────────────────────

export function rankCandidates(candidates: Candidate[], coverage: CoverageResult) {
  return rankByContract(candidates, coverage).map((c, i) => ({ ...c, rank: i + 1 }));
}

export interface RecreationBrief {
  mechanism: { hook: string; angle: string; format: string; proof_structure: string; pacing: string };
  derivative_instructions: string;
  guardrails: string[];
  suggested_kind: "static_image" | "video";
}

/**
 * A "recreation" is a derivative brief that preserves the winning MECHANISM —
 * hook, angle, format, proof structure and pacing — and explicitly forbids
 * copying protected branding, logos, likeness or source assets.
 */
export function buildRecreationBrief(candidate: Candidate): RecreationBrief {
  const ev = candidate.evidence as Record<string, unknown>;
  const isVideo = String(ev.media_type ?? "").toLowerCase().includes("video") || candidate.source_type === "viral_video" || Boolean(ev.views);
  return {
    mechanism: {
      hook: String(ev.headline ?? candidate.title).slice(0, 200),
      angle: String(ev.body ?? ev.ai_analysis ?? "Derived from the winning ad's dominant angle").slice(0, 400),
      format: isVideo ? "short-form vertical video" : "static image ad",
      proof_structure: String(ev.proof ?? "Restate the winner's proof pattern using this client's own verifiable proof points."),
      pacing: isVideo ? "hook in first 1.5s, proof by 6s, CTA by 12s" : "single-frame hook, one proof point, one CTA",
    },
    derivative_instructions:
      "Recreate the MECHANISM only. Rewrite all copy in this client's voice and use this client's own assets, offer and proof. Do not reproduce the source's branding, logos, likeness, watermark, or media.",
    guardrails: [
      "No copied branding, logos, likeness, watermarks or source media.",
      "No guaranteed-return language; use targeted returns with the required risk disclaimers.",
      "Claims must map to an approved claim for this client.",
    ],
    suggested_kind: isVideo ? "video" : "static_image",
  };
}

export interface PreparedGeneration {
  candidate_id: string;
  kind: "static_image" | "video";
  status: "prepared" | "blocked_paid_disabled";
  reason: string;
  expected_cost_usd: number;
}

/**
 * Prepares generation jobs for ranked candidates. Jobs stay PREPARED (never
 * submitted) whenever paid generation is disabled or uncapped for the account.
 */
export async function prepareRecreations(
  db: Db,
  clientId: string,
  cycleId: string | null,
  policy: JeremyPolicy,
  ranked: Array<Candidate & { score: number; rank: number; basis?: string }>,
  opts: { top?: number; expectedCostPerJobUsd?: number } = {},
): Promise<{ prepared: PreparedGeneration[]; candidate_ids: string[] }> {
  const top = Math.min(10, Math.max(1, opts.top ?? 5));
  const expectedCost = opts.expectedCostPerJobUsd ?? 0.5;
  const mtd = await monthToDatePaidCost(db, clientId, "generation");
  const prepared: PreparedGeneration[] = [];
  const ids: string[] = [];

  for (const c of ranked.slice(0, top)) {
    const brief = buildRecreationBrief(c);
    const gate = checkPaidCapability(policy, "generation", expectedCost, mtd);
    const status: PreparedGeneration["status"] = gate.allowed ? "prepared" : "blocked_paid_disabled";
    const { data, error } = await db
      .from("jeremy_creative_candidates")
      .insert({
        client_id: clientId,
        cycle_id: cycleId,
        source_type: c.source_type,
        source_reference: c.source_reference,
        source_url: c.source_url,
        title: c.title,
        evidence: { ...c.evidence, kpi: c.kpi, basis: c.basis },
        score: c.score,
        rank: c.rank,
        recreation_brief: brief as unknown as Record<string, unknown>,
        generation_kind: brief.suggested_kind,
        generation_status: status,
        expected_cost_usd: expectedCost,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Could not store candidate: ${error.message}`);
    if (data?.id) ids.push(data.id);
    prepared.push({
      candidate_id: data?.id ?? "",
      kind: brief.suggested_kind,
      status,
      reason: gate.reason,
      expected_cost_usd: expectedCost,
    });
  }
  return { prepared, candidate_ids: ids };
}

// ─────────────────────────────────────────────────────────────────────────────
// Launch batches — always PAUSED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Launch drafting lives in `jeremyLaunch.ts`: only candidates with a durable
 * generated creative and a COMPLETE validated configuration become drafts, and
 * every created Meta object is PAUSED.
 */
export { LAUNCH_STATUS, buildLaunchRecord, loadClientLaunchConfig };
export const createLaunchBatch = createLaunchBatchRecord;

// ─────────────────────────────────────────────────────────────────────────────
// Analysis + action planning
// ─────────────────────────────────────────────────────────────────────────────

export interface PlannedAction {
  entity_type: "campaign" | "adset" | "ad";
  meta_entity_id: string;
  entity_name: string;
  action: JeremyAction;
  reason: string;
  basis: string;
  current_daily_budget: number | null;
  proposed_daily_budget: number | null;
  gates: Array<{ gate: string; allowed: boolean; reason: string }>;
  executable: boolean;
}

export interface AnalysisResult {
  coverage: CoverageResult;
  basis: string;
  entities: Array<{ entity_type: string; meta_entity_id: string; entity_name: string; kpi: KpiSnapshot; score: number }>;
}

export async function analyzeAccount(db: Db, clientId: string, policy: JeremyPolicy, windowDays = 30): Promise<AnalysisResult> {
  const { coverage } = await buildCoverage(db, clientId, policy, windowDays);
  const [{ data: campaigns }, { data: adsets }, { data: ads }] = await Promise.all([
    db.from("meta_campaigns").select("*").eq("client_id", clientId).order("spend", { ascending: false }).limit(25),
    db.from("meta_ad_sets").select("*").eq("client_id", clientId).order("spend", { ascending: false }).limit(40),
    db.from("meta_ads").select("*").eq("client_id", clientId).order("spend", { ascending: false }).limit(60),
  ]);

  const wrapped = [
    ...(campaigns ?? []).map((r: Record<string, unknown>) => wrapEntity(r, "campaign")),
    ...(adsets ?? []).map((r: Record<string, unknown>) => wrapEntity(r, "adset")),
    ...(ads ?? []).map((r: Record<string, unknown>) => wrapEntity(r, "ad")),
  ].filter((e) => e.meta_entity_id);

  const ranked = rankByContract(wrapped, coverage);
  return {
    coverage,
    basis: decisionBasis(coverage),
    entities: ranked.map((e) => ({
      entity_type: e.entity_type,
      meta_entity_id: e.meta_entity_id,
      entity_name: e.entity_name,
      kpi: e.kpi,
      score: e.score,
      daily_budget: e.daily_budget,
      live_days: e.live_days,
      effective_status: e.effective_status,
    })) as AnalysisResult["entities"],
  };
}

function wrapEntity(row: Record<string, unknown>, entityType: "campaign" | "adset" | "ad") {
  const start = row.start_time ?? row.created_time ?? row.created_at;
  const liveDays = start ? Math.max(0, Math.floor((Date.now() - Date.parse(String(start))) / 86_400_000)) : 0;
  return {
    entity_type: entityType,
    meta_entity_id: String(row.meta_campaign_id || row.meta_adset_id || row.meta_ad_id || ""),
    entity_name: String(row.name ?? "Unnamed"),
    effective_status: String(row.effective_status ?? row.status ?? "UNKNOWN"),
    daily_budget: row.daily_budget != null ? num(row.daily_budget) : null,
    live_days: liveDays,
    kpi: computeKpiSnapshot({ ...row, live_days: liveDays }),
  };
}

/**
 * Turns analysis into a plan. Every proposal is passed through the deterministic
 * policy gates here — the model's opinion never bypasses them, and the plan
 * records exactly which gate blocked or permitted execution.
 */
export async function planActions(
  db: Db,
  clientId: string,
  policy: JeremyPolicy,
  analysis: AnalysisResult,
): Promise<PlannedAction[]> {
  const plans: PlannedAction[] = [];
  const outcomeBasis = analysis.basis === "primary_outcome";
  let accountDeltaUsed = 0;

  for (const e of analysis.entities as Array<AnalysisResult["entities"][number] & { daily_budget?: number | null; live_days?: number; effective_status?: string }>) {
    const p = e.kpi.primary_outcomes;
    const m = e.kpi.media_diagnostics;
    const spend = m.spend ?? 0;
    const funded = p.funded_count ?? 0;
    const roas = p.funded_roas ?? 0;
    const qualified = Number(e.kpi.reliability.qualified_leads ?? 0);
    const liveDays = Number(e.live_days ?? e.kpi.reliability.live_days ?? 0);

    let action: JeremyAction = "hold";
    let reason = "Insufficient evidence to act; continue observing.";

    if (outcomeBasis && funded === 0 && spend >= policy.min_spend_usd) {
      action = "pause";
      reason = `No funded outcomes on $${round2(spend)} spend over ${liveDays} live days.`;
    } else if (outcomeBasis && roas >= 3 && spend >= 250) {
      action = "adjust_budget";
      reason = `Proven winner: funded ROAS ${round2(roas)} on $${round2(spend)} spend.`;
    } else if (!outcomeBasis) {
      reason = `Outcome data incomplete (${analysis.coverage.missing.join("; ") || "unknown"}); proxy metrics may explain but not decide.`;
    }

    const gates: PlannedAction["gates"] = [];
    const sample = checkSampleFloors(policy, { spend, live_days: liveDays, qualified_leads: qualified, funded_count: funded }, action);
    gates.push({ gate: "sample_floors", ...sample });

    const { data: lastAction } = await db
      .from("jeremy_action_executions")
      .select("executed_at, created_at")
      .eq("client_id", clientId)
      .eq("meta_entity_id", e.meta_entity_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const cooldown = checkCooldown(policy, lastAction?.executed_at ?? lastAction?.created_at ?? null);
    gates.push({ gate: "cooldown", ...cooldown });

    const mode = checkMode(policy, action, false);
    gates.push({ gate: "mode", ...mode });

    let proposed: number | null = null;
    if (action === "adjust_budget") {
      const current = Number(e.daily_budget ?? 0);
      const scale = clampScale(policy, current, current * (1 + policy.scale_max_pct / 100), accountDeltaUsed);
      gates.push({ gate: "scale_clamp", allowed: scale.allowed, reason: scale.reason });
      proposed = scale.approved_daily_budget;
      if (scale.allowed && proposed) accountDeltaUsed += proposed - current;
      if (!scale.allowed) {
        action = "hold";
        reason = `${reason} Scaling blocked: ${scale.reason}`;
      }
    }

    if (!outcomeBasis && action !== "hold") {
      action = "hold";
      reason = "Proxy metrics cannot outrank missing outcome data; holding.";
      gates.push({ gate: "kpi_precedence", allowed: false, reason });
    }

    plans.push({
      entity_type: e.entity_type as PlannedAction["entity_type"],
      meta_entity_id: e.meta_entity_id,
      entity_name: e.entity_name,
      action,
      reason,
      basis: analysis.basis,
      current_daily_budget: (e.daily_budget as number | null) ?? null,
      proposed_daily_budget: proposed,
      gates,
      executable: action !== "hold" && gates.every((g) => g.allowed),
    });
  }
  return plans.sort((a, b) => Number(b.executable) - Number(a.executable));
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution — idempotent claim, provider mutation, read-back verification
// ─────────────────────────────────────────────────────────────────────────────

export function idempotencyKey(clientId: string, entityId: string, action: string, payload: Record<string, unknown>): string {
  const stable = Object.keys(payload).sort().map((k) => `${k}=${String(payload[k])}`).join("&");
  return `${clientId}:${entityId}:${action}:${stable}`;
}

/**
 * The single stable claim for a LIVE mutation of a plan. Exactly one row with
 * this key can ever exist, so a second live attempt is refused by the unique
 * index rather than mutating the provider twice.
 */
export function liveIdempotencyKey(planId: string, clientId: string, entityId: string, action: string, payload: Record<string, unknown>): string {
  return `${planId}:${idempotencyKey(clientId, entityId, action, payload)}`;
}

/**
 * Dry runs must never consume the live claim, and repeated/concurrent dry runs
 * must never collide with each other, so every dry-run audit row gets its own
 * namespaced, unique key.
 */
export function dryRunIdempotencyKey(
  planId: string,
  clientId: string,
  entityId: string,
  action: string,
  payload: Record<string, unknown>,
  nonce: string = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
): string {
  return `dryrun:${nonce}:${liveIdempotencyKey(planId, clientId, entityId, action, payload)}`;
}

/** True when a ledger key belongs to a dry-run audit row rather than a live claim. */
export function isDryRunIdempotencyKey(key: string): boolean {
  return key.startsWith("dryrun:");
}


/**
 * The binding fingerprint of a decision. Execution recomputes this from the
 * request and refuses when it differs from the persisted plan, so swapping the
 * entity, the action or the budget amount after approval can never execute.
 */
export function planFingerprint(
  clientId: string,
  entityType: string,
  metaEntityId: string,
  action: string,
  proposedDailyBudget: number | null,
): string {
  const budget = action === "adjust_budget" ? String(Math.floor(Number(proposedDailyBudget) || 0)) : "n/a";
  return `${clientId}|${entityType}|${metaEntityId}|${action}|${budget}`;
}

/** Persists a planned action as the immutable decision record for execution. */
export async function persistPlannedActions(
  db: Db,
  clientId: string,
  cycleId: string | null,
  kpiSnapshotId: string | null,
  plans: PlannedAction[],
  ttlHours = 24,
): Promise<Array<{ id: string; meta_entity_id: string; action: string; executable: boolean }>> {
  const rows = plans.map((p) => ({
    client_id: clientId,
    cycle_id: cycleId,
    kpi_snapshot_id: kpiSnapshotId,
    entity_type: p.entity_type,
    meta_entity_id: p.meta_entity_id,
    entity_name: p.entity_name,
    action: p.action,
    payload_fingerprint: planFingerprint(clientId, p.entity_type, p.meta_entity_id, p.action, p.proposed_daily_budget),
    current_daily_budget: p.current_daily_budget,
    proposed_daily_budget: p.proposed_daily_budget,
    basis: p.basis,
    reason: p.reason,
    evidence: { gates: p.gates, basis: p.basis, reason: p.reason },
    gates: p.gates as unknown as Record<string, unknown>[],
    executable: p.executable,
    status: "pending",
    expires_at: new Date(Date.now() + ttlHours * 3_600_000).toISOString(),
  }));
  if (!rows.length) return [];
  const { data, error } = await db.from("jeremy_action_plans").insert(rows).select("id, meta_entity_id, action, executable");
  if (error) throw new Error(`Could not persist action plan: ${error.message}`);
  return data ?? [];
}

/** Operator approval of a persisted plan. Only 'pending' rows may be approved. */
export async function approvePlannedAction(db: Db, planId: string, approvedBy: string) {
  const { data, error } = await db
    .from("jeremy_action_plans")
    .update({ status: "approved", approved_by: approvedBy, approved_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("status", "pending")
    .select("id, status, action, meta_entity_id, executable")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { success: false as const, error: "Plan not found, already decided, or not in a pending state." };
  return { success: true as const, plan: data };
}

export async function rejectPlannedAction(db: Db, planId: string, decidedBy: string) {
  const { data, error } = await db
    .from("jeremy_action_plans")
    .update({ status: "rejected", approved_by: decidedBy, approved_at: new Date().toISOString() })
    .eq("id", planId)
    .in("status", ["pending", "approved"])
    .select("id, status")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { success: true as const, plan: data } : { success: false as const, error: "Plan not found or already executed." };
}

export interface ExecuteInput {
  clientId: string;
  /** REQUIRED: the persisted, approved decision record this execution replays. */
  planId: string;
  cycleId?: string | null;
  recommendationId?: string | null;
  /** Echoed by the caller purely so a mismatch against the plan is refused. */
  action: JeremyAction;
  entityType: "campaign" | "adset" | "ad";
  metaEntityId: string;
  proposedDailyBudget?: number | null;
  executedBy: string;
  dryRun?: boolean;
}

export interface ExecuteResult {
  success: boolean;
  status: string;
  verification_status: string;
  reason: string;
  execution_id?: string;
  plan_id?: string;
  gate_evidence?: Array<{ gate: string; allowed: boolean; reason: string }>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

const blocked = (reason: string, gates?: Array<{ gate: string; allowed: boolean; reason: string }>, planId?: string): ExecuteResult => ({
  success: false,
  status: "blocked",
  verification_status: "skipped_dry_run",
  reason,
  plan_id: planId,
  gate_evidence: gates,
});

/**
 * The ONLY path that may touch the provider, and it fails closed.
 *
 * Nothing the caller sends is trusted: the action, entity and budget are taken
 * from the persisted plan, and every deterministic gate is INDEPENDENTLY
 * revalidated here from persisted, reproducible evidence plus the provider's
 * current state. A direct endpoint call therefore cannot bypass a gate.
 *
 * Order is non-negotiable:
 *   plan exists → binding fingerprint matches → approved → not stale →
 *   atomic claim → mode → outcome coverage → sample floors → cooldown →
 *   provider current state → increase-only + scale clamp + daily cap +
 *   account delta cap → mutation → read-back verification.
 */
export async function executeApprovedAction(
  db: Db,
  policy: JeremyPolicy,
  provider: MetaProvider,
  input: ExecuteInput,
): Promise<ExecuteResult> {
  const gates: Array<{ gate: string; allowed: boolean; reason: string }> = [];

  if (!input.planId) {
    return blocked("An approved, persisted plan (plan_id) is required; ad-hoc execution is refused.");
  }

  // ── 1. The immutable decision record ───────────────────────────────────────
  const { data: plan } = await db
    .from("jeremy_action_plans")
    .select("*")
    .eq("id", input.planId)
    .maybeSingle();
  if (!plan) return blocked("Unknown plan_id: no persisted decision record to execute.", gates, input.planId);
  if (String(plan.client_id) !== input.clientId) {
    return blocked("Plan belongs to a different client; refusing.", gates, input.planId);
  }

  const action = String(plan.action) as JeremyAction;
  const entityType = String(plan.entity_type) as "campaign" | "adset" | "ad";
  const metaEntityId = String(plan.meta_entity_id);
  const plannedBudget = plan.proposed_daily_budget != null ? Number(plan.proposed_daily_budget) : null;

  if (isDestructiveAction(action)) {
    return blocked("Destructive actions are never permitted; pause is the only kill lever.", gates, input.planId);
  }
  if (action === "hold") {
    return blocked("Hold is a no-op and is never executed.", gates, input.planId);
  }

  // ── 2. Binding: the request must describe exactly the approved decision ────
  const requestFingerprint = planFingerprint(
    input.clientId,
    input.entityType,
    input.metaEntityId,
    input.action,
    input.proposedDailyBudget ?? null,
  );
  const boundFingerprint = planFingerprint(input.clientId, entityType, metaEntityId, action, plannedBudget);
  if (requestFingerprint !== boundFingerprint || String(plan.payload_fingerprint) !== boundFingerprint) {
    gates.push({ gate: "payload_binding", allowed: false, reason: "Request does not match the approved plan (entity, action or amount changed)." });
    return blocked("Request does not match the approved decision record; refusing.", gates, input.planId);
  }
  gates.push({ gate: "payload_binding", allowed: true, reason: "Request matches the approved decision record." });

  // ── 3. Approved, not stale, and still executable ──────────────────────────
  if (plan.status !== "approved") {
    return blocked(`Plan is "${plan.status}", not approved; refusing.`, gates, input.planId);
  }
  if (plan.executable !== true) {
    return blocked("Plan was recorded as not executable (a gate blocked it when it was produced).", gates, input.planId);
  }
  const expiresAt = plan.expires_at ? Date.parse(String(plan.expires_at)) : NaN;
  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
    await db.from("jeremy_action_plans").update({ status: "expired" }).eq("id", input.planId).eq("status", "approved");
    return blocked("Evidence is stale: this plan has expired. Re-run the analysis before executing.", gates, input.planId);
  }
  gates.push({ gate: "evidence_freshness", allowed: true, reason: "Plan is approved and within its validity window." });

  // ── 4. Mode (recomputed from the live policy, not the plan) ───────────────
  const mode = checkMode(policy, action, true);
  gates.push({ gate: "mode", ...mode });
  if (!mode.allowed) return blocked(mode.reason, gates, input.planId);

  // ── 5. Atomic claim on the plan itself: a second LIVE call loses the race ──
  // A dry run is a read-only rehearsal: it never claims the plan, so repeated or
  // concurrent dry runs can neither race each other nor block the one permitted
  // live execution.
  const dryRun = input.dryRun ?? true;
  if (!dryRun) {
    const { data: claimedPlan } = await db
      .from("jeremy_action_plans")
      .update({ status: "claimed", claimed_at: new Date().toISOString() })
      .eq("id", input.planId)
      .eq("status", "approved")
      .select("id")
      .maybeSingle();
    if (!claimedPlan) {
      return blocked("Plan was already claimed or executed by another request (idempotency).", gates, input.planId);
    }
  }

  const release = async (status: string, extra: Record<string, unknown> = {}) => {
    if (dryRun) return;
    await db.from("jeremy_action_plans").update({ status, ...extra }).eq("id", input.planId);
  };


  try {
    // ── 6. Outcome-data coverage and sample floors, recomputed now ──────────
    const { coverage } = await buildCoverage(db, input.clientId, policy);
    if (!coverage.outcome_data_complete) {
      const reason = `Outcome data is incomplete (${coverage.missing.join("; ")}); proxy metrics may not authorise an action.`;
      gates.push({ gate: "kpi_precedence", allowed: false, reason });
      await release("approved");
      return blocked(reason, gates, input.planId);
    }
    gates.push({ gate: "kpi_precedence", allowed: true, reason: "Outcome data is complete; the decision rests on funded/qualified outcomes." });

    const analysis = await analyzeAccount(db, input.clientId, policy);
    const entity = (analysis.entities as Array<AnalysisResult["entities"][number] & { daily_budget?: number | null; live_days?: number }>)
      .find((e) => e.meta_entity_id === metaEntityId && e.entity_type === entityType);
    if (!entity) {
      const reason = "Entity is no longer present in synced account data; refusing to act on stale evidence.";
      gates.push({ gate: "entity_present", allowed: false, reason });
      await release("expired");
      return blocked(reason, gates, input.planId);
    }
    const spend = entity.kpi.media_diagnostics.spend ?? 0;
    const funded = entity.kpi.primary_outcomes.funded_count ?? 0;
    const qualified = Number(entity.kpi.reliability.qualified_leads ?? 0);
    const liveDays = Number(entity.live_days ?? entity.kpi.reliability.live_days ?? 0);

    const sample = checkSampleFloors(policy, { spend, live_days: liveDays, qualified_leads: qualified, funded_count: funded }, action);
    gates.push({ gate: "sample_floors", ...sample });
    if (!sample.allowed) {
      await release("approved");
      return blocked(sample.reason, gates, input.planId);
    }

    // ── 7. Cooldown, from the persisted execution ledger (live rows only) ────
    const { data: lastAction } = await db
      .from("jeremy_action_executions")
      .select("executed_at, created_at")
      .eq("client_id", input.clientId)
      .eq("meta_entity_id", metaEntityId)
      .eq("dry_run", false)
      .not("status", "eq", "blocked")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const cooldown = checkCooldown(policy, lastAction?.executed_at ?? lastAction?.created_at ?? null);
    gates.push({ gate: "cooldown", ...cooldown });
    if (!cooldown.allowed) {
      await release("approved");
      return blocked(cooldown.reason, gates, input.planId);
    }

    // ── 8. Provider current state — the budget math never trusts the caller ─
    const before = await provider.read(entityType, metaEntityId);
    let approvedBudgetUsd: number | null = null;

    if (action === "adjust_budget") {
      // Meta reports daily_budget in minor units (cents).
      const currentCents = Number(before.daily_budget);
      const currentUsd = Number.isFinite(currentCents) && currentCents > 0
        ? currentCents / 100
        : Number(entity.daily_budget ?? 0) / 100;
      const accountDeltaUsed = await accountDeltaUsedToday(db, input.clientId);
      const scale = clampScale(policy, currentUsd, plannedBudget ?? 0, accountDeltaUsed);
      gates.push({ gate: "scale_clamp", allowed: scale.allowed, reason: scale.reason });
      if (!scale.allowed || !scale.approved_daily_budget) {
        await release("approved");
        return blocked(scale.reason, gates, input.planId);
      }
      // The approved plan may not exceed what the gates permit right now.
      if (plannedBudget != null && Math.floor(plannedBudget) > scale.approved_daily_budget) {
        const reason = `Approved amount $${Math.floor(plannedBudget)} exceeds what the current caps permit ($${scale.approved_daily_budget}); refusing.`;
        gates.push({ gate: "budget_caps", allowed: false, reason });
        await release("approved");
        return blocked(reason, gates, input.planId);
      }
      if (scale.approved_daily_budget > policy.max_daily_budget_usd) {
        const reason = `Daily budget cap $${policy.max_daily_budget_usd} would be exceeded; refusing.`;
        gates.push({ gate: "budget_caps", allowed: false, reason });
        await release("approved");
        return blocked(reason, gates, input.planId);
      }
      approvedBudgetUsd = Math.min(scale.approved_daily_budget, Math.floor(plannedBudget ?? scale.approved_daily_budget));
      gates.push({ gate: "budget_caps", allowed: true, reason: `Approved daily budget $${approvedBudgetUsd} (increase-only, within all caps).` });
    }

    // ── 9. Execution ledger: unique idempotency key, atomic claim ───────────
    // Live runs take the ONE stable claim key for this plan+payload. Dry runs
    // take a namespaced unique key so they never consume it.
    const payload: Record<string, unknown> = action === "pause" ? { status: "PAUSED" } : { daily_budget_usd: approvedBudgetUsd };
    const key = dryRun
      ? dryRunIdempotencyKey(input.planId, input.clientId, metaEntityId, action, payload)
      : liveIdempotencyKey(input.planId, input.clientId, metaEntityId, action, payload);


    const { data: claim, error: claimErr } = await db
      .from("jeremy_action_executions")
      .insert({
        client_id: input.clientId,
        cycle_id: input.cycleId ?? plan.cycle_id ?? null,
        plan_id: input.planId,
        recommendation_id: input.recommendationId ?? null,
        idempotency_key: key,
        action,
        entity_type: entityType,
        meta_entity_id: metaEntityId,
        requested_change: payload,
        before_snapshot: before,
        gate_evidence: gates,
        status: "executing",
        dry_run: Boolean(dryRun),
        executed_by: input.executedBy,
      })
      .select("id")
      .maybeSingle();

    if (claimErr || !claim?.id) {
      await release("approved");
      return blocked(`Already executed or claimed (idempotency): ${claimErr?.message ?? "no row returned"}`, gates, input.planId);
    }
    const executionId = String(claim.id);

    if (dryRun) {
      await db
        .from("jeremy_action_executions")
        .update({ status: "succeeded", verification_status: "skipped_dry_run", executed_at: new Date().toISOString(), provider_receipt: { dry_run: true } })
        .eq("id", executionId);
      await release("approved", { execution_id: executionId });
      return {
        success: true,
        status: "succeeded",
        verification_status: "skipped_dry_run",
        reason: "Dry run: every gate passed and no provider mutation was sent.",
        execution_id: executionId,
        plan_id: input.planId,
        gate_evidence: gates,
        before,
        after: null,
      };
    }

    // ── 10. Mutate, then read back and verify ───────────────────────────────
    const params: Record<string, string> = action === "pause"
      ? { status: "PAUSED" }
      : { daily_budget: String(Math.round(Number(approvedBudgetUsd) * 100)) };
    const receipt = await provider.mutate(entityType, metaEntityId, params);
    await db.from("jeremy_action_executions").update({ provider_receipt: receipt, executed_at: new Date().toISOString() }).eq("id", executionId);

    const after = await provider.read(entityType, metaEntityId);
    const verified = verifyReadBack(action, params, after);
    await db
      .from("jeremy_action_executions")
      .update({
        after_snapshot: after,
        verification_status: verified.ok ? "verified" : "mismatch",
        status: verified.ok ? "succeeded" : "verification_failed",
        error_detail: verified.ok ? null : verified.reason,
        verified_at: new Date().toISOString(),
      })
      .eq("id", executionId);
    await release(verified.ok ? "executed" : "failed", { execution_id: executionId, executed_at: new Date().toISOString() });

    return {
      success: verified.ok,
      status: verified.ok ? "succeeded" : "verification_failed",
      verification_status: verified.ok ? "verified" : "mismatch",
      reason: verified.reason,
      execution_id: executionId,
      plan_id: input.planId,
      gate_evidence: gates,
      before,
      after,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .from("jeremy_action_executions")
      .update({ status: "failed", verification_status: "failed", error_detail: message })
      .eq("plan_id", input.planId)
      .eq("status", "executing");
    await release("failed");
    return { success: false, status: "failed", verification_status: "failed", reason: message, plan_id: input.planId, gate_evidence: gates };
  }
}

/** Sum of today's approved budget increases (live rows only), for the account-level delta cap. */
async function accountDeltaUsedToday(db: Db, clientId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data } = await db
    .from("jeremy_action_executions")
    .select("requested_change, before_snapshot, action, status, dry_run, idempotency_key")
    .eq("client_id", clientId)
    .eq("action", "adjust_budget")
    .gte("created_at", dayStart.toISOString());
  if (!data) return 0;
  return round2(
    data
      .filter((r: Record<string, unknown>) =>
        ["succeeded", "executing", "verification_failed"].includes(String(r.status))
        && r.dry_run !== true
        && !isDryRunIdempotencyKey(String(r.idempotency_key ?? "")))

      .reduce((sum: number, r: Record<string, unknown>) => {
        const req = (r.requested_change ?? {}) as Record<string, unknown>;
        const beforeCents = Number((r.before_snapshot as Record<string, unknown> | null)?.daily_budget);
        const beforeUsd = Number.isFinite(beforeCents) ? beforeCents / 100 : 0;
        const afterUsd = num(req.daily_budget_usd);
        return sum + Math.max(0, afterUsd - beforeUsd);
      }, 0),
  );
}

/** Compares the requested change against what Meta actually reports back. */
export function verifyReadBack(action: JeremyAction, params: Record<string, string>, after: Record<string, unknown>): { ok: boolean; reason: string } {
  if (action === "pause") {
    const status = String(after.status ?? after.effective_status ?? "").toUpperCase();
    if (status === "PAUSED") return { ok: true, reason: "Provider reports PAUSED." };
    return { ok: false, reason: `Read-back mismatch: provider reports "${status || "unknown"}", expected PAUSED.` };
  }
  const expected = Number(params.daily_budget);
  const actual = Number(after.daily_budget);
  if (!Number.isFinite(actual)) return { ok: false, reason: "Read-back mismatch: provider returned no daily_budget." };
  if (Math.abs(actual - expected) <= 1) return { ok: true, reason: `Provider reports daily_budget ${actual}.` };
  return { ok: false, reason: `Read-back mismatch: provider reports ${actual}, expected ${expected}.` };
}

// ─────────────────────────────────────────────────────────────────────────────
// External job preparation (quotes only — nothing paid runs from a cycle)
// ─────────────────────────────────────────────────────────────────────────────

export interface PreparedExternalJob {
  candidate_id: string;
  kind: "static_image" | "video";
  model: string;
  job_id: string | null;
  status: string;
  estimated_cost_usd: number | null;
  policy_gate: { allowed: boolean; reason: string } | null;
  error?: string;
}

/**
 * Quotes one generation job per prepared candidate. Every job is created in
 * `awaiting_approval` with an exact maximum cost — a cycle (including a
 * scheduled one) can prepare and quote, but can never approve paid work.
 */
export async function prepareExternalGenerationJobs(
  db: Db,
  clientId: string,
  cycleId: string | null,
  policy: JeremyPolicy,
  candidateIds: string[],
  opts: { imageModel?: string; videoModel?: string; aspectRatio?: string; durationSeconds?: number; requestedBy?: string } = {},
): Promise<PreparedExternalJob[]> {
  const out: PreparedExternalJob[] = [];
  for (const candidateId of candidateIds) {
    const { data: candidate } = await db
      .from("jeremy_creative_candidates")
      .select("id, generation_kind, generation_status")
      .eq("id", candidateId)
      .maybeSingle();
    if (!candidate) continue;
    const kind = String(candidate.generation_kind) === "video" ? "video" : "static_image";
    const model = await pickGenerationModel(db, kind, kind === "video" ? opts.videoModel ?? DEFAULT_VIDEO_MODEL : opts.imageModel ?? DEFAULT_IMAGE_MODEL);
    const aspectRatio = String(opts.aspectRatio ?? (kind === "video" ? "9:16" : "1:1"));
    const durationSeconds = Math.max(1, Math.min(30, Number(opts.durationSeconds) || 5));
    const rate = model ? await loadModelRate(db, kind, model) : null;
    const cost = quoteGenerationCostUsd(rate, durationSeconds);
    if (!model || !rate || !Number.isFinite(cost)) {
      out.push({
        candidate_id: candidateId,
        kind,
        model: model ?? "unconfigured",
        job_id: null,
        status: "not_quoted",
        estimated_cost_usd: null,
        policy_gate: null,
        error: "No active configured price for this model in jeremy_model_costs; refusing to quote generation without a known cost.",
      });
      continue;
    }
    const target = generationTarget({ candidateId, kind, model, aspectRatio, durationSeconds });
    const quote = await quoteJob(db, policy, {
      clientId,
      kind: jobKindFor(kind),
      provider: "openrouter",
      target,
      estimatedCostUsd: cost,
      costSource: rate.source,
      costVersion: rate.version,
      cycleId,
      candidateId,
      requestedBy: opts.requestedBy ?? "cycle",
      quoteDetail: { model, kind, aspect_ratio: aspectRatio, duration_seconds: kind === "video" ? durationSeconds : null },
    });
    out.push({
      candidate_id: candidateId,
      kind,
      model,
      job_id: quote.job?.id ?? null,
      status: quote.job?.status ?? "not_quoted",
      estimated_cost_usd: quote.job?.estimated_cost_usd ?? (Number.isFinite(cost) ? cost : null),
      policy_gate: quote.policy_gate ?? null,
      error: quote.error,
    });

  }
  return out;
}

/** Launch readiness for candidates, with every missing configuration value named. */
export async function launchReadiness(
  db: Db,
  clientId: string,
  candidateIds: string[],
  inputs: LaunchInputs = {},
): Promise<LaunchReadiness[]> {
  const config = await loadClientLaunchConfig(db, clientId);
  const out: LaunchReadiness[] = [];
  for (const candidateId of candidateIds) {
    const { data: candidate } = await db
      .from("jeremy_creative_candidates")
      .select("*")
      .eq("id", candidateId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (!candidate) {
      out.push({ candidate_id: candidateId, ready: false, missing: ["Candidate not found for this client."], record: null });
      continue;
    }
    out.push(buildLaunchRecord(clientId, candidate, config, inputs));
  }
  return out;
}

/** Everything the operator needs to see about a cycle's external/paid work. */
export async function cycleExternalState(db: Db, clientId: string, cycleId: string, policy: JeremyPolicy) {
  const jobs = await listJobs(db, clientId, { cycleId, limit: 100 });
  return {
    jobs,
    awaiting_approval: jobs.filter((j: JeremyExternalJob) => j.status === "awaiting_approval"),
    approved: jobs.filter((j: JeremyExternalJob) => j.status === "approved"),
    cost_posture: await costPosture(db, policy, clientId),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Whole loop
// ─────────────────────────────────────────────────────────────────────────────

export interface RunCycleOptions {
  windowDays?: number;
  includeApify?: boolean;
  apifyExpectedCostUsd?: number;
  topCandidates?: number;
  createLaunches?: boolean;
  launchInputs?: LaunchInputs;
  imageModel?: string;
  videoModel?: string;
  aspectRatio?: string;
  durationSeconds?: number;
  triggeredBy?: string;
}

export async function runCycle(db: Db, clientId: string, opts: RunCycleOptions = {}) {
  const policy = await loadPolicy(db, clientId);
  const cycle = await startCycle(db, clientId, policy, opts.triggeredBy ?? "manual");
  const windowDays = opts.windowDays ?? 30;

  try {
    const discovery = await discoverWinners(db, clientId, policy, {
      includeApify: opts.includeApify,
      apifyExpectedCostUsd: opts.apifyExpectedCostUsd,
    });
    await advanceCycle(db, cycle.id, "selection", { evidence: { discovery: { sources: discovery.sources, paid: discovery.paid_discovery } } });

    const { coverage } = await buildCoverage(db, clientId, policy, windowDays);
    const ranked = rankCandidates(discovery.candidates, coverage);
    await advanceCycle(db, cycle.id, "recreation", { evidence: { coverage, top: ranked.slice(0, 5).map((r) => ({ title: r.title, score: r.score, source: r.source_type })) } });

    const { prepared, candidate_ids } = await prepareRecreations(db, clientId, cycle.id, policy, ranked, { top: opts.topCandidates ?? 5 });

    // Quote every paid generation job. These stay awaiting_approval with an exact
    // maximum cost: the cycle prepares, an operator approves, then the work runs.
    const external_jobs = await prepareExternalGenerationJobs(db, clientId, cycle.id, policy, candidate_ids, {
      imageModel: opts.imageModel,
      videoModel: opts.videoModel,
      aspectRatio: opts.aspectRatio,
      durationSeconds: opts.durationSeconds,
      requestedBy: opts.triggeredBy ?? "cycle",
    });
    await advanceCycle(db, cycle.id, "launch", { evidence: { prepared, external_jobs } });

    const readiness = await launchReadiness(db, clientId, candidate_ids, opts.launchInputs ?? {});
    const launches = opts.createLaunches
      ? await createLaunchBatch(db, clientId, candidate_ids, opts.launchInputs ?? {})
      : { items: [], launch_status: LAUNCH_STATUS, ready_count: readiness.filter((r) => r.ready).length, blocked_count: readiness.filter((r) => !r.ready).length };
    await advanceCycle(db, cycle.id, "analysis", { evidence: { launches, readiness } });

    const analysis = await analyzeAccount(db, clientId, policy, windowDays);
    const snapshotId = await saveKpiSnapshot(db, clientId, cycle.id, aggregateSnapshot(analysis), analysis.coverage, windowDays);
    await advanceCycle(db, cycle.id, "action", { kpi_snapshot_id: snapshotId, evidence: { basis: analysis.basis } });

    const plan = await planActions(db, clientId, policy, analysis);
    // Persist every proposal as an immutable decision record. Execution can only
    // ever replay one of these rows after an explicit operator approval.
    const persisted = await persistPlannedActions(db, clientId, cycle.id, snapshotId, plan);
    await advanceCycle(db, cycle.id, "verification", {
      status: "completed",
      completed_at: new Date().toISOString(),
      evidence: { plan_summary: plan.map((p) => ({ entity: p.entity_name, action: p.action, executable: p.executable })) },
    });

    return {
      success: true,
      cycle_id: cycle.id,
      mode: policy.mode,
      contract: { version: JEREMY_KPI_CONTRACT_VERSION },
      discovery: { sources: discovery.sources, paid_discovery: discovery.paid_discovery, candidates: ranked.length },
      prepared,
      external_jobs,
      launch_readiness: readiness,
      cost_posture: await costPosture(db, policy, clientId),
      launches,
      coverage: analysis.coverage,
      basis: analysis.basis,
      plan,
      persisted_plans: persisted,
      executed: [] as unknown[],
      note: policy.mode === "shadow"
        ? "Shadow mode: every decision was recorded, nothing was executed and nothing was published."
        : "Paid discovery/generation and Meta publication pause at awaiting_approval with an exact quote; all launches are PAUSED drafts.",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failCycle(db, cycle.id, "discovery", message);
    return { success: false, cycle_id: cycle.id, error: message };
  }
}

function aggregateSnapshot(analysis: AnalysisResult): KpiSnapshot {
  const base = computeKpiSnapshot({});
  for (const e of analysis.entities) {
    for (const group of ["primary_outcomes", "media_diagnostics", "creative_diagnostics"] as const) {
      for (const [k, v] of Object.entries(e.kpi[group])) {
        if (typeof v === "number") base[group][k] = round2((base[group][k] ?? 0) + v);
      }
    }
  }
  return base;
}

export async function getCycle(db: Db, cycleId: string) {
  const [{ data: cycle }, { data: candidates }, { data: executions }, { data: plans }, { data: jobs }] = await Promise.all([
    db.from("jeremy_cycles").select("*").eq("id", cycleId).maybeSingle(),
    db.from("jeremy_creative_candidates").select("*").eq("cycle_id", cycleId).order("rank", { ascending: true }),
    db.from("jeremy_action_executions").select("*").eq("cycle_id", cycleId).order("created_at", { ascending: false }),
    db.from("jeremy_action_plans").select("*").eq("cycle_id", cycleId).order("created_at", { ascending: false }),
    db.from("jeremy_external_jobs").select("*").eq("cycle_id", cycleId).order("created_at", { ascending: false }),
  ]);
  return { cycle, candidates: candidates ?? [], executions: executions ?? [], plans: plans ?? [], external_jobs: jobs ?? [] };
}

export { kpiContract, loadPolicy };
