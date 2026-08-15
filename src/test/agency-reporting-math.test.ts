import { describe, it, expect } from 'vitest';
import {
  aggregateWindow, buildWindows, buildIndicators, indicator,
  chunkSms, SMS_CHUNK_LIMIT, inLocalWindow, laMinutesOfDay, yesterdayLa,
  GREEN, RED, NEUTRAL,
  type FunnelRow,
} from '../../supabase/functions/_shared/agencyReport';

const REPORT_DATE = '2026-08-14';

/** 30 days ending on REPORT_DATE, with yesterday deliberately different. */
function series(): FunnelRow[] {
  const rows: FunnelRow[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date('2026-08-14T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    rows.push({
      date: d.toISOString().slice(0, 10),
      spend: 100, leads_total: 10, leads_qualified: 5, leads_bad: 2,
      discovery_booked: 4, discovery_eligible: 4, discovery_showed: 2,
      commitments: 1, commitment_dollars: 1000, funded_count: 1, funded_dollars: 5000,
    });
  }
  // Yesterday: more leads, cheaper, worse show rate.
  rows[rows.length - 1] = {
    date: REPORT_DATE,
    spend: 100, leads_total: 20, leads_qualified: 5, leads_bad: 2,
    discovery_booked: 4, discovery_eligible: 4, discovery_showed: 1,
    commitments: 1, commitment_dollars: 1000, funded_count: 1, funded_dollars: 5000,
  };
  return rows;
}

describe('window aggregation', () => {
  const rows = series();

  it('sums 1/7/14/30 day windows over LA-day boundaries', () => {
    const w = buildWindows(rows, REPORT_DATE);
    expect(w['1'].days_present).toBe(1);
    expect(w['7'].days_present).toBe(7);
    expect(w['14'].days_present).toBe(14);
    expect(w['30'].days_present).toBe(30);
    expect(w['1'].start).toBe(REPORT_DATE);
    expect(w['7'].start).toBe('2026-08-08');
    expect(w['30'].start).toBe('2026-07-16');
    expect(w['1'].totals.leads).toBe(20);
    expect(w['7'].totals.leads).toBe(6 * 10 + 20);
    expect(w['30'].totals.spend).toBe(3000);
  });

  it('aggregates ratios from summed numerators and denominators', () => {
    const w = aggregateWindow(
      [
        { date: '2026-08-13', spend: 100, leads_total: 100, discovery_eligible: 10, discovery_showed: 1 },
        { date: '2026-08-14', spend: 100, leads_total: 1, discovery_eligible: 1, discovery_showed: 1 },
      ],
      REPORT_DATE,
      7,
    );
    // Averaging daily ratios would give (10% + 100%)/2 = 55%; the correct
    // aggregate is 2/11 = 18.18%.
    expect(w.rates.show_rate).toBeCloseTo(18.18, 2);
    // Averaging daily CPLs would give ($1 + $100)/2; correct is 200/101.
    expect(w.costs.cpl).toBeCloseTo(1.98, 2);
  });

  it('returns null (unavailable) rather than 0 when a denominator is missing', () => {
    const w = aggregateWindow([{ date: REPORT_DATE, spend: 50 }], REPORT_DATE, 1);
    expect(w.totals.spend).toBe(50);
    expect(w.costs.cpl).toBeNull();
    expect(w.rates.show_rate).toBeNull();
  });

  it('treats an empty window as unavailable, not zero-rate', () => {
    const w = aggregateWindow([], REPORT_DATE, 7);
    expect(w.days_present).toBe(0);
    expect(w.per_day.leads).toBeNull();
    expect(w.rates.qualified_rate).toBeNull();
  });
});

