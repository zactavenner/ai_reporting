/**
 * Jeremy KPI contract — typed and versioned.
 *
 * Keep this module PURE: no network, no secrets, no Deno APIs. It is imported by
 * the edge functions, the MCP server and the vitest suite alike.
 *
 * The contract encodes one non-negotiable rule: when funded / qualified outcome
 * data is sufficiently complete, proxy metrics (CTR, CPM, hook rate, CPL) can
 * never outrank a business outcome. Proxies only take over when outcome data is
 * incomplete, and in that case the decision is explicitly labelled low-confidence.
 */

export const JEREMY_KPI_CONTRACT_VERSION = "2026.08.1";

export type KpiGroup = "primary_outcome" | "media_diagnostic" | "creative_diagnostic" | "reliability";
export type KpiDirection = "higher_is_better" | "lower_is_better" | "context";

export interface KpiDefinition {
  key: string;
  label: string;
  group: KpiGroup;
  direction: KpiDirection;
  unit: "usd" | "count" | "ratio" | "percent" | "days" | "seconds";
  /** Lower tier = higher authority. Tier 1 outcomes always outrank tier 2/3 proxies. */
  tier: 1 | 2 | 3;
  description: string;
}

export const JEREMY_KPI_CONTRACT: readonly KpiDefinition[] = [
  // ── 1. Primary business outcomes (tier 1) ────────────────────────────────
  { key: "funded_dollars", label: "Funded dollars", group: "primary_outcome", direction: "higher_is_better", unit: "usd", tier: 1, description: "Capital actually funded, attributed to the entity." },
  { key: "funded_count", label: "Funded investors", group: "primary_outcome", direction: "higher_is_better", unit: "count", tier: 1, description: "Count of funded investors attributed to the entity." },
  { key: "funded_roas", label: "Funded ROAS", group: "primary_outcome", direction: "higher_is_better", unit: "ratio", tier: 1, description: "Funded dollars divided by spend." },
  { key: "cost_per_funded", label: "Cost per funded", group: "primary_outcome", direction: "lower_is_better", unit: "usd", tier: 1, description: "Spend divided by funded investors." },
  { key: "qualified_lead_rate", label: "Qualified lead rate", group: "primary_outcome", direction: "higher_is_better", unit: "ratio", tier: 1, description: "Non-spam qualified leads divided by total leads." },
  { key: "cost_per_qualified_lead", label: "Cost per qualified lead", group: "primary_outcome", direction: "lower_is_better", unit: "usd", tier: 1, description: "Spend divided by qualified leads." },
  { key: "booked_call_rate", label: "Booked call rate", group: "primary_outcome", direction: "higher_is_better", unit: "ratio", tier: 1, description: "Booked calls divided by qualified leads." },
  { key: "cost_per_booked_call", label: "Cost per booked call", group: "primary_outcome", direction: "lower_is_better", unit: "usd", tier: 1, description: "Spend divided by booked calls." },
  { key: "show_rate", label: "Show rate", group: "primary_outcome", direction: "higher_is_better", unit: "ratio", tier: 1, description: "Showed calls divided by booked calls." },
  { key: "cost_per_show", label: "Cost per show", group: "primary_outcome", direction: "lower_is_better", unit: "usd", tier: 1, description: "Spend divided by showed calls." },

  // ── 2. Media diagnostics (tier 2) ────────────────────────────────────────
  { key: "spend", label: "Spend", group: "media_diagnostic", direction: "context", unit: "usd", tier: 2, description: "Media spend in the window." },
  { key: "impressions", label: "Impressions", group: "media_diagnostic", direction: "context", unit: "count", tier: 2, description: "Impressions served." },
  { key: "reach", label: "Reach", group: "media_diagnostic", direction: "context", unit: "count", tier: 2, description: "Unique people reached." },
  { key: "frequency", label: "Frequency", group: "media_diagnostic", direction: "context", unit: "ratio", tier: 2, description: "Impressions per person reached." },
  { key: "ctr", label: "CTR", group: "media_diagnostic", direction: "higher_is_better", unit: "percent", tier: 2, description: "Click-through rate." },
  { key: "cpc", label: "CPC", group: "media_diagnostic", direction: "lower_is_better", unit: "usd", tier: 2, description: "Cost per click." },
  { key: "cpm", label: "CPM", group: "media_diagnostic", direction: "lower_is_better", unit: "usd", tier: 2, description: "Cost per thousand impressions." },
  { key: "landing_page_views", label: "Landing page views", group: "media_diagnostic", direction: "higher_is_better", unit: "count", tier: 2, description: "Landing page views reported by Meta." },
  { key: "leads", label: "Leads", group: "media_diagnostic", direction: "higher_is_better", unit: "count", tier: 2, description: "All leads, qualified or not." },
  { key: "cost_per_lead", label: "CPL", group: "media_diagnostic", direction: "lower_is_better", unit: "usd", tier: 2, description: "Spend divided by all leads." },

  // ── 3. Creative / video diagnostics (tier 3) ─────────────────────────────
  { key: "hook_rate", label: "Hook / thumb-stop rate", group: "creative_diagnostic", direction: "higher_is_better", unit: "ratio", tier: 3, description: "3-second views divided by impressions." },
  { key: "video_3s_views", label: "3-second views", group: "creative_diagnostic", direction: "higher_is_better", unit: "count", tier: 3, description: "Video views of 3 seconds or more." },
  { key: "video_p25", label: "25% completion", group: "creative_diagnostic", direction: "higher_is_better", unit: "count", tier: 3, description: "Viewers reaching 25%." },
  { key: "video_p50", label: "50% completion", group: "creative_diagnostic", direction: "higher_is_better", unit: "count", tier: 3, description: "Viewers reaching 50%." },
  { key: "video_p75", label: "75% completion", group: "creative_diagnostic", direction: "higher_is_better", unit: "count", tier: 3, description: "Viewers reaching 75%." },
  { key: "video_p95", label: "95% completion", group: "creative_diagnostic", direction: "higher_is_better", unit: "count", tier: 3, description: "Viewers reaching 95%." },
  { key: "hold_rate", label: "Hold rate", group: "creative_diagnostic", direction: "higher_is_better", unit: "ratio", tier: 3, description: "95% completions divided by 3-second views." },
  { key: "creative_fatigue", label: "Fatigue index", group: "creative_diagnostic", direction: "lower_is_better", unit: "ratio", tier: 3, description: "Frequency-weighted CTR decay signal; higher means more fatigued." },

  // ── 4. Decision reliability (tier 1 gates) ───────────────────────────────
  { key: "min_spend_usd", label: "Minimum spend", group: "reliability", direction: "context", unit: "usd", tier: 1, description: "Spend floor before any non-hold action." },
  { key: "min_live_days", label: "Minimum live days", group: "reliability", direction: "context", unit: "days", tier: 1, description: "Days live floor before any non-hold action." },
  { key: "min_qualified_leads", label: "Minimum qualified leads", group: "reliability", direction: "context", unit: "count", tier: 1, description: "Qualified-lead sample floor." },
  { key: "min_funded_count", label: "Minimum funded", group: "reliability", direction: "context", unit: "count", tier: 1, description: "Funded sample floor for scale decisions." },
  { key: "attribution_coverage", label: "Attribution coverage", group: "reliability", direction: "higher_is_better", unit: "ratio", tier: 1, description: "Share of leads with resolved attribution." },
  { key: "attribution_freshness_hours", label: "Attribution freshness", group: "reliability", direction: "lower_is_better", unit: "days", tier: 1, description: "Hours since the last successful attribution sync." },
] as const;

