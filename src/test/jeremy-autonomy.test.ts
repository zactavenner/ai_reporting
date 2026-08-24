import { describe, expect, it } from 'vitest';
import {
  computeKpiSnapshot,
  evaluateCoverage,
  rankByContract,
  decisionBasis,
  kpiContract,
} from '../../supabase/functions/_shared/jeremyKpiContract';
import {
  defaultPolicy,
  normalizePolicy,
  checkPaidCapability,
  checkSampleFloors,
  checkCooldown,
  checkMode,
  clampScale,
  isDestructiveAction,
  SCALE_HARD_MAX_PCT,
} from '../../supabase/functions/_shared/jeremyPolicy';
import {
  idempotencyKey,
  verifyReadBack,
  buildRecreationBrief,
  LAUNCH_STATUS,
} from '../../supabase/functions/_shared/jeremyAutonomy';

const FLOORS = { min_attribution_coverage: 0.7, min_qualified_leads: 5, min_funded_count: 1 };
const completeCoverage = evaluateCoverage(
  { total_leads: 100, attributed_leads: 95, freshness_hours: 2, funded_count: 3, qualified_leads: 40 },
  FLOORS,
);
const incompleteCoverage = evaluateCoverage(
  { total_leads: 100, attributed_leads: 20, freshness_hours: null, funded_count: 0, qualified_leads: 1 },
  FLOORS,
);

describe('default autonomy posture', () => {
  it('defaults to shadow mode with nothing paid enabled', () => {
    const p = defaultPolicy('c1');
    expect(p.mode).toBe('shadow');
    expect(p.allowed_actions).toEqual(['hold']);
    expect(p.paid_discovery_enabled).toBe(false);
    expect(p.paid_generation_enabled).toBe(false);
    expect(p.paid_discovery_per_run_cap_usd).toBe(0);
    expect(p.paid_generation_monthly_cap_usd).toBe(0);
  });

  it('coerces an unknown stored mode back to shadow and clamps scale ceilings', () => {
    const p = normalizePolicy('c1', { mode: 'yolo', scale_max_pct: 500, scale_hard_max_pct: 900 });
    expect(p.mode).toBe('shadow');
    expect(p.scale_hard_max_pct).toBe(SCALE_HARD_MAX_PCT);
    expect(p.scale_max_pct).toBeLessThanOrEqual(SCALE_HARD_MAX_PCT);
  });

  it('never executes in shadow mode, even with human approval', () => {
    const p = { ...defaultPolicy('c1'), allowed_actions: ['pause' as const] };
    expect(checkMode(p, 'pause', true).allowed).toBe(false);
  });

  it('requires an explicit approval in approval mode and permits autopilot', () => {
    const base = { ...defaultPolicy('c1'), allowed_actions: ['pause' as const] };
    expect(checkMode({ ...base, mode: 'approval' }, 'pause', false).allowed).toBe(false);
    expect(checkMode({ ...base, mode: 'approval' }, 'pause', true).allowed).toBe(true);
    expect(checkMode({ ...base, mode: 'autopilot' }, 'pause', false).allowed).toBe(true);
  });

  it('never allows a destructive action', () => {
    expect(isDestructiveAction('delete')).toBe(true);
    expect(isDestructiveAction('archive_adset')).toBe(true);
    expect(isDestructiveAction('pause')).toBe(false);
  });
});

