/**
 * Agency Daily Reporting 5.0 — pure deterministic helpers.
 *
 * Nothing here touches the network or the database: every function is a pure
 * transformation over rows already read from `public.v_daily_funnel_day`, so the
 * numbers in the SMS are reproducible and unit-testable.
 *
 * Rules encoded here:
 *  - America/Los_Angeles day boundaries.
 *  - Ratios are aggregated from summed numerators / denominators, never by
 *    averaging daily ratios.
 *  - A metric with no denominator (or with an unavailable source) is `null`
 *    ("unavailable"), never 0.
 *  - Indicators compare YESTERDAY against the trailing-window daily average.
 */

export const TZ = 'America/Los_Angeles';
export const WINDOW_SIZES = [1, 7, 14, 30] as const;
export type WindowSize = (typeof WINDOW_SIZES)[number];

/* ── date helpers ─────────────────────────────────────────────────────────── */

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const laDate = (d: Date = new Date(), tz = TZ): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export const laHour = (d: Date = new Date(), tz = TZ): number =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(d));

export const laMinute = (d: Date = new Date(), tz = TZ): number =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: '2-digit' }).format(d));

export const yesterdayLa = (d: Date = new Date(), tz = TZ): string => addDays(laDate(d, tz), -1);

/**
 * DST-safe scheduler gate. The cron fires every 2 minutes across UTC 11–13 so
 * that both standard and daylight offsets are covered; only the ticks that land
 * inside the local [startHour, endHour) window may act.
 */
export const inLocalWindow = (
  d: Date = new Date(),
  startHour = 4,
  endHour = 5,
  tz = TZ,
): boolean => {
  const h = laHour(d, tz);
  return h >= startHour && h < endHour;
};

/** Local minutes since midnight — used for the 04:50 cutoff / 05:00 deadline. */
export const laMinutesOfDay = (d: Date = new Date(), tz = TZ): number =>
  laHour(d, tz) * 60 + laMinute(d, tz);

export const agencyScheduleState = (d: Date = new Date(), tz = TZ) => {
  const minute = laMinutesOfDay(d, tz);
  return {
    minute,
    can_act: minute >= 4 * 60 && minute < 5 * 60 + 5,
    can_dispatch: minute >= 4 * 60 && minute < 4 * 60 + 50,
    past_finalize_cutoff: minute >= 4 * 60 + 50,
    past_deadline: minute >= 5 * 60,
  };
};

export const workerRunIsCurrent = (startedAt: string | null | undefined, collectionStartedAt: string): boolean => {
  const workerTime = startedAt ? Date.parse(startedAt) : NaN;
  const collectionTime = Date.parse(collectionStartedAt);
  return Number.isFinite(workerTime) && Number.isFinite(collectionTime) && workerTime >= collectionTime;
};

/* ── window aggregation ───────────────────────────────────────────────────── */

export interface FunnelRow {
  date: string;
  spend?: number | string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
  leads_total?: number | string | null;
  leads_qualified?: number | string | null;
  leads_bad?: number | string | null;
  leads_pending?: number | string | null;
  discovery_booked?: number | string | null;
  discovery_eligible?: number | string | null;
  discovery_showed?: number | string | null;
  discovery_noshow?: number | string | null;
  discovery_unclassified?: number | string | null;
  reconnect_booked?: number | string | null;
  reconnect_eligible?: number | string | null;
  reconnect_showed?: number | string | null;
  commitments?: number | string | null;
  commitment_dollars?: number | string | null;
  funded_count?: number | string | null;
  funded_dollars?: number | string | null;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** null when the denominator is zero — an unavailable ratio is not 0. */
export const ratio = (numerator: number, denominator: number, digits = 2): number | null => {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(digits));
};

export const perUnit = (total: number, count: number, digits = 2): number | null => {
  if (!count) return null;
  return Number((total / count).toFixed(digits));
};

export interface WindowTotals {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  qualified: number;
  bad: number;
  pending: number;
  booked: number;
  eligible: number;
  showed: number;
  noshow: number;
  unclassified: number;
  reconnect_booked: number;
  reconnect_showed: number;
  commitments: number;
  commitment_dollars: number;
  funded: number;
  funded_dollars: number;
}

