/**
 * Jeremy autonomy policy — deterministic, server-side guardrails.
 *
 * PURE module (no network, no secrets, no Deno APIs) except for the explicit
 * `loadPolicy` helper, which takes an already-authenticated client.
 *
 * Every gate here is evaluated on the server for every mutating path. The model
 * is never trusted: it proposes, this module decides.
 */

export type AutonomyMode = "shadow" | "approval" | "autopilot";
export type JeremyAction = "hold" | "pause" | "adjust_budget";
export type PaidCapability = "discovery" | "generation";

export interface JeremyPolicy {
  client_id: string;
  ad_account_id: string | null;
  mode: AutonomyMode;
  allowed_actions: JeremyAction[];
  paid_discovery_enabled: boolean;
  paid_discovery_per_run_cap_usd: number;
  paid_discovery_monthly_cap_usd: number;
  paid_generation_enabled: boolean;
  paid_generation_per_run_cap_usd: number;
  paid_generation_monthly_cap_usd: number;
  min_spend_usd: number;
  min_live_days: number;
  min_qualified_leads: number;
  min_funded_count: number;
  min_attribution_coverage: number;
  scale_max_pct: number;
  scale_hard_max_pct: number;
  cooldown_hours: number;
  max_daily_budget_usd: number;
  max_account_daily_budget_delta_usd: number;
}

/** Hard ceilings that a stored policy row can never exceed. */
export const SCALE_DEFAULT_PCT = 20;
export const SCALE_HARD_MAX_PCT = 30;
export const COOLDOWN_DEFAULT_HOURS = 72;

/** Safe defaults for any client without an explicit policy row: shadow, nothing paid. */
export function defaultPolicy(clientId: string): JeremyPolicy {
  return {
    client_id: clientId,
    ad_account_id: null,
    mode: "shadow",
    allowed_actions: ["hold"],
    paid_discovery_enabled: false,
    paid_discovery_per_run_cap_usd: 0,
    paid_discovery_monthly_cap_usd: 0,
    paid_generation_enabled: false,
    paid_generation_per_run_cap_usd: 0,
    paid_generation_monthly_cap_usd: 0,
    min_spend_usd: 100,
    min_live_days: 3,
    min_qualified_leads: 5,
    min_funded_count: 1,
    min_attribution_coverage: 0.7,
    scale_max_pct: SCALE_DEFAULT_PCT,
    scale_hard_max_pct: SCALE_HARD_MAX_PCT,
    cooldown_hours: COOLDOWN_DEFAULT_HOURS,
    max_daily_budget_usd: 500,
    max_account_daily_budget_delta_usd: 250,
  };
}

