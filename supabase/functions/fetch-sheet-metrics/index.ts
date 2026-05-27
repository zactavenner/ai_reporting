const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';

// ---- In-memory caches (per edge instance) -----------------------------------
// Cache parsed daily metrics by sheet_id+gid for 90s so repeated requests
// (current + prior period, multi-client dashboards) coalesce into one
// upstream call and stay under Google's 60 req/min/user quota.
const PARSED_TTL_MS = 90_000;
const META_TTL_MS = 10 * 60_000;
const parsedCache = new Map<string, { at: number; payload: any }>();
const metaCache = new Map<string, { at: number; title: string }>();
const inflight = new Map<string, Promise<any>>();

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status !== 429 && res.status < 500) return res;
      // Retry on 429 / 5xx
      const body = await res.text();
      lastErr = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      if (i === attempts - 1) {
        // Return the last response so caller can surface upstream details.
        return new Response(body, { status: res.status, headers: res.headers });
      }
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1) throw e;
    }
    // Exponential backoff with jitter: 600ms, 1.4s, 3s
    const delay = 600 * Math.pow(2, i) + Math.random() * 400;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr instanceof Error ? lastErr : new Error('fetchWithRetry exhausted');
}

interface DailyMetric {
  date: string;
  ad_spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  spam_leads: number;
  calls: number;
  showed_calls: number;
  commitments: number;
  commitment_dollars: number;
  funded_investors: number;
  funded_dollars: number;
  reconnect_calls: number;
  reconnect_showed: number;
}

const FIELD_ALIASES: Record<string, string[]> = {
  date: ['date', 'day'],
  ad_spend: ['spend', 'ad spend', 'total spend', 'adspend'],
  leads: ['leads', 'total leads', 'new leads'],
  spam_leads: ['spam', 'spam leads', 'bad leads'],
  calls: ['calls', 'booked calls', 'booked'],
  showed_calls: ['showed', 'shows', 'showed calls'],
  reconnect_calls: ['reconnects', 'reconnect calls', 'reconnect'],
  reconnect_showed: ['reconnect showed', 'reconnects showed'],
  commitments: ['commitments', 'committed'],
  commitment_dollars: ['commitment $', 'committed $', 'commitment dollars', 'commitments $'],
  funded_investors: ['funded', 'funded investors', 'investors funded'],
  funded_dollars: ['funded $', 'capital raised', 'funded dollars', 'raised'],
  impressions: ['impressions', 'impr'],
  clicks: ['clicks'],
};

// Aliases used when the sheet is column-major (metrics down rows, dates across columns).
// Matched against the value in column A.
const COLMAJOR_METRIC_ALIASES: Record<string, string[]> = {
  ad_spend: ['ad spend', 'spend', 'total spend'],
  impressions: ['impressions'],
  clicks: ['link clicks', 'clicks'],
  leads: ['leads'],
  spam_leads: ['spam', 'spam leads'],
  calls: ['discovery call booked', 'discovery calls booked', 'calls booked', 'booked calls', 'calls'],
  showed_calls: ['discovery call showed', 'discovery calls showed', 'calls showed', 'showed calls'],
  reconnect_calls: ['reconnect calls #2', 'reconnect calls', 'reconnects'],
  reconnect_showed: ['reconnect call showed', 'reconnect calls showed'],
  commitments: ['committed investors #', 'committed investors', 'commitments', 'committed'],
  commitment_dollars: ['committed $', 'commitment $', 'committed dollars'],
  funded_investors: ['funded investors #', 'funded investors', 'funded'],
  funded_dollars: ['funded $', 'capital raised'],
};

function normalize(s: string): string {
  return (s || '').toString().trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
}

