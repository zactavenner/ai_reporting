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

  const [{ data: ads }, { data: creatives }, { data: scraped }, { data: liveAds }, { data: viral }] = await Promise.all([
    db.from("meta_ads").select("*").eq("client_id", clientId).order("spend", { ascending: false }).limit(limit),
    db.from("creatives").select("id, title, file_url, headline, body_copy, cta_text, ai_performance_score, platform, status").eq("client_id", clientId).order("ai_performance_score", { ascending: false, nullsFirst: false }).limit(limit),
    db.from("scraped_ads").select("id, headline, body, image_url, video_url, source, source_url, advertiser_name, reach, views, platform").eq("client_id", clientId).order("scraped_at", { ascending: false }).limit(limit),
    db.from("client_live_ads").select("id, headline, primary_text, thumbnail_url, ad_library_url, page_name, media_type, ai_analysis").eq("client_id", clientId).order("scraped_at", { ascending: false }).limit(limit),
    db.from("viral_videos").select("id, caption, video_url, thumbnail_url, views, likes, platform").eq("client_id", clientId).order("views", { ascending: false, nullsFirst: false }).limit(limit),
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

  // Paid Apify social discovery — refuses unless explicitly enabled and capped.
  const requested = opts.includeApify === true;
  let paid = { requested, allowed: false, reason: "not requested" };
  if (requested) {
    const gate = checkPaidCapability(policy, "discovery", opts.apifyExpectedCostUsd ?? NaN, await monthToDatePaidCost(db, clientId, "discovery"));
    paid = { requested, allowed: gate.allowed, reason: gate.reason };
    // Even when allowed, no paid call is made from this build; the run is
    // recorded as permitted so the operator can trigger it deliberately.
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

export const LAUNCH_STATUS = "PAUSED" as const;

export interface LaunchBatchItem {
  candidate_id: string;
  launch_id: string;
  status: string;
  stage: string;
}

/**
 * Creates draft launch rows for prepared candidates. Every row is forced to
 * status "draft"/effective PAUSED; nothing in this system activates a Meta
 * object, and any caller-supplied ACTIVE status is rejected outright.
 */
export async function createLaunchBatch(
  db: Db,
  clientId: string,
  candidateIds: string[],
  inputs: Record<string, unknown> = {},
): Promise<{ items: LaunchBatchItem[]; launch_status: string }> {
  if (String(inputs.status ?? "").toUpperCase() === "ACTIVE") {
    throw new Error("Refusing to create an ACTIVE launch: every Jeremy-created Meta object must be PAUSED.");
  }
  const items: LaunchBatchItem[] = [];
  for (const candidateId of candidateIds) {
    const { data: candidate } = await db
      .from("jeremy_creative_candidates")
      .select("id, title, recreation_brief, source_url, generation_kind")
      .eq("id", candidateId)
      .maybeSingle();
    if (!candidate) continue;
    const { data: launch, error } = await db
      .from("meta_campaign_launches")
      .insert({
        client_id: clientId,
        name: `[Jeremy] ${candidate.title}`.slice(0, 120),
        status: "draft",
        stage: "draft",
        objective: String(inputs.objective ?? "leads"),
        daily_budget_cents: Number(inputs.daily_budget_cents ?? 2000),
        cta: String(inputs.cta ?? "LEARN_MORE"),
        destination_url: inputs.destination_url ?? null,
        primary_text: (candidate.recreation_brief?.mechanism?.angle ?? "").slice(0, 1000) || null,
        headline: (candidate.recreation_brief?.mechanism?.hook ?? candidate.title).slice(0, 255),
        creative_type: candidate.generation_kind === "video" ? "video" : "image",
        created_by: "jeremy_autonomous (PAUSED draft)",
      })
      .select("id, status, stage")
      .maybeSingle();
    if (error) throw new Error(`Could not create launch draft: ${error.message}`);
    if (!launch) continue;
    await db.from("jeremy_creative_candidates").update({ launch_reference: launch.id }).eq("id", candidateId);
    items.push({ candidate_id: candidateId, launch_id: launch.id, status: launch.status, stage: launch.stage });
  }
  return { items, launch_status: LAUNCH_STATUS };
}

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

export interface ExecuteInput {
  clientId: string;
  cycleId?: string | null;
  recommendationId?: string | null;
  action: JeremyAction;
  entityType: "campaign" | "adset" | "ad";
  metaEntityId: string;
  proposedDailyBudget?: number | null;
  humanApproved: boolean;
  executedBy: string;
  dryRun?: boolean;
}

export interface ExecuteResult {
  success: boolean;
  status: string;
  verification_status: string;
  reason: string;
  execution_id?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * The only path that may touch the provider. Order is non-negotiable:
 * policy gates → atomic idempotent claim → before snapshot → mutation →
 * read-back → verification. A mismatch is recorded as verification_failed and
 * is NEVER reported as success.
 */
export async function executeApprovedAction(
  db: Db,
  policy: JeremyPolicy,
  provider: MetaProvider,
  input: ExecuteInput,
): Promise<ExecuteResult> {
  if (isDestructiveAction(input.action)) {
    return { success: false, status: "blocked", verification_status: "failed", reason: "Destructive actions are never permitted; pause is the only kill lever." };
  }
  if (input.action === "hold") {
    return { success: false, status: "blocked", verification_status: "skipped_dry_run", reason: "Hold is a no-op and is never executed." };
  }

  const mode = checkMode(policy, input.action, input.humanApproved);
  if (!mode.allowed) return { success: false, status: "blocked", verification_status: "skipped_dry_run", reason: mode.reason };

  const payload: Record<string, unknown> =
    input.action === "pause" ? { status: "PAUSED" } : { daily_budget: input.proposedDailyBudget };
  const key = idempotencyKey(input.clientId, input.metaEntityId, input.action, payload);
  // Default is ALWAYS a dry run: a live provider mutation requires an explicit
  // dry_run: false from an authorized caller.
  const dryRun = input.dryRun ?? true;

  // Atomic claim: the unique idempotency key means a concurrent or repeated
  // request loses the insert and never re-sends the mutation.
  const { data: claim, error: claimErr } = await db
    .from("jeremy_action_executions")
    .insert({
      client_id: input.clientId,
      cycle_id: input.cycleId ?? null,
      recommendation_id: input.recommendationId ?? null,
      idempotency_key: key,
      action: input.action,
      entity_type: input.entityType,
      meta_entity_id: input.metaEntityId,
      requested_change: payload,
      status: "claimed",
      dry_run: Boolean(dryRun),
      executed_by: input.executedBy,
    })
    .select("id")
    .maybeSingle();

  if (claimErr) {
    return { success: false, status: "blocked", verification_status: "skipped_dry_run", reason: `Already executed or claimed (idempotency): ${claimErr.message}` };
  }
  const executionId = claim?.id as string;

  try {
    const before = await provider.read(input.entityType, input.metaEntityId);
    await db.from("jeremy_action_executions").update({ status: "executing", before_snapshot: before }).eq("id", executionId);

    if (dryRun) {
      await db
        .from("jeremy_action_executions")
        .update({ status: "succeeded", verification_status: "skipped_dry_run", executed_at: new Date().toISOString(), provider_receipt: { dry_run: true } })
        .eq("id", executionId);
      return { success: true, status: "succeeded", verification_status: "skipped_dry_run", reason: "Dry run: no provider mutation was sent.", execution_id: executionId, before, after: null };
    }

    const params: Record<string, string> =
      input.action === "pause" ? { status: "PAUSED" } : { daily_budget: String(Math.round(Number(input.proposedDailyBudget) * 100)) };
    const receipt = await provider.mutate(input.entityType, input.metaEntityId, params);
    await db.from("jeremy_action_executions").update({ provider_receipt: receipt, executed_at: new Date().toISOString() }).eq("id", executionId);

    const after = await provider.read(input.entityType, input.metaEntityId);
    const verified = verifyReadBack(input.action, params, after);
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

    return {
      success: verified.ok,
      status: verified.ok ? "succeeded" : "verification_failed",
      verification_status: verified.ok ? "verified" : "mismatch",
      reason: verified.reason,
      execution_id: executionId,
      before,
      after,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("jeremy_action_executions").update({ status: "failed", verification_status: "failed", error_detail: message }).eq("id", executionId);
    return { success: false, status: "failed", verification_status: "failed", reason: message, execution_id: executionId };
  }
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
// Whole loop
// ─────────────────────────────────────────────────────────────────────────────

export interface RunCycleOptions {
  windowDays?: number;
  includeApify?: boolean;
  apifyExpectedCostUsd?: number;
  topCandidates?: number;
  createLaunches?: boolean;
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
    await advanceCycle(db, cycle.id, "launch", { evidence: { prepared } });

    const launches = opts.createLaunches ? await createLaunchBatch(db, clientId, candidate_ids) : { items: [], launch_status: LAUNCH_STATUS };
    await advanceCycle(db, cycle.id, "analysis", { evidence: { launches } });

    const analysis = await analyzeAccount(db, clientId, policy, windowDays);
    const snapshotId = await saveKpiSnapshot(db, clientId, cycle.id, aggregateSnapshot(analysis), analysis.coverage, windowDays);
    await advanceCycle(db, cycle.id, "action", { kpi_snapshot_id: snapshotId, evidence: { basis: analysis.basis } });

    const plan = await planActions(db, clientId, policy, analysis);
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
      launches,
      coverage: analysis.coverage,
      basis: analysis.basis,
      plan,
      executed: [] as unknown[],
      note: policy.mode === "shadow"
        ? "Shadow mode: every decision was recorded, nothing was executed and nothing was published."
        : "Actions require explicit approval before execution; all launches are PAUSED drafts.",
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
  const [{ data: cycle }, { data: candidates }, { data: executions }] = await Promise.all([
    db.from("jeremy_cycles").select("*").eq("id", cycleId).maybeSingle(),
    db.from("jeremy_creative_candidates").select("*").eq("cycle_id", cycleId).order("rank", { ascending: true }),
    db.from("jeremy_action_executions").select("*").eq("cycle_id", cycleId).order("created_at", { ascending: false }),
  ]);
  return { cycle, candidates: candidates ?? [], executions: executions ?? [] };
}

export { kpiContract, loadPolicy };