export interface WindowMetrics {
  size: WindowSize;
  start: string;
  end: string;
  days_expected: number;
  days_present: number;
  totals: WindowTotals;
  rates: { qualified_rate: number | null; bad_rate: number | null; show_rate: number | null };
  costs: {
    cpl: number | null;
    cost_per_booked: number | null;
    cost_per_show: number | null;
    cost_per_funded: number | null;
  };
  /** Daily averages of the summed totals — the pacing basis for the indicators. */
  per_day: Record<'spend' | 'leads' | 'booked' | 'showed' | 'commitments' | 'funded', number | null>;
}

const emptyTotals = (): WindowTotals => ({
  spend: 0, impressions: 0, clicks: 0, leads: 0, qualified: 0, bad: 0, pending: 0,
  booked: 0, eligible: 0, showed: 0, noshow: 0, unclassified: 0,
  reconnect_booked: 0, reconnect_showed: 0,
  commitments: 0, commitment_dollars: 0, funded: 0, funded_dollars: 0,
});

export function aggregateWindow(rows: FunnelRow[], reportDate: string, size: WindowSize): WindowMetrics {
  const start = addDays(reportDate, -(size - 1));
  const inRange = (rows ?? []).filter((r) => r && r.date >= start && r.date <= reportDate);
  const t = emptyTotals();
  for (const r of inRange) {
    t.spend += num(r.spend);
    t.impressions += num(r.impressions);
    t.clicks += num(r.clicks);
    t.leads += num(r.leads_total);
    t.qualified += num(r.leads_qualified);
    t.bad += num(r.leads_bad);
    t.pending += num(r.leads_pending);
    t.booked += num(r.discovery_booked);
    t.eligible += num(r.discovery_eligible);
    t.showed += num(r.discovery_showed);
    t.noshow += num(r.discovery_noshow);
    t.unclassified += num(r.discovery_unclassified);
    t.reconnect_booked += num(r.reconnect_booked);
    t.reconnect_showed += num(r.reconnect_showed);
    t.commitments += num(r.commitments);
    t.commitment_dollars += num(r.commitment_dollars);
    t.funded += num(r.funded_count);
    t.funded_dollars += num(r.funded_dollars);
  }
  const days = inRange.length;
  // The funnel view is sparse: a legitimately quiet day may have no row at
  // all. Pacing therefore divides by the calendar-window size, not the number
  // of rows returned. A wholly empty window remains unavailable because there
  // is no source evidence proving that the zeros are real.
  const div = (v: number) => (days ? Number((v / size).toFixed(2)) : null);
  return {
    size,
    start,
    end: reportDate,
    days_expected: size,
    days_present: days,
    totals: t,
    rates: {
      qualified_rate: ratio(t.qualified, t.leads),
      bad_rate: ratio(t.bad, t.leads),
      show_rate: ratio(t.showed, t.eligible),
    },
    costs: {
      cpl: perUnit(t.spend, t.leads),
      cost_per_booked: perUnit(t.spend, t.booked),
      cost_per_show: perUnit(t.spend, t.showed),
      cost_per_funded: perUnit(t.spend, t.funded),
    },
    per_day: {
      spend: div(t.spend),
      leads: div(t.leads),
      booked: div(t.booked),
      showed: div(t.showed),
      commitments: div(t.commitments),
      funded: div(t.funded),
    },
  };
}

export type Windows = Record<'1' | '7' | '14' | '30', WindowMetrics>;

export function buildWindows(rows: FunnelRow[], reportDate: string): Windows {
  const out = {} as Windows;
  for (const size of WINDOW_SIZES) {
    out[String(size) as keyof Windows] = aggregateWindow(rows, reportDate, size);
  }
  return out;
}

/* ── pacing indicators ────────────────────────────────────────────────────── */

export type Direction = 'higher_better' | 'lower_better' | 'neutral';