function parseNumber(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,\s%]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseDate(v: any): string | null {
  if (!v) return null;
  // Handle Sheets serial dates and various formats
  if (typeof v === 'number') {
    // Real Sheets serials are roughly 1-80000 (1900-2119). Reject bare
    // numbers like 0, 1, 100 that aren't actually dates.
    if (v < 25569 || v > 80000) return null; // ~1970-01-01 to ~2119
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY or M/D/YY (anchored end so "1/1-1/7" can't slip through)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mm, dd, yy] = m;
    let year = parseInt(yy);
    if (year < 100) year += 2000;
    return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  // Fallback Date parsing: only if the string looks date-ish (has a separator
  // AND a 4-digit year). Stops things like "0", "703", "2000" from being
  // mis-parsed as valid years.
  if (!/[\/\-\s]/.test(s)) return null;
  if (!/\d{4}/.test(s)) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yr = d.getUTCFullYear();
    if (yr < 2000 || yr > 2100) return null;
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function isSingleDateString(s: string): boolean {
  const t = (s || '').toString().trim();
  if (!t) return false;
  // Skip ranges like "1/1-1/7"
  if (/-/.test(t) && !/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  return parseDate(t) !== null;
}

/**
 * Parses a column-major sheet (dates across columns, metrics down rows).
 * Returns daily metrics keyed by date.
 */
function parseColumnMajor(rows: any[][], mapping?: Record<string, string>): DailyMetric[] {
  // Find the date header row: the one with the most parseable single dates in cols >= 2
  let bestRow = -1;
  let bestCount = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i] || [];
    let count = 0;
    for (let c = 2; c < r.length; c++) {
      if (isSingleDateString(String(r[c] ?? ''))) count++;
    }
    if (count > bestCount) { bestCount = count; bestRow = i; }
  }
  if (bestRow < 0 || bestCount < 2) return [];

  // Map column index -> date (skip weekly-total / non-date columns)
  const dateRow = rows[bestRow];
  const colDates: Record<number, string> = {};
  for (let c = 2; c < dateRow.length; c++) {
    const ds = parseDate(dateRow[c]);
    if (ds && isSingleDateString(String(dateRow[c]))) colDates[c] = ds;
  }

  // Build per-date metric accumulators
  const byDate: Record<string, DailyMetric> = {};
  for (const ds of Object.values(colDates)) {
    byDate[ds] = {
      date: ds, ad_spend: 0, impressions: 0, clicks: 0, ctr: 0,
      leads: 0, spam_leads: 0, calls: 0, showed_calls: 0,
      commitments: 0, commitment_dollars: 0,
      funded_investors: 0, funded_dollars: 0,
      reconnect_calls: 0, reconnect_showed: 0,
    };
  }

  // Build metric-label lookup
  const labelToField: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(COLMAJOR_METRIC_ALIASES)) {
    if (mapping && mapping[field]) labelToField[normalize(mapping[field])] = field;
    for (const a of aliases) labelToField[normalize(a)] = field;
  }

  // Walk metric rows. A metric row has col A = label, col B containing 'ACTUAL'.
  for (let i = bestRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const label = normalize(String(r[0] ?? ''));
    const subLabel = normalize(String(r[1] ?? ''));
    if (!label) continue;
    if (!subLabel.startsWith('actual')) continue; // only ACTUAL rows
    const field = labelToField[label];
    if (!field) continue;

    for (const [colStr, ds] of Object.entries(colDates)) {
      const c = Number(colStr);
      const v = parseNumber(r[c]);
      (byDate[ds] as any)[field] = ((byDate[ds] as any)[field] || 0) + v;
    }
  }

  // Compute CTR per day
  const result = Object.values(byDate).map((d) => ({
    ...d,
    ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
  }));
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}

function buildHeaderMap(headers: string[], override?: Record<string, string>): Record<string, number> {
  const map: Record<string, number> = {};
  const normHeaders = headers.map(normalize);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (override && override[field]) {
      const idx = normHeaders.indexOf(normalize(override[field]));
      if (idx >= 0) { map[field] = idx; continue; }
    }
    for (const alias of aliases) {
      const idx = normHeaders.indexOf(normalize(alias));
      if (idx >= 0) { map[field] = idx; break; }
    }
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_SHEETS_API_KEY = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');
    if (!GOOGLE_SHEETS_API_KEY) throw new Error('GOOGLE_SHEETS_API_KEY not configured');

    const body = await req.json().catch(() => ({}));
    const { sheet_id, gid, range, mapping, start_date, end_date, action } = body || {};

    if (!sheet_id || typeof sheet_id !== 'string') {
      return new Response(JSON.stringify({ error: 'sheet_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const headers = {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
    };

    // List-tabs mode: return all tab titles for mapping UI.
    if (action === 'list_tabs') {
      const metaRes = await fetch(
        `${GATEWAY_URL}/spreadsheets/${sheet_id}?fields=sheets(properties(sheetId,title,index))`,
        { headers }
      );
      const metaText = await metaRes.text();
      if (!metaRes.ok) throw new Error(`Sheet metadata fetch failed [${metaRes.status}]: ${metaText}`);
      const meta = JSON.parse(metaText);
      const tabs = (meta?.sheets || [])
        .map((s: any) => ({ gid: String(s?.properties?.sheetId ?? ''), title: s?.properties?.title ?? '', index: s?.properties?.index ?? 0 }))
        .sort((a: any, b: any) => a.index - b.index);
      return new Response(JSON.stringify({ tabs }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Raw-grid mode: return headers + rows for a tab so callers (e.g. audits) can inspect data.
    if (action === 'raw_grid') {
      let rawTitle: string | undefined;
      const metaRes = await fetch(
        `${GATEWAY_URL}/spreadsheets/${sheet_id}?fields=sheets(properties(sheetId,title))`,
        { headers }
      );
      const metaText = await metaRes.text();
      if (!metaRes.ok) throw new Error(`Sheet metadata fetch failed [${metaRes.status}]: ${metaText}`);
      const meta = JSON.parse(metaText);
      const sheets = meta?.sheets || [];
      let target = sheets[0]?.properties;
      if (gid !== undefined && gid !== null && gid !== '') {
        const found = sheets.find((s: any) => String(s?.properties?.sheetId) === String(gid));
        if (found) target = found.properties;
      }
      rawTitle = target?.title;
      if (!rawTitle) throw new Error('Could not resolve sheet title for raw_grid');
      const valuesRes = await fetch(
        `${GATEWAY_URL}/spreadsheets/${sheet_id}/values/${rawTitle}`,
        { headers }
      );
      const valuesText = await valuesRes.text();
      if (!valuesRes.ok) throw new Error(`Sheet values fetch failed [${valuesRes.status}]: ${valuesText}`);
      const valuesJson = JSON.parse(valuesText);
      const allRows: any[][] = valuesJson?.values || [];
      const headerRow = allRows[0] || [];
      const dataRows = allRows.slice(1);
      return new Response(JSON.stringify({
        sheetTitle: rawTitle,
        headers: headerRow,
        rows: dataRows,
        rowCount: dataRows.length,
        fetchedAt: new Date().toISOString(),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 1. Resolve gid -> sheet title
    let sheetTitle: string;
    if (range && typeof range === 'string') {
      // user provided explicit range like 'Sheet1!A:Z'
      sheetTitle = range;
    } else {
      const metaRes = await fetch(
        `${GATEWAY_URL}/spreadsheets/${sheet_id}?fields=sheets(properties(sheetId,title))`,
        { headers }
      );
      const metaText = await metaRes.text();
      if (!metaRes.ok) {
        throw new Error(`Sheet metadata fetch failed [${metaRes.status}]: ${metaText}`);
      }
      const meta = JSON.parse(metaText);
      const sheets = meta?.sheets || [];
      let target = sheets[0]?.properties;
      if (gid !== undefined && gid !== null && gid !== '') {
        const found = sheets.find((s: any) => String(s?.properties?.sheetId) === String(gid));
        if (found) target = found.properties;
      }
      if (!target?.title) throw new Error('Could not resolve sheet title from gid');
      sheetTitle = target.title;
    }

    // 2. Fetch values (do NOT encode the range)
    const valuesRes = await fetch(
      `${GATEWAY_URL}/spreadsheets/${sheet_id}/values/${sheetTitle}`,
      { headers }
    );
    const valuesText = await valuesRes.text();
    if (!valuesRes.ok) {
      throw new Error(`Sheet values fetch failed [${valuesRes.status}]: ${valuesText}`);
    }
    const valuesJson = JSON.parse(valuesText);
    const rows: any[][] = valuesJson?.values || [];

    if (rows.length < 2) {
      return new Response(JSON.stringify({ daily: [], aggregated: null, sheetTitle, fetchedAt: new Date().toISOString(), rowCount: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Try column-major first (metrics-down, dates-across) — common for KPI dashboards.
    // Fall back to row-major (header row + data rows) if not detected.
    let daily: DailyMetric[] = parseColumnMajor(rows, mapping);
    let layout: 'column-major' | 'row-major' = 'column-major';

    if (daily.length === 0) {
      layout = 'row-major';
      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const candidate = (rows[i] || []).map((c) => normalize(String(c ?? '')));
        if (FIELD_ALIASES.date.some((a) => candidate.includes(normalize(a)))) {
          headerRowIdx = i; break;
        }
      }
      const headerRow = (rows[headerRowIdx] || []).map((c) => String(c ?? ''));
      const headerMap = buildHeaderMap(headerRow, mapping);
      if (headerMap.date === undefined) {
        throw new Error(`Could not detect sheet layout. Headers: ${headerRow.slice(0, 10).join(', ')}`);
      }
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const dateStr = parseDate(row[headerMap.date]);
        if (!dateStr) continue;
        const get = (k: string) => headerMap[k] !== undefined ? parseNumber(row[headerMap[k]]) : 0;
        const impressions = get('impressions');
        const clicks = get('clicks');
        daily.push({
          date: dateStr, ad_spend: get('ad_spend'), impressions, clicks,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          leads: get('leads'), spam_leads: get('spam_leads'),
          calls: get('calls'), showed_calls: get('showed_calls'),
          commitments: get('commitments'), commitment_dollars: get('commitment_dollars'),
          funded_investors: get('funded_investors'), funded_dollars: get('funded_dollars'),
          reconnect_calls: get('reconnect_calls'), reconnect_showed: get('reconnect_showed'),
        });
      }
    }

    // Apply date-range filter
    const startD = start_date ? new Date(start_date) : null;
    const endD = end_date ? new Date(end_date) : null;
    if (startD || endD) {
      daily = daily.filter((d) => {
        const dt = new Date(d.date);
        if (startD && dt < startD) return false;
        if (endD && dt > endD) return false;
        return true;
      });
    }

    // Aggregate
    const t = daily.reduce((acc, d) => ({
      totalAdSpend: acc.totalAdSpend + d.ad_spend,
      totalLeads: acc.totalLeads + d.leads,
      spamLeads: acc.spamLeads + d.spam_leads,
      totalCalls: acc.totalCalls + d.calls,
      showedCalls: acc.showedCalls + d.showed_calls,
      reconnectCalls: acc.reconnectCalls + d.reconnect_calls,
      reconnectShowed: acc.reconnectShowed + d.reconnect_showed,
      totalCommitments: acc.totalCommitments + d.commitments,
      commitmentDollars: acc.commitmentDollars + d.commitment_dollars,
      fundedInvestors: acc.fundedInvestors + d.funded_investors,
      fundedDollars: acc.fundedDollars + d.funded_dollars,
      totalClicks: acc.totalClicks + d.clicks,
      totalImpressions: acc.totalImpressions + d.impressions,
    }), {
      totalAdSpend: 0, totalLeads: 0, spamLeads: 0, totalCalls: 0, showedCalls: 0,
      reconnectCalls: 0, reconnectShowed: 0, totalCommitments: 0, commitmentDollars: 0,
      fundedInvestors: 0, fundedDollars: 0, totalClicks: 0, totalImpressions: 0,
    });

    const aggregated = {
      totalAdSpend: t.totalAdSpend,
      totalLeads: t.totalLeads,
      spamLeads: t.spamLeads,
      totalCalls: t.totalCalls,
      showedCalls: t.showedCalls,
      reconnectCalls: t.reconnectCalls,
      reconnectShowed: t.reconnectShowed,
      totalCommitments: t.totalCommitments,
      commitmentDollars: t.commitmentDollars,
      fundedInvestors: t.fundedInvestors,
      fundedDollars: t.fundedDollars,
      ctr: t.totalImpressions > 0 ? (t.totalClicks / t.totalImpressions) * 100 : 0,
      costPerLead: t.totalLeads > 0 ? t.totalAdSpend / t.totalLeads : 0,
      costPerCall: t.totalCalls > 0 ? t.totalAdSpend / t.totalCalls : 0,
      showedPercent: t.totalCalls > 0 ? (t.showedCalls / t.totalCalls) * 100 : 0,
      costPerShow: t.showedCalls > 0 ? t.totalAdSpend / t.showedCalls : 0,
      costPerInvestor: t.fundedInvestors > 0 ? t.totalAdSpend / t.fundedInvestors : 0,
      costOfCapital: t.fundedDollars > 0 ? (t.totalAdSpend / t.fundedDollars) * 100 : 0,
      avgTimeToFund: 0,
      avgCallsToFund: 0,
      leadToBookedPercent: t.totalLeads > 0 ? (t.totalCalls / t.totalLeads) * 100 : 0,
      closeRate: t.showedCalls > 0 ? (t.fundedInvestors / t.showedCalls) * 100 : 0,
      pipelineValue: 0,
      costPerReconnectCall: t.reconnectCalls > 0 ? t.totalAdSpend / t.reconnectCalls : 0,
      costPerReconnectShowed: t.reconnectShowed > 0 ? t.totalAdSpend / t.reconnectShowed : 0,
    };

    return new Response(JSON.stringify({
      daily,
      aggregated,
      sheetTitle,
      layout,
      fetchedAt: new Date().toISOString(),
      rowCount: daily.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('fetch-sheet-metrics error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});