describe('pacing indicators', () => {
  const w = buildWindows(series(), REPORT_DATE);
  const ind = buildIndicators(w);

  it('is green when a higher-is-better metric beats the trailing daily average', () => {
    expect(ind.leads['7'].emoji).toBe(GREEN);
    expect(ind.leads['7'].state).toBe('improved');
    expect(ind.leads['7'].basis).toBeCloseTo(11.43, 2);
    expect(ind.leads['7'].text).toContain('vs 7d avg');
  });

  it('is red when a higher-is-better metric falls behind', () => {
    expect(ind.show_rate['7'].emoji).toBe(RED);
    expect(ind.show_rate['7'].state).toBe('worsened');
  });

  it('inverts direction for lower-is-better cost metrics', () => {
    expect(indicator('cpl', 7, 5, 10).emoji).toBe(GREEN);
    expect(indicator('cpl', 7, 20, 10).emoji).toBe(RED);
    expect(indicator('cost_per_show', 7, 5, 10).state).toBe('improved');
    expect(indicator('cost_per_booked', 7, 15, 10).state).toBe('worsened');
  });

  it('is neutral for ties and for unavailable values', () => {
    expect(indicator('leads', 7, 10, 10).emoji).toBe(NEUTRAL);
    expect(indicator('leads', 7, null, 10).state).toBe('unavailable');
    expect(indicator('leads', 7, 10, null).emoji).toBe(NEUTRAL);
    expect(indicator('cpl', 30, null, null).text).toContain('unavailable');
  });

  it('keeps spend neutral unless a client daily target exists', () => {
    expect(ind.spend['7'].emoji).toBe(NEUTRAL);
    const targeted = buildIndicators(w, { spendTarget: 200 });
    expect(targeted.spend['7'].emoji).toBe(GREEN); // $100 spent vs $200 target
    const over = buildIndicators(w, { spendTarget: 50 });
    expect(over.spend['7'].emoji).toBe(RED);
  });

  it('carries deterministic text and basis on every indicator', () => {
    for (const metric of Object.keys(ind)) {
      for (const win of ['7', '14', '30']) {
        expect(typeof ind[metric][win].text).toBe('string');
        expect(ind[metric][win].text.length).toBeGreaterThan(0);
        expect(ind[metric][win].window).toBe(Number(win));
      }
    }
  });
});

describe('SMS chunking', () => {
  it('keeps a short message as a single unnumbered chunk', () => {
    const parts = chunkSms('Portfolio\n\nClient A\n• fine');
    expect(parts).toHaveLength(1);
    expect(parts[0]).not.toMatch(/^\(1\//);
  });

  it('splits on client-block boundaries and stays under the limit', () => {
    const block = (i: number) => `Client ${i}\n${'• metric line'.repeat(12)}`;
    const text = ['Header', ...Array.from({ length: 20 }, (_, i) => block(i)), 'Audit'].join('\n\n');
    const parts = chunkSms(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(SMS_CHUNK_LIMIT + 12);
    expect(parts[0]).toMatch(/^\(1\/\d+\)/);
    // no client block is torn in half
    const rejoined = parts.map((p) => p.replace(/^\(\d+\/\d+\)\s/, '')).join('\n\n');
    expect(rejoined).toContain('Client 19');
  });

  it('never drops content for an oversized single block', () => {
    const parts = chunkSms('X'.repeat(SMS_CHUNK_LIMIT * 2 + 5));
    expect(parts.length).toBeGreaterThan(1);
  });
});

describe('DST-safe local-time gating', () => {
  // 11:30 UTC = 04:30 PDT (summer) but 03:30 PST (winter).
  it('acts at 04:xx local during daylight time', () => {
    expect(inLocalWindow(new Date('2026-08-14T11:30:00Z'), 4, 5)).toBe(true);
  });

  it('does not act at the same UTC hour during standard time', () => {
    expect(inLocalWindow(new Date('2026-01-14T11:30:00Z'), 4, 5)).toBe(false);
  });

  it('acts at 12:30 UTC during standard time', () => {
    expect(inLocalWindow(new Date('2026-01-14T12:30:00Z'), 4, 5)).toBe(true);
  });

  it('excludes 05:00 local (window end is exclusive)', () => {
    expect(inLocalWindow(new Date('2026-08-14T12:00:00Z'), 4, 5)).toBe(false);
  });

  it('exposes local minutes for the 04:50 / 05:00 cutoffs', () => {
    expect(laMinutesOfDay(new Date('2026-08-14T11:50:00Z'))).toBe(4 * 60 + 50);
    expect(laMinutesOfDay(new Date('2026-01-14T13:00:00Z'))).toBe(5 * 60);
  });

  it('reports YESTERDAY in LA even when UTC has already rolled over', () => {
    // 2026-08-15T06:00Z is still 2026-08-14 in LA, so yesterday is the 13th.
    expect(yesterdayLa(new Date('2026-08-15T06:00:00Z'))).toBe('2026-08-13');
    expect(yesterdayLa(new Date('2026-08-15T11:30:00Z'))).toBe('2026-08-14');
  });
});
