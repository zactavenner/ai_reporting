import { describe, expect, it } from 'vitest';
import {
  executeApprovedAction,
  planFingerprint,
  idempotencyKey,
  liveIdempotencyKey,
  dryRunIdempotencyKey,
  isDryRunIdempotencyKey,
  type MetaProvider,
} from '../../supabase/functions/_shared/jeremyAutonomy';
import { defaultPolicy, type JeremyPolicy } from '../../supabase/functions/_shared/jeremyPolicy';

// Same minimal in-memory Supabase double used by the gate tests, including the
// unique idempotency_key constraint Postgres enforces in production.
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

const goodMetrics = () => [
  { client_id: CLIENT, date: new Date(NOW - 86400000).toISOString().slice(0, 10), ad_spend: 500, leads: 100, spam_leads: 10, calls: 30, showed_calls: 20, funded_investors: 3, funded_dollars: 9000, unattributed_leads: 2, updated_at: new Date(NOW - 3600000).toISOString() },
];

const goodCampaign = (over: Row = {}) => ({
  client_id: CLIENT,
  meta_campaign_id: ENTITY,
  name: 'Winner campaign',
  status: 'ACTIVE',
  effective_status: 'ACTIVE',
  daily_budget: 10000,
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

/** A provider that fakes a Meta pause: the read-back reflects the mutation. */
function pauseProvider(opts: { honour?: boolean } = {}) {
  const honour = opts.honour !== false;
  let status = 'ACTIVE';
  const calls: string[] = [];
  const p: MetaProvider = {
    async read(_t, id) { calls.push(`read:${id}`); return { id, status, effective_status: status, daily_budget: 10000 }; },
    async mutate(_t, id, params) {
      calls.push(`mutate:${id}:${JSON.stringify(params)}`);
      if (honour) status = 'PAUSED';
      return { success: true };
    },
  };
  return { p, calls, mutations: () => calls.filter((c) => c.startsWith('mutate:')).length };
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

const ledger = (db: any) => db._tables.jeremy_action_executions as Row[];

describe('idempotency key namespacing', () => {
  const payload = { status: 'PAUSED' };

  it('gives a live run the single stable claim key', () => {
    const a = liveIdempotencyKey('plan-1', CLIENT, ENTITY, 'pause', payload);
    const b = liveIdempotencyKey('plan-1', CLIENT, ENTITY, 'pause', payload);
    expect(a).toBe(b);
    expect(a).toBe(`plan-1:${idempotencyKey(CLIENT, ENTITY, 'pause', payload)}`);
    expect(isDryRunIdempotencyKey(a)).toBe(false);
  });

  it('gives every dry run a distinct non-live key', () => {
    const live = liveIdempotencyKey('plan-1', CLIENT, ENTITY, 'pause', payload);
    const d1 = dryRunIdempotencyKey('plan-1', CLIENT, ENTITY, 'pause', payload);
    const d2 = dryRunIdempotencyKey('plan-1', CLIENT, ENTITY, 'pause', payload);
    expect(d1).not.toBe(d2);
    expect(d1).not.toBe(live);
    expect(isDryRunIdempotencyKey(d1)).toBe(true);
    expect(d1.endsWith(live)).toBe(true);
  });
});

describe('dry runs never consume the live mutation claim', () => {
  it('runs a dry run, then still permits exactly one live execution', async () => {
    const db = makeDb(baseTables());
    const prov = pauseProvider();

    const dry = await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: true }));
    expect(dry.success).toBe(true);
    expect(dry.verification_status).toBe('skipped_dry_run');
    expect(prov.mutations()).toBe(0);
    // The plan is untouched, so the live execution can still claim it.
    expect(db._tables.jeremy_action_plans[0].status).toBe('approved');

    const live = await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false }));
    expect(live.success).toBe(true);
    expect(live.status).toBe('succeeded');
    expect(live.verification_status).toBe('verified');
    expect(prov.mutations()).toBe(1);
    expect(db._tables.jeremy_action_plans[0].status).toBe('executed');

    const keys = ledger(db).map((r) => String(r.idempotency_key));
    expect(keys.filter(isDryRunIdempotencyKey)).toHaveLength(1);
    expect(keys.filter((k) => !isDryRunIdempotencyKey(k))).toHaveLength(1);
  });

  it('repeated dry runs neither collide with each other nor block the live run', async () => {
    const db = makeDb(baseTables());
    const prov = pauseProvider();

    for (let i = 0; i < 5; i++) {
      const r = await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: true }));
      expect(r.success).toBe(true);
    }
    expect(ledger(db).filter((r) => isDryRunIdempotencyKey(String(r.idempotency_key)))).toHaveLength(5);
    expect(prov.mutations()).toBe(0);

    const live = await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false }));
    expect(live.success).toBe(true);
    expect(prov.mutations()).toBe(1);
  });

  it('refuses a second live execution of the same plan', async () => {
    const db = makeDb(baseTables());
    const prov = pauseProvider();

    const first = await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false }));
    expect(first.success).toBe(true);

    const second = await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false }));
    expect(second.success).toBe(false);
    expect(second.status).toBe('blocked');
    expect(second.reason).toMatch(/already claimed|already executed|idempotency|not approved/i);
    expect(prov.mutations()).toBe(1);
  });

  it('a dry run concurrent with a live run cannot steal or duplicate the mutation', async () => {
    const db = makeDb(baseTables());
    const prov = pauseProvider();

    const results = await Promise.all([
      executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: true })),
      executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false })),
      executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: true })),
    ]);

    expect(results[0].success).toBe(true);
    expect(results[0].verification_status).toBe('skipped_dry_run');
    expect(results[1].success).toBe(true);
    expect(results[1].verification_status).toBe('verified');
    expect(results[2].verification_status).toBe('skipped_dry_run');
    expect(prov.mutations()).toBe(1);

    const liveRows = ledger(db).filter((r) => !isDryRunIdempotencyKey(String(r.idempotency_key)));
    expect(liveRows).toHaveLength(1);
  });

  it('concurrent live executions produce exactly one provider mutation', async () => {
    const db = makeDb(baseTables());
    const prov = pauseProvider();

    const results = await Promise.all([
      executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false })),
      executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false })),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(prov.mutations()).toBe(1);
  });

  it('a dry-run audit row never trips the cooldown gate for the live run', async () => {
    const db = makeDb(baseTables());
    const prov = pauseProvider();
    await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: true }));
    const live = await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false }));
    const cooldown = (live.gate_evidence ?? []).find((g) => g.gate === 'cooldown');
    expect(cooldown?.allowed).toBe(true);
    expect(live.success).toBe(true);
  });
});

describe('read-back verification', () => {
  it('records a mismatch as a failure, not a success, when the provider does not honour the mutation', async () => {
    const db = makeDb(baseTables());
    const prov = pauseProvider({ honour: false });

    const live = await executeApprovedAction(db, APPROVAL, prov.p, input({ dryRun: false }));
    expect(live.success).toBe(false);
    expect(live.status).toBe('verification_failed');
    expect(live.verification_status).toBe('mismatch');
    expect(live.reason).toMatch(/read-back mismatch/i);
    expect(db._tables.jeremy_action_plans[0].status).toBe('failed');

    const row = ledger(db).find((r) => !isDryRunIdempotencyKey(String(r.idempotency_key)));
    expect(row?.status).toBe('verification_failed');
    expect(row?.verification_status).toBe('mismatch');
  });
});