describe('KPI contract precedence and missing data', () => {
  it('exposes a version and all four groups', () => {
    const c = kpiContract();
    expect(c.version).toMatch(/\d{4}\./);
    expect(c.groups.primary_outcome.length).toBeGreaterThan(5);
    expect(c.groups.media_diagnostic.length).toBeGreaterThan(5);
    expect(c.groups.creative_diagnostic.length).toBeGreaterThan(5);
    expect(c.groups.reliability.length).toBeGreaterThan(3);
  });

  it('lists missing outcome data explicitly instead of assuming zero', () => {
    expect(incompleteCoverage.outcome_data_complete).toBe(false);
    expect(incompleteCoverage.missing.length).toBeGreaterThan(2);
    expect(incompleteCoverage.confidence).toBe('low');
    expect(decisionBasis(incompleteCoverage)).toBe('media_diagnostic');
    expect(decisionBasis(completeCoverage)).toBe('primary_outcome');
  });

  it('never lets a high-CTR zero-funded entity outrank a funded entity', () => {
    const funded = { id: 'funded', kpi: computeKpiSnapshot({ spend: 1000, attributed_funded: 4, attributed_funded_dollars: 5000, attributed_leads: 50, ctr: 0.4, impressions: 10000 }) };
    const proxy = { id: 'proxy', kpi: computeKpiSnapshot({ spend: 1000, attributed_funded: 0, attributed_funded_dollars: 0, attributed_leads: 200, ctr: 9.9, impressions: 10000 }) };
    const ranked = rankByContract([proxy, funded], completeCoverage);
    expect(ranked[0].id).toBe('funded');
    expect(ranked[0].basis).toBe('primary_outcome');
  });

  it('falls back to proxy ranking only when outcome data is incomplete', () => {
    const a = { id: 'cheap', kpi: computeKpiSnapshot({ spend: 100, attributed_leads: 50, ctr: 3 }) };
    const b = { id: 'pricey', kpi: computeKpiSnapshot({ spend: 100, attributed_leads: 5, ctr: 1 }) };
    const ranked = rankByContract([b, a], incompleteCoverage);
    expect(ranked[0].id).toBe('cheap');
    expect(ranked[0].basis).toBe('media_diagnostic');
  });
});

describe('paid capability refusal', () => {
  const p = defaultPolicy('c1');
  it('refuses when disabled', () => {
    expect(checkPaidCapability(p, 'discovery', 1).allowed).toBe(false);
    expect(checkPaidCapability(p, 'generation', 1).allowed).toBe(false);
  });
  it('refuses when enabled but uncapped', () => {
    const enabled = { ...p, paid_discovery_enabled: true };
    expect(checkPaidCapability(enabled, 'discovery', 1).allowed).toBe(false);
    const perRunOnly = { ...enabled, paid_discovery_per_run_cap_usd: 5 };
    expect(checkPaidCapability(perRunOnly, 'discovery', 1).allowed).toBe(false);
  });
  it('refuses an unknown cost and over-cap costs, allows a capped run', () => {
    const capped = { ...p, paid_generation_enabled: true, paid_generation_per_run_cap_usd: 5, paid_generation_monthly_cap_usd: 20 };
    expect(checkPaidCapability(capped, 'generation', NaN).allowed).toBe(false);
    expect(checkPaidCapability(capped, 'generation', 6).allowed).toBe(false);
    expect(checkPaidCapability(capped, 'generation', 4, 18).allowed).toBe(false);
    expect(checkPaidCapability(capped, 'generation', 4, 2).allowed).toBe(true);
  });
});

