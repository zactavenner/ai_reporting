import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  executeApprovedAction,
  planFingerprint,
  type MetaProvider,
} from '../../supabase/functions/_shared/jeremyAutonomy';
import { defaultPolicy, type JeremyPolicy } from '../../supabase/functions/_shared/jeremyPolicy';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-memory Supabase test double. It supports exactly the chains the
// execution path uses, so the gates are exercised against real data flow.
// ─────────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  let uid = 0;
  const matches = (row: Row, filters: Array<[string, string, any]>) =>
    filters.every(([col, op, val]) => {
      const v = row[col];
      if (op === 'eq') return String(v) === String(val);
      if (op === 'neq') return String(v) !== String(val);
      if (op === 'gte') return String(v) >= String(val);
      if (op === 'in') return (val as any[]).map(String).includes(String(v));
      return true;
    });

  function builder(table: string) {
    const filters: Array<[string, string, any]> = [];
    let mode: 'select' | 'update' | 'insert' = 'select';
    let payload: Row | Row[] = {};
    let orderCol: string | null = null;
    let orderAsc = true;
    let limitN: number | null = null;

    const rowsFor = () => {
      const all = tables[table] ?? (tables[table] = []);
      let out = all.filter((r) => matches(r, filters));
      if (orderCol) out = [...out].sort((a, b) => (orderAsc ? 1 : -1) * String(a[orderCol!] ?? '').localeCompare(String(b[orderCol!] ?? '')));
      if (limitN != null) out = out.slice(0, limitN);
      return out;
    };

    const apply = () => {
      const all = tables[table] ?? (tables[table] = []);
      if (mode === 'insert') {
        const incoming = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `row-${++uid}`, created_at: new Date().toISOString(), ...r }));
        // Enforce the unique idempotency_key constraint like Postgres would.
        for (const r of incoming) {
          if (r.idempotency_key && all.some((e) => e.idempotency_key === r.idempotency_key)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
          }
        }
        all.push(...incoming);
        return { data: incoming, error: null };
      }
      if (mode === 'update') {
        const hit = rowsFor();
        for (const r of hit) Object.assign(r, payload);
        return { data: hit, error: null };
      }
      return { data: rowsFor(), error: null };
    };

    const api: any = {
      select() { return api; },
      insert(p: Row | Row[]) { mode = 'insert'; payload = p; return api; },
      update(p: Row) { mode = 'update'; payload = p; return api; },
      eq(col: string, val: any) { filters.push([col, 'eq', val]); return api; },
      gte(col: string, val: any) { filters.push([col, 'gte', val]); return api; },
      in(col: string, val: any[]) { filters.push([col, 'in', val]); return api; },
      not(col: string, op: string, val: any) { filters.push([col, op === 'eq' ? 'neq' : op, val]); return api; },
      order(col: string, opts?: { ascending?: boolean }) { orderCol = col; orderAsc = opts?.ascending !== false; return api; },
      limit(n: number) { limitN = n; return api; },
      maybeSingle() { const r = apply(); return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }); },
      single() { return api.maybeSingle(); },
      then(res: any, rej: any) { return Promise.resolve(apply()).then(res, rej); },
    };
    return api;
  }

  return { from: (table: string) => builder(table), _tables: tables };
}

const CLIENT = 'client-1';
const ENTITY = 'camp-1';
const NOW = Date.now();

/** Fresh daily metrics that make outcome data complete. */
const goodMetrics = () => [
  { client_id: CLIENT, date: new Date(NOW - 86400000).toISOString().slice(0, 10), ad_spend: 500, leads: 100, spam_leads: 10, calls: 30, showed_calls: 20, funded_investors: 3, funded_dollars: 9000, unattributed_leads: 2, updated_at: new Date(NOW - 3600000).toISOString() },
];

