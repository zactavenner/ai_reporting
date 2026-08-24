import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  quoteJob,
  approveJob,
  rejectJob,
  authorizeJobExecution,
  claimJob,
  monthToDateJobCost,
  jobFingerprint,
  jobLiveIdempotencyKey,
  jobQuoteIdempotencyKey,
  isQuoteIdempotencyKey,
  costPosture,
} from '../../supabase/functions/_shared/jeremyExternalJobs';
import {
  normalizeDiscoveryTarget,
  estimateApifyCostUsd,
  buildActorInput,
  checkApifyMonthlyLimit,
  fetchDatasetItems,
  mapItemToCreative,
  ingestCreatives,
  costPerResultUsd,
} from '../../supabase/functions/_shared/jeremyApify';
import {
  assertClientOwnedMedia,
  quoteGenerationCostUsd,
  generationTarget,
  pickGenerationModel,
  runGenerationJob,
  type GenerationExecutors,
} from '../../supabase/functions/_shared/jeremyGeneration';
import {
  buildLaunchRecord,
  createLaunchBatch,
  publishLaunch,
  publishTarget,
} from '../../supabase/functions/_shared/jeremyLaunch';
import { defaultPolicy, type JeremyPolicy } from '../../supabase/functions/_shared/jeremyPolicy';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory Supabase double supporting exactly the chains these modules use.
// ─────────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]> = {}) {
  let uid = 0;
  const matches = (row: Row, filters: Array<[string, string, any]>) =>
    filters.every(([col, op, val]) => {
      const v = row[col];
      if (op === 'eq') return String(v) === String(val);
      if (op === 'neq') return String(v) !== String(val);
      if (op === 'gte') return String(v) >= String(val);
      if (op === 'in') return (val as any[]).map(String).includes(String(v));
      if (op === 'is') return val === null ? v === null || v === undefined : v === val;
      return true;
    });

  function builder(table: string) {
    const filters: Array<[string, string, any]> = [];
    let mode: 'select' | 'update' | 'insert' = 'select';
    let payload: Row | Row[] = {};
    let limitN: number | null = null;

    const all = () => (tables[table] ??= []);
    const rowsFor = () => {
      let out = all().filter((r) => matches(r, filters));
      if (limitN != null) out = out.slice(0, limitN);
      return out;
    };

    const apply = () => {
      if (mode === 'insert') {
        const incoming = (Array.isArray(payload) ? payload : [payload]).map((r) => ({
          id: `row-${++uid}`,
          created_at: new Date().toISOString(),
          ...r,
        }));
        for (const r of incoming) {
          if (r.idempotency_key && all().some((e) => e.idempotency_key === r.idempotency_key)) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
          }
        }
        all().push(...incoming);
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
      eq(c: string, v: any) { filters.push([c, 'eq', v]); return api; },
      neq(c: string, v: any) { filters.push([c, 'neq', v]); return api; },
      gte(c: string, v: any) { filters.push([c, 'gte', v]); return api; },
      in(c: string, v: any[]) { filters.push([c, 'in', v]); return api; },
      is(c: string, v: any) { filters.push([c, 'is', v]); return api; },
      not(c: string, op: string, v: any) { filters.push([c, op === 'eq' ? 'neq' : op, v]); return api; },
      order() { return api; },
      limit(n: number) { limitN = n; return api; },
      maybeSingle() { const r = apply(); return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }); },
      single() { return api.maybeSingle(); },
      then(res: any, rej: any) { return Promise.resolve(apply()).then(res, rej); },
    };
    return api;
  }

  return { from: (t: string) => builder(t), _tables: tables };
}

const CLIENT = 'client-1';

const paidPolicy = (over: Partial<JeremyPolicy> = {}): JeremyPolicy => ({
  ...defaultPolicy(CLIENT),
  paid_discovery_enabled: true,
  paid_discovery_per_run_cap_usd: 5,
  paid_discovery_monthly_cap_usd: 50,
  paid_generation_enabled: true,
  paid_generation_per_run_cap_usd: 2,
  paid_generation_monthly_cap_usd: 20,
  ...over,
});

const APIFY_TARGET = { scrapeType: 'profile', targets: ['acme'], resultsLimit: 25, actorId: 'apify~instagram-scraper', max_results: 25 };