describe('sample floors, cooldown and scale caps', () => {
  const p = defaultPolicy('c1');
  it('refuses low-spend and low-sample actions but allows hold', () => {
    expect(checkSampleFloors(p, { spend: 20, live_days: 10, qualified_leads: 10, funded_count: 2 }, 'pause').allowed).toBe(false);
    expect(checkSampleFloors(p, { spend: 500, live_days: 1, qualified_leads: 10, funded_count: 2 }, 'pause').allowed).toBe(false);
    expect(checkSampleFloors(p, { spend: 500, live_days: 10, qualified_leads: 1, funded_count: 2 }, 'pause').allowed).toBe(false);
    expect(checkSampleFloors(p, { spend: 500, live_days: 10, qualified_leads: 10, funded_count: 0 }, 'adjust_budget').allowed).toBe(false);
    expect(checkSampleFloors(p, { spend: 0, live_days: 0, qualified_leads: 0, funded_count: 0 }, 'hold').allowed).toBe(true);
    expect(checkSampleFloors(p, { spend: 500, live_days: 10, qualified_leads: 10, funded_count: 2 }, 'pause').allowed).toBe(true);
  });

  it('refuses inside the 72-hour cooldown and allows after it', () => {
    const now = new Date('2026-08-24T00:00:00Z');
    expect(checkCooldown(p, '2026-08-23T12:00:00Z', now).allowed).toBe(false);
    expect(checkCooldown(p, '2026-08-19T00:00:00Z', now).allowed).toBe(true);
    expect(checkCooldown(p, null, now).allowed).toBe(true);
  });

  it('applies +20% by default and never exceeds +30%', () => {
    const scaled = clampScale(p, 100, 1000);
    expect(scaled.allowed).toBe(true);
    expect(scaled.approved_daily_budget).toBe(120);

    const aggressive = clampScale({ ...p, scale_max_pct: 90, scale_hard_max_pct: 90 }, 100, 1000);
    expect(aggressive.approved_daily_budget).toBe(130);
  });

  it('rejects decreases and enforces daily + account delta caps', () => {
    expect(clampScale(p, 100, 90).allowed).toBe(false);
    expect(clampScale({ ...p, max_daily_budget_usd: 100 }, 100, 120).allowed).toBe(false);
    const clamped = clampScale({ ...p, max_account_daily_budget_delta_usd: 5 }, 100, 120);
    expect(clamped.approved_daily_budget).toBe(105);
    expect(clampScale({ ...p, max_account_daily_budget_delta_usd: 5 }, 100, 120, 5).allowed).toBe(false);
  });
});

describe('execution safety', () => {
  it('produces a stable idempotency key regardless of key order', () => {
    const a = idempotencyKey('c1', 'e1', 'adjust_budget', { daily_budget: 120, note: 'x' });
    const b = idempotencyKey('c1', 'e1', 'adjust_budget', { note: 'x', daily_budget: 120 });
    expect(a).toBe(b);
    expect(a).not.toBe(idempotencyKey('c1', 'e1', 'adjust_budget', { daily_budget: 130 }));
  });

  it('treats a provider read-back mismatch as a failure, never success', () => {
    expect(verifyReadBack('pause', { status: 'PAUSED' }, { status: 'ACTIVE' }).ok).toBe(false);
    expect(verifyReadBack('pause', { status: 'PAUSED' }, { status: 'PAUSED' }).ok).toBe(true);
    expect(verifyReadBack('adjust_budget', { daily_budget: '12000' }, {}).ok).toBe(false);
    expect(verifyReadBack('adjust_budget', { daily_budget: '12000' }, { daily_budget: 9000 }).ok).toBe(false);
    expect(verifyReadBack('adjust_budget', { daily_budget: '12000' }, { daily_budget: 12000 }).ok).toBe(true);
  });

  it('launches are PAUSED by contract', () => {
    expect(LAUNCH_STATUS).toBe('PAUSED');
  });
});

describe('recreation briefs stay derivative', () => {
  it('preserves the mechanism and forbids copying protected assets', () => {
    const brief = buildRecreationBrief({
      source_type: 'scraped_ad',
      source_reference: 's1',
      source_url: null,
      title: 'Investor hook',
      evidence: { headline: 'Tired of 4% yields?', body: 'Angle body', media_type: 'video' },
      kpi: computeKpiSnapshot({}),
    });
    expect(brief.mechanism.hook).toContain('Tired of 4% yields?');
    expect(brief.suggested_kind).toBe('video');
    expect(brief.derivative_instructions.toLowerCase()).toContain('do not reproduce');
    expect(brief.guardrails.join(' ').toLowerCase()).toContain('no guaranteed-return');
  });
});

describe('no Gregory anywhere in the Jeremy workflow', () => {
  it('keeps the new workflow modules Gregory-free', async () => {
    const files = [
      '../../supabase/functions/_shared/jeremyAutonomy.ts?raw',
      '../../supabase/functions/_shared/jeremyPolicy.ts?raw',
      '../../supabase/functions/_shared/jeremyKpiContract.ts?raw',
      '../../supabase/functions/jeremy-autonomous/index.ts?raw',
    ];
    for (const f of files) {
      const mod = (await import(/* @vite-ignore */ f)) as { default: string };
      expect(mod.default.toLowerCase()).not.toContain('gregory');
    }
  });
});