/** A campaign with enough spend, sample, funded outcomes and a $100 daily budget. */
const goodCampaign = (over: Row = {}) => ({
  client_id: CLIENT,
  meta_campaign_id: ENTITY,
  name: 'Winner campaign',
  status: 'ACTIVE',
  effective_status: 'ACTIVE',
  daily_budget: 10000, // cents → $100
  spend: 1000,
  impressions: 50000,
  clicks: 800,
  ctr: 1.6,
  attributed_leads: 60,
  attributed_spam_leads: 5,
  attributed_calls: 20,
  attributed_showed: 12,
  attributed_funded: 4,
  attributed_funded_dollars: 12000,
  start_time: new Date(NOW - 30 * 86400000).toISOString(),
  ...over,
});

function plan(over: Row = {}): Row {
  const action = over.action ?? 'pause';
  const proposed = over.proposed_daily_budget ?? null;
  return {
    id: 'plan-1',
    client_id: CLIENT,
    cycle_id: null,
    entity_type: 'campaign',
    meta_entity_id: ENTITY,
    entity_name: 'Winner campaign',
    action,
    proposed_daily_budget: proposed,
    current_daily_budget: 100,
    payload_fingerprint: planFingerprint(CLIENT, 'campaign', ENTITY, action, proposed),
    basis: 'primary_outcome',
    executable: true,
    status: 'approved',
    expires_at: new Date(NOW + 3600000).toISOString(),
    created_at: new Date(NOW - 60000).toISOString(),
    ...over,
  };
}

/** Provider that records reads and screams if a mutation is ever attempted. */
function provider(currentBudgetCents = 10000) {
  const calls: string[] = [];
  const p: MetaProvider = {
    async read(_t, id) { calls.push(`read:${id}`); return { id, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: currentBudgetCents }; },
    async mutate(_t, id, params) { calls.push(`mutate:${id}:${JSON.stringify(params)}`); throw new Error('provider mutation attempted in a test'); },
  };
  return { p, calls };
}

const APPROVAL: JeremyPolicy = { ...defaultPolicy(CLIENT), mode: 'approval', allowed_actions: ['pause', 'adjust_budget'] };

function baseTables(over: Partial<Record<string, Row[]>> = {}) {
  return {
    jeremy_action_plans: [plan()],
    daily_metrics: goodMetrics(),
    meta_campaigns: [goodCampaign()],
    meta_ad_sets: [],
    meta_ads: [],
    jeremy_action_executions: [],
    ...over,
  } as Record<string, Row[]>;
}

function input(over: Row = {}) {
  return {
    clientId: CLIENT,
    planId: 'plan-1',
    action: 'pause' as const,
    entityType: 'campaign' as const,
    metaEntityId: ENTITY,
    proposedDailyBudget: null,
    executedBy: 'test-operator',
    dryRun: true,
    ...over,
  };
}