const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Normalises a stored row, clamping anything above the hard ceilings. */
export function normalizePolicy(clientId: string, row: Record<string, unknown> | null | undefined): JeremyPolicy {
  const base = defaultPolicy(clientId);
  if (!row) return base;
  const mode = ["shadow", "approval", "autopilot"].includes(String(row.mode)) ? (String(row.mode) as AutonomyMode) : "shadow";
  const allowed = Array.isArray(row.allowed_actions)
    ? (row.allowed_actions as unknown[]).map(String).filter((a): a is JeremyAction => ["hold", "pause", "adjust_budget"].includes(a))
    : base.allowed_actions;
  const hardMax = Math.min(num(row.scale_hard_max_pct, SCALE_HARD_MAX_PCT), SCALE_HARD_MAX_PCT);
  return {
    ...base,
    ad_account_id: row.ad_account_id ? String(row.ad_account_id) : null,
    mode,
    allowed_actions: allowed.length ? allowed : ["hold"],
    paid_discovery_enabled: row.paid_discovery_enabled === true,
    paid_discovery_per_run_cap_usd: Math.max(0, num(row.paid_discovery_per_run_cap_usd, 0)),
    paid_discovery_monthly_cap_usd: Math.max(0, num(row.paid_discovery_monthly_cap_usd, 0)),
    paid_generation_enabled: row.paid_generation_enabled === true,
    paid_generation_per_run_cap_usd: Math.max(0, num(row.paid_generation_per_run_cap_usd, 0)),
    paid_generation_monthly_cap_usd: Math.max(0, num(row.paid_generation_monthly_cap_usd, 0)),
    min_spend_usd: Math.max(0, num(row.min_spend_usd, base.min_spend_usd)),
    min_live_days: Math.max(0, num(row.min_live_days, base.min_live_days)),
    min_qualified_leads: Math.max(0, num(row.min_qualified_leads, base.min_qualified_leads)),
    min_funded_count: Math.max(0, num(row.min_funded_count, base.min_funded_count)),
    min_attribution_coverage: Math.min(1, Math.max(0, num(row.min_attribution_coverage, base.min_attribution_coverage))),
    scale_hard_max_pct: hardMax,
    scale_max_pct: Math.min(num(row.scale_max_pct, SCALE_DEFAULT_PCT), hardMax),
    cooldown_hours: Math.max(0, num(row.cooldown_hours, COOLDOWN_DEFAULT_HOURS)),
    max_daily_budget_usd: Math.max(0, num(row.max_daily_budget_usd, base.max_daily_budget_usd)),
    max_account_daily_budget_delta_usd: Math.max(0, num(row.max_account_daily_budget_delta_usd, base.max_account_daily_budget_delta_usd)),
  };
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Loads the policy for a client using an already-authenticated client. */
export async function loadPolicy(supabase: Db, clientId: string): Promise<JeremyPolicy> {
  const { data } = await supabase
    .from("jeremy_autonomy_policies")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  return normalizePolicy(clientId, data);
}

export interface GateResult {
  allowed: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

const ok = (reason = "allowed"): GateResult => ({ allowed: true, reason });
const deny = (reason: string, details?: Record<string, unknown>): GateResult => ({ allowed: false, reason, details });

/**
 * Paid Apify discovery and paid image/video generation are OFF by default and
 * refuse to run unless the policy explicitly enables the capability AND defines
 * a positive per-run and monthly cap that the expected cost fits inside.
 */
export function checkPaidCapability(
  policy: JeremyPolicy,
  capability: PaidCapability,
  expectedCostUsd: number,
  monthToDateSpendUsd = 0,
): GateResult {
  const enabled = capability === "discovery" ? policy.paid_discovery_enabled : policy.paid_generation_enabled;
  const perRun = capability === "discovery" ? policy.paid_discovery_per_run_cap_usd : policy.paid_generation_per_run_cap_usd;
  const monthly = capability === "discovery" ? policy.paid_discovery_monthly_cap_usd : policy.paid_generation_monthly_cap_usd;

  if (!enabled) return deny(`Paid ${capability} is disabled for this account.`, { capability });
  if (!(perRun > 0)) return deny(`Paid ${capability} has no positive per-run cost cap configured.`, { per_run_cap: perRun });
  if (!(monthly > 0)) return deny(`Paid ${capability} has no positive monthly cost cap configured.`, { monthly_cap: monthly });
  const cost = Number.isFinite(expectedCostUsd) ? Math.max(0, expectedCostUsd) : NaN;
  if (!Number.isFinite(cost)) return deny(`Expected ${capability} cost is unknown; refusing to spend.`);
  if (cost > perRun) return deny(`Expected cost $${cost} exceeds the per-run cap $${perRun}.`, { cost, per_run_cap: perRun });
  if (monthToDateSpendUsd + cost > monthly) {
    return deny(`Expected cost $${cost} would exceed the monthly cap $${monthly} (already $${monthToDateSpendUsd}).`, { cost, monthly_cap: monthly, month_to_date: monthToDateSpendUsd });
  }
  return ok();
}

export interface SampleInput {
  spend: number;
  live_days: number;
  qualified_leads: number;
  funded_count: number;
}

/** Spend / live-days / sample floors. Applies to every non-hold action. */
export function checkSampleFloors(policy: JeremyPolicy, sample: SampleInput, action: JeremyAction): GateResult {
  if (action === "hold") return ok("hold needs no sample");
  if (sample.spend < policy.min_spend_usd) return deny(`Spend $${sample.spend} is below the $${policy.min_spend_usd} floor.`);
  if (sample.live_days < policy.min_live_days) return deny(`Only ${sample.live_days} live days; floor is ${policy.min_live_days}.`);
  if (sample.qualified_leads < policy.min_qualified_leads) return deny(`Only ${sample.qualified_leads} qualified leads; floor is ${policy.min_qualified_leads}.`);
  if (action === "adjust_budget" && sample.funded_count < policy.min_funded_count) {
    return deny(`Only ${sample.funded_count} funded outcomes; scaling requires ${policy.min_funded_count}.`);
  }
  return ok();
}

/** Cooldown between provider mutations on the same entity. */
export function checkCooldown(policy: JeremyPolicy, lastActionAt: string | Date | null, now: Date = new Date()): GateResult {
  if (!lastActionAt) return ok("no prior action");
  const then = lastActionAt instanceof Date ? lastActionAt : new Date(lastActionAt);
  if (Number.isNaN(then.getTime())) return ok("unparseable prior action timestamp");
  const hours = (now.getTime() - then.getTime()) / 3_600_000;
  if (hours < policy.cooldown_hours) {
    return deny(`Cooldown active: ${hours.toFixed(1)}h since the last action, ${policy.cooldown_hours}h required.`, { hours_elapsed: hours });
  }
  return ok();
}

export interface ScaleResult extends GateResult {
  /** Whole-dollar daily budget that may actually be sent to the provider. */
  approved_daily_budget: number | null;
  applied_pct: number | null;
}

/**
 * Scale is budget INCREASE only, clamped to the policy percentage (default +20%,
 * never above +30%), and then to the maximum daily budget and account delta.
 */
export function clampScale(
  policy: JeremyPolicy,
  currentDailyBudget: number,
  proposedDailyBudget: number,
  accountDeltaAlreadyUsedUsd = 0,
): ScaleResult {
  if (!(currentDailyBudget > 0)) {
    return { allowed: false, reason: "Current daily budget is unknown; refusing to scale.", approved_daily_budget: null, applied_pct: null };
  }
  if (!(proposedDailyBudget > currentDailyBudget)) {
    return { allowed: false, reason: "Scale actions may only increase budget.", approved_daily_budget: null, applied_pct: null };
  }
  const maxPct = Math.min(policy.scale_max_pct, policy.scale_hard_max_pct, SCALE_HARD_MAX_PCT);
  const ceilingByPct = currentDailyBudget * (1 + maxPct / 100);
  let approved = Math.min(proposedDailyBudget, ceilingByPct);

  if (approved > policy.max_daily_budget_usd) approved = policy.max_daily_budget_usd;
  if (!(approved > currentDailyBudget)) {
    return { allowed: false, reason: `Maximum daily budget cap $${policy.max_daily_budget_usd} leaves no room to scale.`, approved_daily_budget: null, applied_pct: null };
  }

  let delta = approved - currentDailyBudget;
  const remainingAccountDelta = policy.max_account_daily_budget_delta_usd - accountDeltaAlreadyUsedUsd;
  if (remainingAccountDelta <= 0) {
    return { allowed: false, reason: `Account-level daily budget delta cap $${policy.max_account_daily_budget_delta_usd} is already used up.`, approved_daily_budget: null, applied_pct: null };
  }
  if (delta > remainingAccountDelta) {
    delta = remainingAccountDelta;
    approved = currentDailyBudget + delta;
  }

  approved = Math.floor(approved);
  if (!(approved > currentDailyBudget)) {
    return { allowed: false, reason: "Caps reduce the increase below one whole dollar.", approved_daily_budget: null, applied_pct: null };
  }
  const pct = ((approved - currentDailyBudget) / currentDailyBudget) * 100;
  return {
    allowed: true,
    reason: `Approved +${pct.toFixed(1)}% (cap +${maxPct}%).`,
    approved_daily_budget: approved,
    applied_pct: Math.round(pct * 100) / 100,
  };
}

/** Whether the mode permits executing (rather than only proposing) an action. */
export function checkMode(policy: JeremyPolicy, action: JeremyAction, humanApproved: boolean): GateResult {
  if (action === "hold") return ok("hold is never executed");
  if (!policy.allowed_actions.includes(action)) return deny(`Action "${action}" is not in this account's allowed actions.`);
  if (policy.mode === "shadow") return deny("Account is in shadow mode: decisions are recorded, never executed.");
  if (policy.mode === "approval" && !humanApproved) return deny("Approval mode requires an explicit human approval before execution.");
  return ok(policy.mode === "autopilot" ? "autopilot permits execution" : "human approved");
}

/** Deletion is never available to Jeremy — pause is the only kill lever. */
export function isDestructiveAction(action: string): boolean {
  return /delete|remove|archive|destroy/i.test(action);
}