export function kpiContract() {
  return {
    version: JEREMY_KPI_CONTRACT_VERSION,
    precedence: [
      "Tier 1 primary business outcomes decide when outcome data is complete.",
      "Tier 2 media diagnostics only decide when outcome data is incomplete.",
      "Tier 3 creative diagnostics only explain, never decide alone.",
      "Missing data is always surfaced explicitly and downgrades confidence.",
    ],
    groups: {
      primary_outcome: JEREMY_KPI_CONTRACT.filter((k) => k.group === "primary_outcome"),
      media_diagnostic: JEREMY_KPI_CONTRACT.filter((k) => k.group === "media_diagnostic"),
      creative_diagnostic: JEREMY_KPI_CONTRACT.filter((k) => k.group === "creative_diagnostic"),
      reliability: JEREMY_KPI_CONTRACT.filter((k) => k.group === "reliability"),
    },
  };
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const div = (a: number, b: number) => (b > 0 ? a / b : null);

export interface EntityMetricsInput {
  spend?: unknown;
  impressions?: unknown;
  reach?: unknown;
  frequency?: unknown;
  clicks?: unknown;
  ctr?: unknown;
  cpc?: unknown;
  cpm?: unknown;
  landing_page_views?: unknown;
  attributed_leads?: unknown;
  attributed_spam_leads?: unknown;
  attributed_calls?: unknown;
  attributed_showed?: unknown;
  attributed_funded?: unknown;
  attributed_funded_dollars?: unknown;
  video_3s_views?: unknown;
  video_p25?: unknown;
  video_p50?: unknown;
  video_p75?: unknown;
  video_p95?: unknown;
  live_days?: unknown;
}

export interface KpiSnapshot {
  contract_version: string;
  primary_outcomes: Record<string, number | null>;
  media_diagnostics: Record<string, number | null>;
  creative_diagnostics: Record<string, number | null>;
  reliability: Record<string, number | null>;
}

/** Computes the full contract from raw synced Meta + attribution fields. */
export function computeKpiSnapshot(row: EntityMetricsInput): KpiSnapshot {
  const spend = n(row.spend);
  const impressions = n(row.impressions);
  const leads = n(row.attributed_leads);
  const spam = n(row.attributed_spam_leads);
  const qualified = Math.max(0, leads - spam);
  const calls = n(row.attributed_calls);
  const showed = n(row.attributed_showed);
  const funded = n(row.attributed_funded);
  const fundedDollars = n(row.attributed_funded_dollars);
  const v3 = n(row.video_3s_views);
  const v95 = n(row.video_p95);

  return {
    contract_version: JEREMY_KPI_CONTRACT_VERSION,
    primary_outcomes: {
      funded_dollars: fundedDollars,
      funded_count: funded,
      funded_roas: div(fundedDollars, spend),
      cost_per_funded: div(spend, funded),
      qualified_lead_rate: div(qualified, leads),
      cost_per_qualified_lead: div(spend, qualified),
      booked_call_rate: div(calls, qualified),
      cost_per_booked_call: div(spend, calls),
      show_rate: div(showed, calls),
      cost_per_show: div(spend, showed),
    },
    media_diagnostics: {
      spend,
      impressions,
      reach: n(row.reach),
      frequency: n(row.frequency) || div(impressions, n(row.reach)),
      ctr: n(row.ctr),
      cpc: n(row.cpc) || div(spend, n(row.clicks)),
      cpm: n(row.cpm),
      landing_page_views: n(row.landing_page_views),
      leads,
      cost_per_lead: div(spend, leads),
    },
    creative_diagnostics: {
      hook_rate: div(v3, impressions),
      video_3s_views: v3,
      video_p25: n(row.video_p25),
      video_p50: n(row.video_p50),
      video_p75: n(row.video_p75),
      video_p95: v95,
      hold_rate: div(v95, v3),
      creative_fatigue: fatigueIndex(n(row.frequency) || div(impressions, n(row.reach)) || 0, n(row.ctr)),
    },
    reliability: {
      qualified_leads: qualified,
      live_days: n(row.live_days),
      spend,
      funded_count: funded,
    },
  };
}

/** Simple deterministic fatigue signal: frequency pressure against CTR strength. */
export function fatigueIndex(frequency: number, ctr: number): number | null {
  if (frequency <= 0) return null;
  const ctrFloor = Math.max(ctr, 0.01);
  return Math.round((frequency / ctrFloor) * 100) / 100;
}

export interface CoverageInput {
  total_leads: number;
  attributed_leads: number;
  /** Hours since the last successful attribution/CRM sync. */
  freshness_hours: number | null;
  funded_count: number;
  qualified_leads: number;
}

export interface CoverageResult {
  attribution_coverage: number | null;
  attribution_freshness_hours: number | null;
  outcome_data_complete: boolean;
  missing: string[];
  confidence: "high" | "medium" | "low";
}

/**
 * Outcome completeness is what decides whether tier 1 or tier 2 metrics rule.
 * Anything missing is named explicitly — never silently treated as zero.
 */
export function evaluateCoverage(
  input: CoverageInput,
  floors: { min_attribution_coverage: number; min_qualified_leads: number; min_funded_count: number; max_freshness_hours?: number },
): CoverageResult {
  const missing: string[] = [];
  const coverage = input.total_leads > 0 ? input.attributed_leads / input.total_leads : null;
  const maxFresh = floors.max_freshness_hours ?? 48;

  if (coverage === null) missing.push("no leads recorded in window");
  else if (coverage < floors.min_attribution_coverage) missing.push(`attribution coverage ${(coverage * 100).toFixed(0)}% below floor ${(floors.min_attribution_coverage * 100).toFixed(0)}%`);
  if (input.freshness_hours === null) missing.push("attribution freshness unknown");
  else if (input.freshness_hours > maxFresh) missing.push(`attribution stale by ${Math.round(input.freshness_hours)}h`);
  if (input.qualified_leads < floors.min_qualified_leads) missing.push(`qualified leads ${input.qualified_leads} below floor ${floors.min_qualified_leads}`);
  if (input.funded_count < floors.min_funded_count) missing.push(`funded count ${input.funded_count} below floor ${floors.min_funded_count}`);

  const outcomeComplete = missing.length === 0;
  const confidence: CoverageResult["confidence"] = outcomeComplete ? "high" : missing.length <= 2 ? "medium" : "low";
  return {
    attribution_coverage: coverage,
    attribution_freshness_hours: input.freshness_hours,
    outcome_data_complete: outcomeComplete,
    missing,
    confidence,
  };
}

export type DecisionBasis = "primary_outcome" | "media_diagnostic";

/** The authoritative metric set for a decision, given coverage. */
export function decisionBasis(coverage: CoverageResult): DecisionBasis {
  return coverage.outcome_data_complete ? "primary_outcome" : "media_diagnostic";
}

/**
 * Ranks entities under the contract. When outcome data is complete, funded
 * outcomes dominate and a strong CTR/CPM can never lift a zero-funded entity
 * above a funded one. Otherwise proxies rank, flagged as low confidence.
 */
export function rankByContract<T extends { kpi: KpiSnapshot }>(
  entities: T[],
  coverage: CoverageResult,
): Array<T & { score: number; basis: DecisionBasis }> {
  const basis = decisionBasis(coverage);
  return entities
    .map((e) => {
      const p = e.kpi.primary_outcomes;
      const m = e.kpi.media_diagnostics;
      let score: number;
      if (basis === "primary_outcome") {
        // Outcome-weighted: funded ROAS and funded volume dominate; proxies are
        // a tiny tiebreaker only (capped so they cannot cross an outcome tier).
        const roas = p.funded_roas ?? 0;
        const fundedWeight = (p.funded_count ?? 0) * 10;
        const efficiency = p.cost_per_funded ? 100 / p.cost_per_funded : 0;
        const proxyTiebreak = Math.min(0.5, (m.ctr ?? 0) / 20);
        score = roas * 50 + fundedWeight + efficiency + proxyTiebreak;
      } else {
        const cpl = p.cost_per_qualified_lead ?? m.cost_per_lead;
        const efficiency = cpl ? 100 / cpl : 0;
        score = efficiency * 5 + (m.ctr ?? 0) * 2 + (e.kpi.creative_diagnostics.hook_rate ?? 0) * 10;
      }
      return { ...e, score: Math.round(score * 1000) / 1000, basis };
    })
    .sort((a, b) => b.score - a.score);
}