describe('execution requires an immutable, approved decision record', () => {
  it('refuses an ad-hoc call with no plan_id', async () => {
    const db = makeDb(baseTables());
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input({ planId: '' }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/persisted plan/i);
  });

  it('refuses an unknown plan_id', async () => {
    const db = makeDb(baseTables());
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input({ planId: 'nope' }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/Unknown plan_id/);
  });

  it('refuses a plan belonging to another client', async () => {
    const db = makeDb(baseTables({ jeremy_action_plans: [plan({ client_id: 'other-client' })] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/different client/i);
  });

  it('refuses a plan that has not been approved', async () => {
    const db = makeDb(baseTables({ jeremy_action_plans: [plan({ status: 'pending' })] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/not approved/i);
  });

  it('refuses a plan that was recorded as not executable', async () => {
    const db = makeDb(baseTables({ jeremy_action_plans: [plan({ executable: false })] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/not executable/i);
  });

  it('refuses stale evidence and marks the plan expired', async () => {
    const tables = baseTables({ jeremy_action_plans: [plan({ expires_at: new Date(NOW - 1000).toISOString() })] });
    const db = makeDb(tables);
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/stale/i);
    expect(tables.jeremy_action_plans[0].status).toBe('expired');
  });

  it('refuses a hold plan', async () => {
    const db = makeDb(baseTables({ jeremy_action_plans: [plan({ action: 'hold' })] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input({ action: 'hold' }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/no-op/i);
  });
});

describe('payload and entity binding cannot be changed after approval', () => {
  it('refuses a different entity than the approved one', async () => {
    const db = makeDb(baseTables());
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input({ metaEntityId: 'camp-999' }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/does not match the approved/i);
    expect(r.gate_evidence?.find((g) => g.gate === 'payload_binding')?.allowed).toBe(false);
  });

  it('refuses a different action than the approved one', async () => {
    const db = makeDb(baseTables());
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input({ action: 'adjust_budget', proposedDailyBudget: 120 }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/does not match the approved/i);
  });

  it('refuses an inflated budget amount supplied by the caller', async () => {
    const db = makeDb(baseTables({ jeremy_action_plans: [plan({ action: 'adjust_budget', proposed_daily_budget: 120 })] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input({ action: 'adjust_budget', proposedDailyBudget: 5000 }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/does not match the approved/i);
  });

  it('refuses a tampered fingerprint even when the request matches the row fields', async () => {
    const db = makeDb(baseTables({ jeremy_action_plans: [plan({ payload_fingerprint: 'forged' })] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/does not match the approved/i);
  });
});

describe('direct execution cannot bypass any deterministic gate', () => {
  it('refuses in shadow mode even with an approved plan', async () => {
    const db = makeDb(baseTables());
    const r = await executeApprovedAction(db, defaultPolicy(CLIENT), provider().p, input());
    expect(r.success).toBe(false);
    expect(r.gate_evidence?.find((g) => g.gate === 'mode')?.allowed).toBe(false);
  });

  it('refuses an action the policy does not allow', async () => {
    const db = makeDb(baseTables());
    const r = await executeApprovedAction(db, { ...APPROVAL, allowed_actions: ['adjust_budget'] }, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/not in this account's allowed actions/i);
  });

  it('refuses when outcome data coverage is incomplete', async () => {
    const db = makeDb(baseTables({ daily_metrics: [] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.gate_evidence?.find((g) => g.gate === 'kpi_precedence')?.allowed).toBe(false);
  });

  it('refuses when the entity no longer exists in synced data', async () => {
    const db = makeDb(baseTables({ meta_campaigns: [] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.gate_evidence?.find((g) => g.gate === 'entity_present')?.allowed).toBe(false);
  });

  it('refuses when the entity fails the spend / sample floors', async () => {
    const db = makeDb(baseTables({ meta_campaigns: [goodCampaign({ spend: 10, attributed_leads: 1, attributed_spam_leads: 0 })] }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.gate_evidence?.find((g) => g.gate === 'sample_floors')?.allowed).toBe(false);
  });

  it('refuses inside the cooldown window', async () => {
    const db = makeDb(baseTables({
      jeremy_action_executions: [{ id: 'x', client_id: CLIENT, meta_entity_id: ENTITY, action: 'pause', status: 'succeeded', created_at: new Date(NOW - 3600000).toISOString(), executed_at: new Date(NOW - 3600000).toISOString() }],
    }));
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.gate_evidence?.find((g) => g.gate === 'cooldown')?.allowed).toBe(false);
  });

  it('recomputes the budget from provider state and refuses an over-cap approved amount', async () => {
    // Plan approved at $200 while the provider reports a $100 daily budget: the
    // +20% clamp permits $120, so the stale $200 approval is refused.
    const db = makeDb(baseTables({ jeremy_action_plans: [plan({ action: 'adjust_budget', proposed_daily_budget: 200 })] }));
    const r = await executeApprovedAction(db, APPROVAL, provider(10000).p, input({ action: 'adjust_budget', proposedDailyBudget: 200 }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/exceeds what the current caps permit|only increase/i);
  });

  it('refuses a budget increase above the account-level daily delta cap', async () => {
    const db = makeDb(baseTables({
      jeremy_action_plans: [plan({ action: 'adjust_budget', proposed_daily_budget: 120 })],
      jeremy_action_executions: [{
        id: 'prior', client_id: CLIENT, meta_entity_id: 'other-entity', action: 'adjust_budget', status: 'succeeded',
        requested_change: { daily_budget_usd: 300 }, before_snapshot: { daily_budget: 10000 },
        created_at: new Date().toISOString(), executed_at: new Date(NOW - 10 * 86400000).toISOString(),
      }],
    }));
    const r = await executeApprovedAction(db, { ...APPROVAL, max_account_daily_budget_delta_usd: 200 }, provider(10000).p, input({ action: 'adjust_budget', proposedDailyBudget: 120 }));
    expect(r.success).toBe(false);
    expect(r.gate_evidence?.find((g) => g.gate === 'scale_clamp')?.allowed).toBe(false);
  });

  it('refuses a budget increase above the maximum daily budget cap', async () => {
    const db = makeDb(baseTables({ jeremy_action_plans: [plan({ action: 'adjust_budget', proposed_daily_budget: 120 })] }));
    const r = await executeApprovedAction(db, { ...APPROVAL, max_daily_budget_usd: 100 }, provider(10000).p, input({ action: 'adjust_budget', proposedDailyBudget: 120 }));
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/cap/i);
  });

  it('never sends a provider mutation on any blocked path', async () => {
    const prov = provider();
    const db = makeDb(baseTables());
    await executeApprovedAction(db, defaultPolicy(CLIENT), prov.p, input());
    expect(prov.calls.filter((c) => c.startsWith('mutate'))).toHaveLength(0);
  });
});

describe('atomic claim and audit trail', () => {
  let tables: Record<string, Row[]>;
  beforeEach(() => { tables = baseTables(); });

  it('passes every gate on the happy path as a dry run without mutating', async () => {
    const prov = provider();
    const db = makeDb(tables);
    const r = await executeApprovedAction(db, APPROVAL, prov.p, input());
    expect(r.success).toBe(true);
    expect(r.verification_status).toBe('skipped_dry_run');
    expect(prov.calls.filter((c) => c.startsWith('mutate'))).toHaveLength(0);
    const gateNames = (r.gate_evidence ?? []).map((g) => g.gate);
    for (const gate of ['payload_binding', 'evidence_freshness', 'mode', 'kpi_precedence', 'sample_floors', 'cooldown']) {
      expect(gateNames).toContain(gate);
    }
    // The execution row carries the full gate evidence for audit.
    const exec = tables.jeremy_action_executions.at(-1)!;
    expect(exec.plan_id).toBe('plan-1');
    expect(exec.gate_evidence.length).toBeGreaterThan(4);
    expect(exec.before_snapshot.daily_budget).toBe(10000);
  });

  it('clamps an approved scale to +20% of the provider budget', async () => {
    tables.jeremy_action_plans = [plan({ action: 'adjust_budget', proposed_daily_budget: 120 })];
    const db = makeDb(tables);
    const r = await executeApprovedAction(db, APPROVAL, provider(10000).p, input({ action: 'adjust_budget', proposedDailyBudget: 120 }));
    expect(r.success).toBe(true);
    expect(tables.jeremy_action_executions.at(-1)!.requested_change.daily_budget_usd).toBe(120);
  });

  it('loses the race on a repeated execution of the same plan', async () => {
    const db = makeDb(tables);
    const first = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(first.success).toBe(true);
    // The plan is released to 'approved' after a dry run, so the second attempt
    // is stopped by the unique idempotency key on the execution ledger.
    const second = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(second.success).toBe(false);
    expect(second.reason).toMatch(/idempotency|already/i);
    expect(tables.jeremy_action_executions).toHaveLength(1);
  });

  it('refuses a plan already claimed by a concurrent request', async () => {
    tables.jeremy_action_plans = [plan({ status: 'claimed' })];
    const db = makeDb(tables);
    const r = await executeApprovedAction(db, APPROVAL, provider().p, input());
    expect(r.success).toBe(false);
    expect(r.reason).toMatch(/not approved|claimed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Static guarantees: auth ordering, RLS shape, and no Gregory anywhere.
// ─────────────────────────────────────────────────────────────────────────────
const ROOT = join(process.cwd(), 'supabase');
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('endpoint authorizes before any data access', () => {
  const src = readSrc('functions/jeremy-autonomous/index.ts');

  it('resolves auth before the first database query', () => {
    const authIdx = Math.min(
      ...['authorizeJeremyCron', 'authorizeOperator'].map((n) => src.indexOf(n + '(')).filter((i) => i > 0),
    );
    const firstQuery = src.indexOf('.from("');
    expect(authIdx).toBeGreaterThan(0);
    expect(firstQuery === -1 || authIdx < firstQuery).toBe(true);
  });

  it('fails closed on an unauthorized scheduler or operator request', () => {
    expect(src).toMatch(/Unauthorized scheduler request/);
    expect(src).toMatch(/auth\.ok/);
    expect(src).toMatch(/401/);
  });

  it('never lets the scheduler approve or change policy, or execute outside autopilot', () => {
    expect(src).toMatch(/scheduler may not change policy/);
    expect(src).toMatch(/scheduler may not approve actions/);
    expect(src).toMatch(/scheduler may only execute on autopilot/);
  });

  it('defaults execution to a dry run', () => {
    expect(src).toMatch(/body\.dry_run !== false/);
  });
});

describe('RLS boundaries on the Jeremy tables', () => {
  const migrations = readdirSync(join(ROOT, 'migrations'))
    .map((f) => readFileSync(join(ROOT, 'migrations', f), 'utf8'))
    .join('\n');
  const tables = [
    'jeremy_autonomy_policies',
    'jeremy_cycles',
    'jeremy_kpi_snapshots',
    'jeremy_creative_candidates',
    'jeremy_action_executions',
    'jeremy_action_plans',
  ];

  it('enables row level security on every Jeremy table', () => {
    for (const t of tables) {
      expect(migrations).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it('grants the service role and signed-in operators only — never anon', () => {
    for (const t of tables) {
      expect(migrations).toContain(`ON public.${t} TO authenticated`);
      expect(migrations).toContain(`GRANT ALL ON public.${t} TO service_role`);
      expect(migrations).not.toContain(`ON public.${t} TO anon`);
    }
  });

  it('scopes every Jeremy policy to a provisioned reporting operator', () => {
    for (const t of tables) {
      const block = migrations.split(`ON public.${t}`).slice(1).join(' ');
      expect(block).toContain('is_reporting_operator()');
    }
  });
});

describe('the Jeremy workflow is Gregory-free', () => {
  const files = [
    'functions/_shared/jeremyAutonomy.ts',
    'functions/_shared/jeremyPolicy.ts',
    'functions/_shared/jeremyKpiContract.ts',
    'functions/_shared/jeremyReview.ts',
    'functions/jeremy-autonomous/index.ts',
  ];
  it('contains no Gregory references or routes', () => {
    for (const f of files) expect(readSrc(f).toLowerCase()).not.toContain('gregory');
  });
  it('preserves the pre-existing Jeremy MCP tools', () => {
    const mcp = readSrc('functions/mcp-agent-server/index.ts');
    for (const tool of ['jeremy_review_ads', 'jeremy_list_recommendations', 'jeremy_prepare_campaign_draft']) {
      expect(mcp).toContain(tool);
    }
  });
});