export const METRIC_DIRECTION: Record<string, Direction> = {
  leads: 'higher_better',
  qualified_rate: 'higher_better',
  booked: 'higher_better',
  show_rate: 'higher_better',
  commitments: 'higher_better',
  funded: 'higher_better',
  cpl: 'lower_better',
  cost_per_booked: 'lower_better',
  cost_per_show: 'lower_better',
  spend: 'neutral',
};

export const GREEN = '🟢';
export const RED = '🔴';
export const NEUTRAL = '⚪';

export interface Indicator {
  metric: string;
  window: number;
  direction: Direction;
  emoji: string;
  /** Machine-readable outcome so nothing depends on emoji rendering. */
  state: 'improved' | 'worsened' | 'flat' | 'unavailable';
  yesterday: number | null;
  basis: number | null;
  delta_pct: number | null;
  text: string;
}

const fmt = (v: number | null, metric: string): string => {
  if (v === null) return 'n/a';
  if (metric.endsWith('_rate')) return `${v}%`;
  if (metric.startsWith('cost') || metric === 'cpl' || metric === 'spend') {
    return `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
  }
  return String(v);
};

/**
 * Deterministic red/green with the text/basis attached. Green means yesterday
 * improved against the trailing daily average for the metric's direction.
 */
export function indicator(
  metric: string,
  window: number,
  yesterday: number | null,
  basis: number | null,
  direction: Direction = METRIC_DIRECTION[metric] ?? 'neutral',
): Indicator {
  const label = `${metric} ${fmt(yesterday, metric)} vs ${window}d avg ${fmt(basis, metric)}`;
  if (direction === 'neutral' || yesterday === null || basis === null) {
    return {
      metric, window, direction, emoji: NEUTRAL,
      state: direction === 'neutral' ? 'flat' : 'unavailable',
      yesterday, basis, delta_pct: null,
      text: direction === 'neutral' ? `${label} (neutral)` : `${label} (unavailable)`,
    };
  }
  const delta = yesterday - basis;
  const delta_pct = basis === 0 ? null : Number(((delta / Math.abs(basis)) * 100).toFixed(1));
  if (delta === 0) {
    return { metric, window, direction, emoji: NEUTRAL, state: 'flat', yesterday, basis, delta_pct, text: `${label} (flat)` };
  }
  const improved = direction === 'higher_better' ? delta > 0 : delta < 0;
  return {
    metric, window, direction,
    emoji: improved ? GREEN : RED,
    state: improved ? 'improved' : 'worsened',
    yesterday, basis, delta_pct,
    text: `${label} (${improved ? 'better' : 'worse'}${delta_pct === null ? '' : ` ${delta_pct > 0 ? '+' : ''}${delta_pct}%`})`,
  };
}

const yesterdayValue = (w: Windows, metric: string): number | null => {
  const d = w['1'];
  switch (metric) {
    case 'spend': return d.totals.spend;
    case 'leads': return d.totals.leads;
    case 'booked': return d.totals.booked;
    case 'commitments': return d.totals.commitments;
    case 'funded': return d.totals.funded;
    case 'qualified_rate': return d.rates.qualified_rate;
    case 'show_rate': return d.rates.show_rate;
    case 'cpl': return d.costs.cpl;
    case 'cost_per_booked': return d.costs.cost_per_booked;
    case 'cost_per_show': return d.costs.cost_per_show;
    default: return null;
  }
};

/** Trailing basis EXCLUDES nothing: it is the window daily average / aggregate ratio. */
const basisValue = (w: Windows, size: 7 | 14 | 30, metric: string): number | null => {
  const win = w[String(size) as keyof Windows];
  switch (metric) {
    case 'spend': return win.per_day.spend;
    case 'leads': return win.per_day.leads;
    case 'booked': return win.per_day.booked;
    case 'commitments': return win.per_day.commitments;
    case 'funded': return win.per_day.funded;
    case 'qualified_rate': return win.rates.qualified_rate;
    case 'show_rate': return win.rates.show_rate;
    case 'cpl': return win.costs.cpl;
    case 'cost_per_booked': return win.costs.cost_per_booked;
    case 'cost_per_show': return win.costs.cost_per_show;
    default: return null;
  }
};

export const INDICATOR_METRICS = [
  'leads', 'qualified_rate', 'booked', 'show_rate', 'commitments', 'funded',
  'cpl', 'cost_per_booked', 'cost_per_show', 'spend',
] as const;

export function buildIndicators(
  w: Windows,
  opts: { spendTarget?: number | null } = {},
): Record<string, Record<string, Indicator>> {
  const out: Record<string, Record<string, Indicator>> = {};
  for (const metric of INDICATOR_METRICS) {
    out[metric] = {};
    for (const size of [7, 14, 30] as const) {
      if (metric === 'spend') {
        const target = opts.spendTarget ?? null;
        // Spend is neutral unless the client has an explicit daily target.
        out[metric][String(size)] = target
          ? indicator('spend', size, w['1'].totals.spend, target, 'lower_better')
          : indicator('spend', size, w['1'].totals.spend, basisValue(w, size, 'spend'), 'neutral');
        continue;
      }
      out[metric][String(size)] = indicator(metric, size, yesterdayValue(w, metric), basisValue(w, size, metric));
    }
  }
  return out;
}

/* ── SMS chunking ─────────────────────────────────────────────────────────── */

export const SMS_CHUNK_LIMIT = 1400;

/**
 * Splits on client-block boundaries (blocks are separated by a blank line) and
 * never mid-line. A single oversized block is emitted alone rather than dropped.
 */
export function chunkSms(text: string, limit = SMS_CHUNK_LIMIT): string[] {
  const blocks = String(text ?? '').split('\n\n');
  const parts: string[] = [];
  let buf = '';
  const push = () => { if (buf.trim()) parts.push(buf); buf = ''; };
  for (const block of blocks) {
    const candidate = buf ? `${buf}\n\n${block}` : block;
    if (candidate.length <= limit) { buf = candidate; continue; }
    push();
    if (block.length <= limit) { buf = block; continue; }
    // Oversized single block: fall back to line-level splitting, and hard-split
    // any single line that is itself longer than the limit so nothing is lost.
    let lineBuf = '';
    for (const line of block.split('\n')) {
      const c = lineBuf ? `${lineBuf}\n${line}` : line;
      if (c.length <= limit) { lineBuf = c; continue; }
      if (lineBuf) { parts.push(lineBuf); lineBuf = ''; }
      let rest = line;
      while (rest.length > limit) {
        parts.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      lineBuf = rest;
    }
    if (lineBuf) buf = lineBuf;
  }
  push();
  const total = parts.length;
  if (total <= 1) return parts.length ? parts : [''];
  return parts.map((p, i) => `(${i + 1}/${total}) ${p}`);
}

export const money = (v: number | null): string =>
  v === null ? 'n/a' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(Number(v)) >= 100 ? 0 : 2 })}`;

/* ── agency message construction ─────────────────────────────────────────── */

export interface AgencyLedgerRow {
  client_id: string;
  client_name: string | null;
  status: string;
  last_error: string | null;
}

export interface AgencyMessageCounts { valid: number; unavailable: number; failed: number }

export interface AgencyWorkerReport {
  validation_passed?: boolean | null;
  report_json?: {
    windows?: Windows;
    metric_availability?: Record<string, boolean>;
    indicators?: Record<string, Record<string, Indicator>>;
  } | null;
  anomalies?: Array<{ severity?: string; code?: string }> | null;
}

const pace = (ind: Indicator | undefined): string => ind?.emoji ?? NEUTRAL;

/**
 * Build the consolidated agency SMS from validated worker output only.
 * Unvalidated clients are listed in the audit section, but their numeric
 * values never enter client blocks or portfolio totals.
 */
export function buildAgencyMessage(
  reportDate: string,
  ledger: AgencyLedgerRow[],
  byClient: Map<string, AgencyWorkerReport>,
): { text: string; counts: AgencyMessageCounts; audit: string[] } {
  const counts: AgencyMessageCounts = { valid: 0, unavailable: 0, failed: 0 };
  const audit: string[] = [];
  const blocks: string[] = [];
  const totals = { spend: 0, impressions: 0, clicks: 0, leads: 0, qualified: 0, bad: 0, pending: 0, cplSpend: 0, cplLeads: 0, booked: 0, eligible: 0, showed: 0, commitments: 0, commitmentDollars: 0, funded: 0, fundedDollars: 0 };
  const coverage = { spend: 0, leads: 0, cpl: 0, booked: 0, shows: 0, commitments: 0, funded: 0 };

  const enriched = ledger.map((row) => {
    const worker = byClient.get(row.client_id);
    const windows: Windows | null = worker?.report_json?.windows ?? null;
    const validated = worker?.validation_passed === true && row.status === 'completed' && !!windows;
    return { row, worker, windows, validated, spend: validated ? Number(windows?.['1']?.totals?.spend ?? 0) : -1 };
  }).sort((a, b) => b.spend - a.spend);

  for (const { row, worker, windows, validated } of enriched) {
    const name = row.client_name || 'Unknown client';
    if (row.status === 'error' || row.status === 'timed_out' || !worker) {
      counts.failed++;
      audit.push(`${name}: ${row.status}${row.last_error ? ` — ${row.last_error.slice(0, 80)}` : ''}`);
      blocks.push(`${name}\n• ${NEUTRAL} no validated data (${row.status})`);
      continue;
    }
    if (!validated || !windows) {
      counts.unavailable++;
      const reason = row.status === 'pending' || row.status === 'dispatched'
        ? `report not complete (${row.status})`
        : row.status === 'validation_failed' || worker.validation_passed === false
          ? 'validation failed'
          : 'window aggregation unavailable';
      audit.push(`${name}: ${reason}`);
      blocks.push(`${name}\n• ${NEUTRAL} metrics unavailable (${reason})`);
      continue;
    }

    counts.valid++;
    const d = windows['1'];
    const avail = worker.report_json?.metric_availability ?? {};
    const ind = worker.report_json?.indicators ?? buildIndicators(windows);
    const n = (v: number | null, ok = true) => (ok && v !== null ? String(v) : 'n/a');
    const trio = (metric: string) =>
      `${pace(ind?.[metric]?.['7'])}${pace(ind?.[metric]?.['14'])}${pace(ind?.[metric]?.['30'])}`;

    if (avail.spend !== false) {
      totals.spend += d.totals.spend;
      totals.impressions += d.totals.impressions;
      totals.clicks += d.totals.clicks;
      coverage.spend++;
    }
    if (avail.leads !== false) {
      totals.leads += d.totals.leads;
      totals.qualified += d.totals.qualified;
      totals.bad += d.totals.bad;
      totals.pending += d.totals.pending;
      coverage.leads++;
    }
    if (avail.cpl !== false) {
      totals.cplSpend += d.totals.spend;
      totals.cplLeads += d.totals.leads;
      coverage.cpl++;
    }
    if (avail.booked !== false) { totals.booked += d.totals.booked; coverage.booked++; }
    if (avail.show_rate !== false) {
      totals.eligible += d.totals.eligible; totals.showed += d.totals.showed; coverage.shows++;
    }
    if (avail.commitments !== false) {
      totals.commitments += d.totals.commitments;
      totals.commitmentDollars += d.totals.commitment_dollars;
      coverage.commitments++;
    }
    if (avail.funded !== false) {
      totals.funded += d.totals.funded;
      totals.fundedDollars += d.totals.funded_dollars;
      coverage.funded++;
    }

    blocks.push([
      name,
      `• Spend ${avail.spend === false ? 'n/a' : money(d.totals.spend)} · Leads ${n(d.totals.leads, avail.leads !== false)} ${trio('leads')} · CPL ${avail.cpl === false ? 'n/a' : money(d.costs.cpl)} ${trio('cpl')}`,
      `• Ads Impr ${avail.spend === false ? 'n/a' : d.totals.impressions.toLocaleString('en-US')} · Clicks ${n(d.totals.clicks, avail.spend !== false)} · CTR ${avail.spend === false || !d.totals.impressions ? 'n/a' : `${Number(((d.totals.clicks / d.totals.impressions) * 100).toFixed(2))}%`}`,
      `• Quality Q ${n(d.totals.qualified, avail.leads !== false)}/${n(d.totals.leads, avail.leads !== false)} (${avail.qualified_rate === false ? 'n/a' : d.rates.qualified_rate ?? 'n/a'}%) · Bad ${n(d.totals.bad, avail.leads !== false)} · Pending ${n(d.totals.pending, avail.leads !== false)} ${trio('qualified_rate')}`,
      `• Booked ${n(d.totals.booked, avail.booked !== false)} ${trio('booked')} · Showed ${n(d.totals.showed, avail.show_rate !== false)}/${n(d.totals.eligible, avail.show_rate !== false)} (${avail.show_rate === false ? 'n/a' : d.rates.show_rate ?? 'n/a'}%) ${trio('show_rate')}`,
      `• Commit ${n(d.totals.commitments, avail.commitments !== false)} (${avail.commitments === false ? 'n/a' : money(d.totals.commitment_dollars)}) ${trio('commitments')} · Funded ${n(d.totals.funded, avail.funded !== false)} (${avail.funded === false ? 'n/a' : money(d.totals.funded_dollars)}) ${trio('funded')}`,
      `• 7/14/30d avg leads ${windows['7'].per_day.leads ?? 'n/a'} / ${windows['14'].per_day.leads ?? 'n/a'} / ${windows['30'].per_day.leads ?? 'n/a'}`,
    ].join('\n'));

    const criticals = (worker.anomalies ?? []).filter((a) => a.severity === 'critical').map((a) => a.code);
    if (criticals.length) audit.push(`${name}: ${criticals.slice(0, 3).join(', ')}`);
  }

  const ofValid = (n: number) => `${n}/${counts.valid}`;
  const head = [
    `HPA Agency Daily Report · ${reportDate} (${TZ})`,
    `Portfolio (validated sources) — Spend ${coverage.spend ? money(totals.spend) : 'n/a'} [${ofValid(coverage.spend)}] · Leads ${coverage.leads ? totals.leads : 'n/a'} [${ofValid(coverage.leads)}] · CPL ${coverage.cpl && totals.cplLeads ? money(totals.cplSpend / totals.cplLeads) : 'n/a'} [${ofValid(coverage.cpl)}]`,
    `Ads — Impr ${coverage.spend ? totals.impressions.toLocaleString('en-US') : 'n/a'} · Clicks ${coverage.spend ? totals.clicks : 'n/a'} · CTR ${coverage.spend && totals.impressions ? `${Number(((totals.clicks / totals.impressions) * 100).toFixed(2))}%` : 'n/a'}`,
    `Lead quality — Q ${coverage.leads ? `${totals.qualified}/${totals.leads} (${totals.leads ? Math.round((totals.qualified / totals.leads) * 1000) / 10 : 'n/a'}%)` : 'n/a'} · Bad ${coverage.leads ? totals.bad : 'n/a'} · Pending ${coverage.leads ? totals.pending : 'n/a'}`,
    `Booked ${coverage.booked ? totals.booked : 'n/a'} · Showed ${coverage.shows ? `${totals.showed}/${totals.eligible} (${totals.eligible ? Math.round((totals.showed / totals.eligible) * 1000) / 10 : 'n/a'}%)` : 'n/a'} · Commit ${coverage.commitments ? `${totals.commitments} (${money(totals.commitmentDollars)})` : 'n/a'} · Funded ${coverage.funded ? `${totals.funded} (${money(totals.fundedDollars)})` : 'n/a'}`,
    `Clients: ${counts.valid} validated · ${counts.unavailable} unavailable · ${counts.failed} failed`,
    `Pacing ${GREEN} better / ${RED} worse / ${NEUTRAL} n-a vs 7d·14d·30d daily average`,
  ].join('\n');

  const footer = [
    'Audit',
    ...(audit.length ? audit.slice(0, 12).map((a) => `• ${a}`) : ['• none']),
    'Unvalidated or n/a values are missing/failed sources, not zeros.',
  ].join('\n');

  return { text: [head, ...blocks, footer].join('\n\n'), counts, audit };
}