async function quotedApifyJob(db: any, policy = paidPolicy(), cost = 0.06) {
  const res = await quoteJob(db, policy, {
    clientId: CLIENT,
    kind: 'apify_discovery',
    provider: 'apify',
    target: { ...APIFY_TARGET },
    estimatedCostUsd: cost,
    requestedBy: 'operator:zac',
  });
  return res.job!;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('Jeremy external job ledger', () => {
  it('quotes into awaiting_approval and never spends', async () => {
    const db = makeDb();
    const job = await quotedApifyJob(db);
    expect(job.status).toBe('awaiting_approval');
    expect(job.estimated_cost_usd).toBe(0.06);
    expect(job.idempotency_key).toBe(jobLiveIdempotencyKey(jobFingerprint('apify_discovery', CLIENT, { ...APIFY_TARGET })));
  });

  it('refuses to quote an unknown cost', async () => {
    const db = makeDb();
    const res = await quoteJob(db, paidPolicy(), {
      clientId: CLIENT, kind: 'image_generation', provider: 'openrouter', target: { a: 1 },
      estimatedCostUsd: NaN, requestedBy: 'operator:zac',
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unknown/i);
  });

  it('is idempotent: re-quoting the same target returns the same job', async () => {
    const db = makeDb();
    const first = await quotedApifyJob(db);
    const second = await quotedApifyJob(db);
    expect(second.id).toBe(first.id);
    expect(db._tables.jeremy_external_jobs.length).toBe(1);
  });

  it('dry-run/quote keys are unique and never the live key', () => {
    const fp = jobFingerprint('apify_discovery', CLIENT, { ...APIFY_TARGET });
    const a = jobQuoteIdempotencyKey(fp);
    const b = jobQuoteIdempotencyKey(fp);
    expect(a).not.toBe(b);
    expect(a).not.toBe(jobLiveIdempotencyKey(fp));
    expect(isQuoteIdempotencyKey(a)).toBe(true);
    expect(isQuoteIdempotencyKey(jobLiveIdempotencyKey(fp))).toBe(false);
  });

  it('refuses execution with no approval record', async () => {
    const db = makeDb();
    const job = await quotedApifyJob(db);
    const auth = await authorizeJobExecution(db, paidPolicy(), job.id, {
      clientId: CLIENT, kind: 'apify_discovery', target: { ...APIFY_TARGET }, actor: 'operator:zac',
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toMatch(/operator approval/i);
    expect(auth.gates.find((g) => g.gate === 'approval')?.allowed).toBe(false);
  });

  it('refuses a scheduler approval', async () => {
    const db = makeDb();
    const job = await quotedApifyJob(db);
    const bad = await approveJob(db, job.id, 'scheduler');
    expect(bad.success).toBe(false);
    // A forged scheduler approval written directly is still refused at execution.
    db._tables.jeremy_external_jobs[0].status = 'approved';
    db._tables.jeremy_external_jobs[0].approved_by = 'scheduler';
    const auth = await authorizeJobExecution(db, paidPolicy(), job.id, {
      clientId: CLIENT, kind: 'apify_discovery', target: { ...APIFY_TARGET }, actor: 'scheduler',
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toMatch(/scheduler may not approve/i);
  });

  it('binds the payload: a swapped target or limit is refused', async () => {
    const db = makeDb();
    const job = await quotedApifyJob(db);
    await approveJob(db, job.id, 'operator:zac');
    const auth = await authorizeJobExecution(db, paidPolicy(), job.id, {
      clientId: CLIENT, kind: 'apify_discovery', target: { ...APIFY_TARGET, resultsLimit: 200, max_results: 200 }, actor: 'operator:zac',
    });
    expect(auth.allowed).toBe(false);
    expect(auth.gates.find((g) => g.gate === 'payload_binding')?.allowed).toBe(false);
  });

  it('refuses another client and another kind', async () => {
    const db = makeDb();
    const job = await quotedApifyJob(db);
    await approveJob(db, job.id, 'operator:zac');
    const other = await authorizeJobExecution(db, paidPolicy(), job.id, {
      clientId: 'client-2', kind: 'apify_discovery', target: { ...APIFY_TARGET }, actor: 'operator:zac',
    });
    expect(other.allowed).toBe(false);
    const wrongKind = await authorizeJobExecution(db, paidPolicy(), job.id, {
      clientId: CLIENT, kind: 'image_generation', target: { ...APIFY_TARGET }, actor: 'operator:zac',
    });
    expect(wrongKind.allowed).toBe(false);
  });

  it('refuses a stale quote and marks it expired', async () => {
    const db = makeDb();
    const job = await quotedApifyJob(db);
    await approveJob(db, job.id, 'operator:zac');
    db._tables.jeremy_external_jobs[0].quote_expires_at = new Date(Date.now() - 1000).toISOString();
    const auth = await authorizeJobExecution(db, paidPolicy(), job.id, {
      clientId: CLIENT, kind: 'apify_discovery', target: { ...APIFY_TARGET }, actor: 'operator:zac',
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toMatch(/expired/i);
    expect(db._tables.jeremy_external_jobs[0].status).toBe('expired');
  });

  it('refuses when the capability is disabled or uncapped', async () => {
    for (const policy of [
      paidPolicy({ paid_discovery_enabled: false }),
      paidPolicy({ paid_discovery_per_run_cap_usd: 0 }),
      paidPolicy({ paid_discovery_monthly_cap_usd: 0 }),
    ]) {
      const db = makeDb();
      const job = await quotedApifyJob(db, paidPolicy());
      await approveJob(db, job.id, 'operator:zac');
      const auth = await authorizeJobExecution(db, policy, job.id, {
        clientId: CLIENT, kind: 'apify_discovery', target: { ...APIFY_TARGET }, actor: 'operator:zac',
      });
      expect(auth.allowed).toBe(false);
    }
  });

  it('refuses when the monthly cap would be exceeded and counts committed jobs only', async () => {
    const db = makeDb({
      jeremy_external_jobs: [
        { id: 'past-1', client_id: CLIENT, kind: 'apify_discovery', status: 'succeeded', actual_cost_usd: 49, created_at: new Date().toISOString() },
        { id: 'past-2', client_id: CLIENT, kind: 'apify_discovery', status: 'awaiting_approval', estimated_cost_usd: 5, created_at: new Date().toISOString() },
      ],
    });
    expect(await monthToDateJobCost(db, CLIENT, 'discovery')).toBe(49);
    const job = await quotedApifyJob(db, paidPolicy(), 3);
    await approveJob(db, job.id, 'operator:zac');
    const auth = await authorizeJobExecution(db, paidPolicy(), job.id, {
      clientId: CLIENT, kind: 'apify_discovery', target: { ...APIFY_TARGET }, actor: 'operator:zac',
    });
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toMatch(/monthly cap/i);
  });

  it('claims atomically exactly once', async () => {
    const db = makeDb();
    const job = await quotedApifyJob(db);
    await approveJob(db, job.id, 'operator:zac');
    const first = await claimJob(db, job.id, 'operator:zac');
    const second = await claimJob(db, job.id, 'operator:zac');
    expect(first?.id).toBe(job.id);
    expect(second).toBeNull();
  });

  it('rejected jobs never authorise and cost posture reports caps', async () => {
    const db = makeDb();
    const job = await quotedApifyJob(db);
    await rejectJob(db, job.id, 'operator:zac');
    const auth = await authorizeJobExecution(db, paidPolicy(), job.id, {
      clientId: CLIENT, kind: 'apify_discovery', target: { ...APIFY_TARGET }, actor: 'operator:zac',
    });
    expect(auth.allowed).toBe(false);
    const posture = await costPosture(db, paidPolicy(), CLIENT);
    expect(posture.discovery.monthly_cap_usd).toBe(50);
    expect(posture.generation.per_run_cap_usd).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Apify discovery', () => {
  it('normalizes, dedupes and bounds targets', () => {
    const ok = normalizeDiscoveryTarget({ scrapeType: 'profile', targets: ['b', 'a', 'a'], resultsLimit: 9999 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.target.targets).toEqual(['a', 'b']);
      expect(ok.target.resultsLimit).toBe(200);
      expect(ok.target.max_results).toBe(400);
    }
    expect(normalizeDiscoveryTarget({ scrapeType: 'nope', targets: ['a'], resultsLimit: 5 }).ok).toBe(false);
    expect(normalizeDiscoveryTarget({ scrapeType: 'profile', targets: [], resultsLimit: 5 }).ok).toBe(false);
    expect(normalizeDiscoveryTarget({ scrapeType: 'profile', targets: Array.from({ length: 11 }, (_, i) => `t${i}`), resultsLimit: 5 }).ok).toBe(false);
  });

  it('quotes an exact cost and refuses an unknown unit cost', () => {
    const t = normalizeDiscoveryTarget({ scrapeType: 'hashtag', targets: ['#a'], resultsLimit: 100 });
    if (!t.ok) throw new Error('setup');
    expect(estimateApifyCostUsd(t.target, 0.0023)).toBe(0.23);
    expect(Number.isNaN(estimateApifyCostUsd(t.target, 0))).toBe(true);
    expect(buildActorInput(t.target)).toMatchObject({ hashtags: ['a'], resultsLimit: 100 });
    expect(costPerResultUsd({ config: { cost_per_result_usd: 0.01 } })).toBe(0.01);
  });

  it('enforces the Apify monthly spend limit independently of policy', () => {
    const base = { api_token: 'tok', is_active: true, monthly_spend_limit_cents: 1000, current_month_spend_cents: 900 };
    expect(checkApifyMonthlyLimit(base, 0.5).allowed).toBe(true);
    expect(checkApifyMonthlyLimit(base, 5).allowed).toBe(false);
    expect(checkApifyMonthlyLimit({ ...base, is_active: false }, 0.5).allowed).toBe(false);
    expect(checkApifyMonthlyLimit({ ...base, api_token: null }, 0.5).allowed).toBe(false);
    expect(checkApifyMonthlyLimit({ ...base, monthly_spend_limit_cents: 0 }, 0.5).allowed).toBe(false);
    expect(checkApifyMonthlyLimit(null, 0.5).allowed).toBe(false);
    expect(checkApifyMonthlyLimit(base, NaN).allowed).toBe(false);
  });

  it('paginates dataset reads and stops at the approved bound', async () => {
    const page = (n: number, start: number) => Array.from({ length: n }, (_, i) => ({ id: `p${start + i}`, url: `https://insta/p${start + i}` }));
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const limit = Number(new URL(url).searchParams.get('limit'));
      return { ok: true, json: async () => page(Math.min(limit, 100), offset) } as unknown as Response;
    });
    const items = await fetchDatasetItems(fetchImpl as any, 'tok', 'ds1', 250, 100);
    expect(items.length).toBe(250);
    expect(calls.length).toBe(3);
    expect(calls[1]).toContain('offset=100');
  });

  it('maps and ingests items idempotently', async () => {
    const db = makeDb();
    const items = [
      { id: 'x1', url: 'https://insta/x1', displayUrl: 'https://img/x1.jpg', caption: 'hi', likesCount: 10, ownerUsername: 'acme', type: 'Video', videoUrl: 'https://v/x1.mp4' },
      { id: 'x1', url: 'https://insta/x1' },
      { nothing: true },
    ];
    expect(mapItemToCreative(items[2], CLIENT)).toBeNull();
    const first = await ingestCreatives(db, CLIENT, items);
    expect(first.ingested).toBe(1);
    expect(first.duplicates).toBe(1);
    expect(db._tables.instagram_creatives[0].post_type).toBe('video');
    const second = await ingestCreatives(db, CLIENT, items);
    expect(second.ingested).toBe(0);
    expect(second.duplicates).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Jeremy generation', () => {
  const candidate = (over: Row = {}) => ({
    id: 'cand-1',
    client_id: CLIENT,
    title: 'Winner mechanism',
    source_url: 'https://competitor.example/ad.mp4',
    source_type: 'scraped_ad',
    evidence: { media: 'https://competitor.example/ad.mp4' },
    recreation_brief: { mechanism: { hook: 'A strong hook line', angle: 'A believable angle with proof', format: 'static image ad' }, guardrails: ['no copied branding'] },
    generation_kind: 'static_image',
    generation_status: 'prepared',
    ...over,
  });

  const genDb = (over: Row = {}) => makeDb({
    jeremy_creative_candidates: [candidate(over)],
    client_settings: [{ client_id: CLIENT, brand_colors: ['#0B2B26'], brand_fonts: ['Playfair Display'] }],
    creatives: [{ id: 'own-1', client_id: CLIENT, file_url: 'https://owned.example/asset.png', status: 'approved' }],
    client_assets: [],
  });

  const executors = (over: Partial<GenerationExecutors> = {}): GenerationExecutors => ({
    generateImage: vi.fn(async () => ({ url: 'https://provider.example/tmp.png', receipt: { ok: true }, actual_cost_usd: 0.04 })),
    generateVideo: vi.fn(async () => ({ url: 'https://provider.example/tmp.mp4', receipt: { ok: true }, actual_cost_usd: 0.3 })),
    persistToDurableStorage: vi.fn(async () => 'https://project.example/storage/v1/object/public/creatives/jeremy/x.png'),
    ...over,
  });

  it('refuses competitor media as a reference', () => {
    const res = assertClientOwnedMedia(candidate(), ['https://competitor.example/ad.mp4'], ['https://owned.example/asset.png']);
    expect(res.ok).toBe(false);
    expect(res.safe_reference_urls).toEqual([]);
    const good = assertClientOwnedMedia(candidate(), ['https://owned.example/asset.png'], ['https://owned.example/asset.png']);
    expect(good.ok).toBe(true);
  });

  it('quotes exact model cost and refuses unknown models', () => {
    expect(quoteGenerationCostUsd('static_image', 'google/gemini-2.5-flash-image')).toBe(0.04);
    expect(Number.isNaN(quoteGenerationCostUsd('static_image', 'made/up'))).toBe(true);
    expect(quoteGenerationCostUsd('video', 'bytedance/seedance-2.0', 5)).toBe(0.3);
    expect(pickGenerationModel('video', 'made/up')).toBe('bytedance/seedance-2.0');
  });

  it('never calls a provider without an approved job', async () => {
    const db = genDb();
    const ex = executors();
    const job = await quoteJob(db, paidPolicy(), {
      clientId: CLIENT, kind: 'image_generation', provider: 'openrouter',
      target: generationTarget({ candidateId: 'cand-1', kind: 'static_image', model: 'google/gemini-2.5-flash-image', aspectRatio: '1:1' }),
      estimatedCostUsd: 0.04, candidateId: 'cand-1', requestedBy: 'operator:zac',
    });
    const res = await runGenerationJob(db, paidPolicy(), ex, {
      clientId: CLIENT, jobId: job.job!.id, candidateId: 'cand-1', kind: 'static_image',
      model: 'google/gemini-2.5-flash-image', aspectRatio: '1:1', actor: 'operator:zac',
    });
    expect(res.success).toBe(false);
    expect(ex.generateImage).not.toHaveBeenCalled();
    expect(db._tables.jeremy_creative_candidates[0].generation_status).toBe('prepared');
  });

  async function approvedImageJob(db: any, policy = paidPolicy()) {
    const target = generationTarget({ candidateId: 'cand-1', kind: 'static_image', model: 'google/gemini-2.5-flash-image', aspectRatio: '1:1' });
    const q = await quoteJob(db, policy, {
      clientId: CLIENT, kind: 'image_generation', provider: 'openrouter', target,
      estimatedCostUsd: 0.04, candidateId: 'cand-1', requestedBy: 'operator:zac',
    });
    await approveJob(db, q.job!.id, 'operator:zac');
    return q.job!.id;
  }

  it('generates, persists durably and writes back the candidate and a creatives row', async () => {
    const db = genDb();
    const ex = executors();
    const jobId = await approvedImageJob(db);
    const res = await runGenerationJob(db, paidPolicy(), ex, {
      clientId: CLIENT, jobId, candidateId: 'cand-1', kind: 'static_image',
      model: 'google/gemini-2.5-flash-image', aspectRatio: '1:1', actor: 'operator:zac',
      referenceImageUrls: ['https://owned.example/asset.png'],
    });
    expect(res.success).toBe(true);
    expect(res.creative_url).toMatch(/storage\/v1\/object\/public/);
    const cand = db._tables.jeremy_creative_candidates[0];
    expect(cand.generation_status).toBe('generated');
    expect(cand.generation_reference).toBe(res.creative_url);
    expect(cand.actual_cost_usd).toBe(0.04);
    expect(db._tables.creatives.some((c: Row) => c.source === 'jeremy_autonomous')).toBe(true);
    const job = db._tables.jeremy_external_jobs[0];
    expect(job.status).toBe('succeeded');
    expect(job.actual_cost_usd).toBe(0.04);
    // The competitor source URL was never sent to the provider.
    const call = (ex.generateImage as any).mock.calls[0][0];
    expect(call.referenceImages).toEqual(['https://owned.example/asset.png']);
  });

  it('refuses when the asset cannot be stored durably', async () => {
    const db = genDb();
    const ex = executors({ persistToDurableStorage: vi.fn(async () => '') });
    const jobId = await approvedImageJob(db);
    const res = await runGenerationJob(db, paidPolicy(), ex, {
      clientId: CLIENT, jobId, candidateId: 'cand-1', kind: 'static_image',
      model: 'google/gemini-2.5-flash-image', aspectRatio: '1:1', actor: 'operator:zac',
    });
    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/durable/i);
    expect(db._tables.jeremy_creative_candidates[0].generation_status).toBe('failed');
    expect(db._tables.jeremy_external_jobs[0].status).toBe('failed');
  });

  it('refuses a reference that is not a client-owned asset', async () => {
    const db = genDb();
    const ex = executors();
    const jobId = await approvedImageJob(db);
    const res = await runGenerationJob(db, paidPolicy(), ex, {
      clientId: CLIENT, jobId, candidateId: 'cand-1', kind: 'static_image',
      model: 'google/gemini-2.5-flash-image', aspectRatio: '1:1', actor: 'operator:zac',
      referenceImageUrls: ['https://competitor.example/ad.mp4'],
    });
    expect(res.success).toBe(false);
    expect(ex.generateImage).not.toHaveBeenCalled();
  });

  it('uses a client-owned frame for video, never the competitor source', async () => {
    const db = genDb({ generation_kind: 'video' });
    const ex = executors();
    const target = generationTarget({ candidateId: 'cand-1', kind: 'video', model: 'bytedance/seedance-2.0', aspectRatio: '9:16', durationSeconds: 5 });
    const q = await quoteJob(db, paidPolicy(), {
      clientId: CLIENT, kind: 'video_generation', provider: 'openrouter', target,
      estimatedCostUsd: 0.3, candidateId: 'cand-1', requestedBy: 'operator:zac',
    });
    await approveJob(db, q.job!.id, 'operator:zac');
    const res = await runGenerationJob(db, paidPolicy(), ex, {
      clientId: CLIENT, jobId: q.job!.id, candidateId: 'cand-1', kind: 'video',
      model: 'bytedance/seedance-2.0', aspectRatio: '9:16', durationSeconds: 5, actor: 'operator:zac',
    });
    expect(res.success).toBe(true);
    const call = (ex.generateVideo as any).mock.calls[0][0];
    expect(call.sourceFrameUrl).toBe('https://owned.example/asset.png');
    expect(call.sourceFrameUrl).not.toBe('https://competitor.example/ad.mp4');
  });

  it('is idempotent: a second run of the same job is refused', async () => {
    const db = genDb();
    const ex = executors();
    const jobId = await approvedImageJob(db);
    const first = await runGenerationJob(db, paidPolicy(), ex, {
      clientId: CLIENT, jobId, candidateId: 'cand-1', kind: 'static_image',
      model: 'google/gemini-2.5-flash-image', aspectRatio: '1:1', actor: 'operator:zac',
    });
    const second = await runGenerationJob(db, paidPolicy(), ex, {
      clientId: CLIENT, jobId, candidateId: 'cand-1', kind: 'static_image',
      model: 'google/gemini-2.5-flash-image', aspectRatio: '1:1', actor: 'operator:zac',
    });
    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(ex.generateImage).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Jeremy launch readiness and PAUSED publication', () => {
  const generatedCandidate = (over: Row = {}) => ({
    id: 'cand-1',
    client_id: CLIENT,
    title: 'Winner mechanism',
    generation_kind: 'image',
    generation_status: 'generated',
    generation_reference: 'https://project.example/storage/v1/object/public/creatives/jeremy/x.png',
    recreation_brief: { mechanism: { hook: 'A strong hook line', angle: 'A believable angle with proof points' } },
    evidence: { generation: { creative_id: 'creative-1' } },
    ...over,
  });

  const fullConfig = { page_id: '123456789', pixel_id: '987654321', destination_url: 'https://client.example/apply', countries: ['US'], special_ad_category: 'NONE', ad_account_id: 'act_1' };
  const fullInputs = { objective: 'leads', daily_budget_cents: 5000, cta: 'LEARN_MORE', countries: ['US'], age_min: 25, age_max: 65, special_ad_category: 'NONE' };

  it('is ready only with every value present', () => {
    const ready = buildLaunchRecord(CLIENT, generatedCandidate(), fullConfig, fullInputs);
    expect(ready.ready).toBe(true);
    expect(ready.record?.status).toBe('draft');
  });

  it('refuses a non-generated candidate and a missing durable creative URL', () => {
    const notGenerated = buildLaunchRecord(CLIENT, generatedCandidate({ generation_status: 'prepared' }), fullConfig, fullInputs);
    expect(notGenerated.ready).toBe(false);
    expect(notGenerated.missing.join(' ')).toMatch(/has not been generated/i);
    const noUrl = buildLaunchRecord(CLIENT, generatedCandidate({ generation_reference: null }), fullConfig, fullInputs);
    expect(noUrl.missing.join(' ')).toMatch(/durable generated creative/i);
  });

  it('names every missing configuration value instead of defaulting it', () => {
    const missingConfig = buildLaunchRecord(CLIENT, generatedCandidate(), { ...fullConfig, page_id: null, pixel_id: null, destination_url: null }, { objective: 'leads', daily_budget_cents: 5000 });
    expect(missingConfig.ready).toBe(false);
    const text = missingConfig.missing.join(' | ');
    expect(text).toMatch(/Page ID/i);
    expect(text).toMatch(/Pixel ID/i);
    expect(text).toMatch(/Destination URL/i);
    expect(text).toMatch(/country/i);
    expect(text).toMatch(/Special ad category/i);
    expect(text).toMatch(/Age range/i);
  });

  it('createLaunchBatch writes drafts only for ready candidates and never ACTIVE', async () => {
    const db = makeDb({
      jeremy_creative_candidates: [generatedCandidate(), generatedCandidate({ id: 'cand-2', generation_status: 'prepared' })],
      clients: [{ id: CLIENT, website_url: 'https://client.example/apply', meta_pixel_id: '987654321', meta_ad_account_id: 'act_1' }],
      client_settings: [{ client_id: CLIENT, ads_library_page_id: '123456789' }],
      meta_campaign_launches: [],
    });
    const batch = await createLaunchBatch(db, CLIENT, ['cand-1', 'cand-2'], fullInputs);
    expect(batch.launch_status).toBe('PAUSED');
    expect(batch.ready_count).toBe(1);
    expect(batch.blocked_count).toBe(1);
    expect(db._tables.meta_campaign_launches.length).toBe(1);
    expect(db._tables.meta_campaign_launches[0].status).toBe('draft');
    await expect(createLaunchBatch(db, CLIENT, ['cand-1'], { ...fullInputs, status: 'ACTIVE' } as any)).rejects.toThrow(/PAUSED/);
  });

  const launchRow = () => ({
    id: 'launch-1', client_id: CLIENT, name: 'Jeremy derivative', objective: 'leads', status: 'draft', stage: 'draft',
    daily_budget_cents: 5000, cta: 'LEARN_MORE', destination_url: 'https://client.example/apply',
    primary_text: 'A believable angle with proof points', headline: 'A strong hook line',
    page_id: '123456789', pixel_id: '987654321', countries: ['US'], age_min: 25, age_max: 65,
    special_ad_category: 'NONE', creative_url: 'https://project.example/storage/v1/object/public/creatives/jeremy/x.png', creative_type: 'image',
  });

  async function approvedPublishJob(db: any) {
    const q = await quoteJob(db, paidPolicy(), {
      clientId: CLIENT, kind: 'meta_publish', provider: 'meta', target: publishTarget('launch-1'),
      estimatedCostUsd: 0, launchId: 'launch-1', requestedBy: 'operator:zac',
    });
    await approveJob(db, q.job!.id, 'operator:zac');
    return q.job!.id;
  }

  it('never publishes without an approved job', async () => {
    const db = makeDb({ meta_campaign_launches: [launchRow()] });
    const q = await quoteJob(db, paidPolicy(), {
      clientId: CLIENT, kind: 'meta_publish', provider: 'meta', target: publishTarget('launch-1'),
      estimatedCostUsd: 0, launchId: 'launch-1', requestedBy: 'operator:zac',
    });
    const executor = { publish: vi.fn() };
    const res = await publishLaunch(db, paidPolicy(), executor, { clientId: CLIENT, jobId: q.job!.id, launchId: 'launch-1', actor: 'operator:zac' });
    expect(res.success).toBe(false);
    expect(executor.publish).not.toHaveBeenCalled();
  });

  it('publishes through the existing launch path with every status PAUSED', async () => {
    const db = makeDb({ meta_campaign_launches: [launchRow()] });
    const jobId = await approvedPublishJob(db);
    const executor = {
      publish: vi.fn(async () => ({
        success: true,
        launch: { meta_campaign_id: 'c1', meta_adset_id: 'a1', meta_ad_id: 'ad1' },
        statuses: { campaign: 'PAUSED', adset: 'PAUSED', ad: 'PAUSED' },
      })),
    };
    const res = await publishLaunch(db, paidPolicy(), executor, { clientId: CLIENT, jobId, launchId: 'launch-1', actor: 'operator:zac' });
    expect(res.success).toBe(true);
    expect(executor.publish).toHaveBeenCalledWith('launch-1');
    expect(Object.values(res.statuses ?? {}).every((s) => s === 'PAUSED')).toBe(true);
    expect(db._tables.jeremy_external_jobs[0].verification.all_paused).toBe(true);
    // Idempotent: a second publish loses the claim and never calls Meta again.
    const again = await publishLaunch(db, paidPolicy(), executor, { clientId: CLIENT, jobId, launchId: 'launch-1', actor: 'operator:zac' });
    expect(again.success).toBe(false);
    expect(executor.publish).toHaveBeenCalledTimes(1);
  });

  it('fails verification when any object comes back not PAUSED', async () => {
    const db = makeDb({ meta_campaign_launches: [launchRow()] });
    const jobId = await approvedPublishJob(db);
    const executor = {
      publish: vi.fn(async () => ({ success: true, launch: { meta_campaign_id: 'c1' }, statuses: { campaign: 'ACTIVE', adset: 'PAUSED', ad: 'PAUSED' } })),
    };
    const res = await publishLaunch(db, paidPolicy(), executor, { clientId: CLIENT, jobId, launchId: 'launch-1', actor: 'operator:zac' });
    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/non-PAUSED/i);
    expect(db._tables.jeremy_external_jobs[0].status).toBe('verification_failed');
  });

  it('refuses an incomplete launch record even with an approved job', async () => {
    const db = makeDb({ meta_campaign_launches: [{ ...launchRow(), page_id: null }] });
    const jobId = await approvedPublishJob(db);
    const executor = { publish: vi.fn() };
    const res = await publishLaunch(db, paidPolicy(), executor, { clientId: CLIENT, jobId, launchId: 'launch-1', actor: 'operator:zac' });
    expect(res.success).toBe(false);
    expect(executor.publish).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('workflow hygiene', () => {
  const files = [
    'supabase/functions/_shared/jeremyExternalJobs.ts',
    'supabase/functions/_shared/jeremyApify.ts',
    'supabase/functions/_shared/jeremyGeneration.ts',
    'supabase/functions/_shared/jeremyLaunch.ts',
    'supabase/functions/_shared/jeremyExecutors.ts',
    'supabase/functions/run-instagram-scrape/index.ts',
    'src/components/ads-manager/JeremyExternalJobsPanel.tsx',
  ];

  it('contains no Gregory anywhere in the new workflow', () => {
    for (const f of files) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/gregory/i);
    }
  });

  it('the discovery function authenticates before reading any secret', () => {
    const src = readFileSync('supabase/functions/run-instagram-scrape/index.ts', 'utf8');
    const authIdx = src.indexOf('authorizeOperator');
    const tokenIdx = src.indexOf('settings?.api_token');
    expect(authIdx).toBeGreaterThan(0);
    expect(tokenIdx).toBeGreaterThan(authIdx);
    expect(src).not.toMatch(/api_token.*return|return.*api_token/);
  });
});
