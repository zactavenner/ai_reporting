const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';

// Tabs to skip when scanning the whole spreadsheet. Substring match, case-insensitive.
// These are rollup / instructional / non-daily tabs that would otherwise inflate or
// duplicate the daily totals.
const TAB_DENYLIST = [
  'note', 'notes', 'instruction', 'readme', 'template', 'dashboard',
  'summary', 'monthly', 'weekly', 'mtd', 'ytd', 'pivot', 'chart',
  'lookup', 'config', 'archive', 'overview', 'guide', 'help',
  'goal', 'goals', 'forecast', 'projection', 'export', 'recording', 'fathom',
  'helper',
  // Standard client-tab template additions
  'media buying', 'media buying update', 'media buying updates',
  'lead disposition', 'disposition',
  // Executive Scorecard variants (e.g. "SCORECARD-26", "2026 Scorecard",
  // "CR Scorecard-25"). These are KPI rollups that aggregate the per-record
  // tabs into weekly/monthly totals — including them would double-count
  // daily metrics. The dashboard pulls scorecard values via the dedicated
  // raw_grid action when it needs them.
  'scorecard',
];

function isDenylistedTab(title: string): boolean {
  const t = (title || '').toLowerCase().trim();
  if (!t) return true;
  // Year-only tabs (e.g. "2024", "2025", "2026") are column-major rollups that
  // duplicate the per-record tabs. Skip them so record tabs are the sole
  // source of truth and we don't double-count.
  if (/^(19|20)\d{2}$/.test(t)) return true;
  return TAB_DENYLIST.some((kw) => t.includes(kw));
}

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
  date: ['date', 'day', 'current date', 'lead date', 'date created', 'created at', 'created', 'submitted', 'submission date', 'submitted at', 'timestamp', 'booked date', 'call date', 'funded date', 'commit date'],
  ad_spend: ['spend', 'ad spend', 'total spend', 'adspend', 'fb spend', 'facebook spend', 'meta spend', 'amount spent'],
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
  ad_spend: ['ad spend', 'spend', 'total spend', 'fb spend', 'facebook spend', 'meta spend', 'amount spent'],
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

// Bucket a free-text investment-range string into a canonical label so the
// dashboard's "Ideal Investment Range" chart aggregates cleanly across tabs.
function canonicalRangeBucket(raw: string): string | null {
  const s = (raw || '').toString().trim();
  if (!s) return null;
  const t = s.toLowerCase().replace(/\s+/g, ' ');
  if (/(^|\b)(n\/?a|none|tbd|unknown|—|-)$/.test(t)) return null;
  // If the cell already looks like a labeled bucket ("$50,000 - $100,000",
  // "$1M+"), keep it verbatim — sheet owners curate these labels.
  if (/\$|\bk\b|\bm\b/i.test(s)) return s;
  // Bare number → coerce to a $-prefixed label so it groups with the rest.
  const n = parseFloat(s.replace(/[,\s]/g, ''));
  if (Number.isFinite(n) && n > 0) return `$${n.toLocaleString()}`;
  return s;
}

function canonicalTimelineBucket(raw: string): string | null {
  const s = (raw || '').toString().trim();
  if (!s) return null;
  const t = s.toLowerCase();
  if (/(^|\b)(n\/?a|none|tbd|unknown|—|-)$/.test(t)) return null;
  return s;
}

function canonicalDispositionBucket(raw: string): string | null {
  const s = (raw || '').toString().trim();
  if (!s) return null;
  return s;
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
  let actualRowsFound = 0;
  for (let i = bestRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const label = normalize(String(r[0] ?? ''));
    const subLabel = normalize(String(r[1] ?? ''));
    if (!label) continue;
    if (!subLabel.startsWith('actual')) continue; // only ACTUAL rows
    const field = labelToField[label];
    if (!field) continue;

    actualRowsFound++;
    for (const [colStr, ds] of Object.entries(colDates)) {
      const c = Number(colStr);
      const v = parseNumber(r[c]);
      (byDate[ds] as any)[field] = ((byDate[ds] as any)[field] || 0) + v;
    }
  }

  // If we didn't find any real ACTUAL metric rows, this isn't actually a
  // column-major tab — it's a record tab that happened to have date-looking
  // values in some columns (e.g. "Discovery Booked Call Date" + "Funded
  // Date" in a Funded Investors export). Return empty so the row-major /
  // record-tab parser can handle it instead of emitting zeroed daily rows.
  if (actualRowsFound === 0) return [];

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
  // Fuzzy fallback for date: any header containing the word "date" or "day".
  if (map.date === undefined) {
    const idx = normHeaders.findIndex((h) => /\bdate\b|\bday\b|timestamp|created|submitted|booked/.test(h));
    if (idx >= 0) map.date = idx;
  }
  return map;
}

// Map record-level tab titles → the metric they should contribute as a row count.
// Used when a tab has a date column but no aggregate metric columns (one row per event).
function inferRecordMetric(title: string): keyof DailyMetric | null {
  const t = normalize(title);
  if (/\bbad\b|\bspam\b|\bdisqualified\b/.test(t)) return 'spam_leads';
  if (/\bfunded\b|funded investors?/.test(t)) return 'funded_investors';
  if (/\bcommitt?ed|\bcommitments?\b|committed investors?/.test(t)) return 'commitments';
  if (/reconnect.*show/.test(t)) return 'reconnect_showed';
  if (/reconnect/.test(t)) return 'reconnect_calls';
  if (/discovery.*outcome|\bshow(ed)?\b|outcomes?$/.test(t)) return 'showed_calls';
  if (/discovery.*call|\bcall(s)?\b|\bbooked\b/.test(t)) return 'calls';
  if (/\blead(s)?\b/.test(t)) return 'leads';
  return null;
}

function emptyDaily(date: string): DailyMetric {
  return {
    date, ad_spend: 0, impressions: 0, clicks: 0, ctr: 0,
    leads: 0, spam_leads: 0, calls: 0, showed_calls: 0,
    commitments: 0, commitment_dollars: 0,
    funded_investors: 0, funded_dollars: 0,
    reconnect_calls: 0, reconnect_showed: 0,
  };
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
      const metaRes = await fetchWithRetry(
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
      const metaRes = await fetchWithRetry(
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
      const valuesRes = await fetchWithRetry(
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

    // Coalesce + cache the full parsed payload by sheet+gid (independent of
    // start/end so current+prior period calls hit one fetch). Date filter and
    // aggregation are applied below from the cached parsed `daily`.
    const cacheKey = `${sheet_id}::${gid ?? ''}::${range ?? ''}::${mapping ? JSON.stringify(mapping) : ''}`;
    const now = Date.now();
    let baseParsed: { sheetTitle: string; daily: DailyMetric[]; layout: 'column-major' | 'row-major'; fetchedAt: string } | null = null;
    const cached = parsedCache.get(cacheKey);
    if (cached && now - cached.at < PARSED_TTL_MS) {
      baseParsed = cached.payload;
    } else {
      let pending = inflight.get(cacheKey);
      if (!pending) {
        pending = (async () => {
          // 1. Resolve gid -> sheet title and collect ALL other data tabs.
          // We scan every tab in the spreadsheet (minus a denylist of obvious
          // rollup/instructional tabs) so the executive dashboard reflects 100%
          // of the client's data without re-pointing gids every quarter.
          let sheetTitle: string;
          let extraTitles: string[] = [];
          // Tabs that are denylisted for daily-metric aggregation but that we
          // still need to read for the Investor Profile / Lead Disposition
          // panels (per-lead row scans, not daily roll-ups).
          const dispositionTitles: string[] = [];
          const tabsSkipped: { title: string; reason: string }[] = [];
          if (range && typeof range === 'string') {
            sheetTitle = range;
          } else {
            const metaRes = await fetchWithRetry(
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
            if (!target?.title) throw new Error('Could not resolve sheet title from gid');
            sheetTitle = target.title;
            metaCache.set(`${sheet_id}::${gid ?? ''}`, { at: Date.now(), title: sheetTitle });

            // Scan ALL other tabs, excluding denylisted titles. The primary
            // tab is always included regardless of name.
            for (const s of sheets as any[]) {
              const title = String(s?.properties?.title ?? '').trim();
              if (!title || title === sheetTitle) continue;
              if (isDenylistedTab(title)) {
                tabsSkipped.push({ title, reason: 'denylist' });
                // Always grab Lead Disposition-style tabs for the investor
                // profile panel even though we exclude them from KPI totals.
                if (/disposition/i.test(title)) dispositionTitles.push(title);
                if (title.toLowerCase().includes('scorecard')) {
                  console.log(`[scorecard] sheet=${sheet_id} tab="${title}" gid=${s?.properties?.sheetId} skipped from aggregation (rollup)`);
                }
                continue;
              }
              extraTitles.push(title);
            }
          }

          // 2. Fetch values for the primary tab + every other data tab,
          // chunked at 8 in parallel to respect Google's 60 req/min/user quota.
          // If the configured primary tab is itself a denylisted rollup (e.g. a
          // year tab like "2026"), exclude it so we only aggregate from the
          // per-record tabs.
          const primaryAllowed = !isDenylistedTab(sheetTitle);
          const titlesToFetch = primaryAllowed
            ? [sheetTitle, ...extraTitles]
            : [...extraTitles];
          // Fetch disposition tabs in the same batch but tag them so they
          // skip daily-metric parsing and only feed the bucket scan.
          const allTitles = [...titlesToFetch, ...dispositionTitles];
          if (!primaryAllowed) {
            tabsSkipped.push({ title: sheetTitle, reason: 'year/rollup tab — skipped' });
          }
          const fetched: { title: string; rows: any[][] }[] = [];
          const CHUNK = 8;
          for (let i = 0; i < allTitles.length; i += CHUNK) {
            const batch = allTitles.slice(i, i + CHUNK);
            const results = await Promise.all(batch.map(async (title) => {
              try {
                const vr = await fetchWithRetry(
                  `${GATEWAY_URL}/spreadsheets/${sheet_id}/values/${title}`,
                  { headers }
                );
                const vt = await vr.text();
                if (!vr.ok) {
                  console.warn(`tab "${title}" fetch failed [${vr.status}]: ${vt.slice(0, 200)}`);
                  tabsSkipped.push({ title, reason: `fetch ${vr.status}` });
                  return { title, rows: [] as any[][] };
                }
                const vj = JSON.parse(vt);
                return { title, rows: (vj?.values || []) as any[][] };
              } catch (err) {
                // Never let a single tab fetch reject Promise.all — that
                // surfaces as an UncaughtException and kills the worker,
                // causing the next request to return BOOT_ERROR.
                console.warn(`tab "${title}" fetch threw:`, err instanceof Error ? err.message : String(err));
                tabsSkipped.push({ title, reason: 'fetch threw' });
                return { title, rows: [] as any[][] };
              }
            }));
            fetched.push(...results);
          }

          // Split: daily-metric parsing only consumes the non-disposition tabs.
          const dispositionSet = new Set(dispositionTitles);
          const fetchedForDaily = fetched.filter((f) => !dispositionSet.has(f.title));

          // 3. Parse each tab and merge daily metrics by date.
          // De-dupe strategy: take MAX per (date, metric) across tabs so that
          // overlapping tabs (e.g. a "Q1" sheet and a "2025" sheet) don't
          // double-count, while dates that exist in only one tab still flow.
          const mergedByDate: Record<string, DailyMetric> = {};
          let layout: 'column-major' | 'row-major' = 'column-major';
          const tabsUsed: string[] = [];
          const partsByTab: { title: string; daily: DailyMetric[] }[] = [];
          // Lowest "Capital to Deploy" value across the Leads tab(s). Used as
          // pipelineValue if present. We track the minimum non-zero positive
          // value because the user explicitly wants the lowest.
          let capitalToDeployMin: number | null = null;
          for (const { title, rows } of fetched) {
            let part: DailyMetric[] = parseColumnMajor(rows, mapping);
            let layoutForTab: 'column-major' | 'row-major' = 'column-major';
            if (part.length === 0 && rows.length >= 2) {
              layoutForTab = 'row-major';
              let headerRowIdx = 0;
              for (let i = 0; i < Math.min(rows.length, 5); i++) {
                const candidate = (rows[i] || []).map((c) => normalize(String(c ?? '')));
                if (FIELD_ALIASES.date.some((a) => candidate.includes(normalize(a)))) {
                  headerRowIdx = i; break;
                }
              }
              const headerRow = (rows[headerRowIdx] || []).map((c) => String(c ?? ''));
              const headerMap = buildHeaderMap(headerRow, mapping);
              // Only treat as a daily-metrics tab if the header has a date column
              // AND at least 2 known metric columns. This excludes per-record
              // export tabs that happen to have a "Date" column (e.g. "[FOR EXPORT]")
              // whose other columns are names/phones/notes that would otherwise
              // be coerced into bogus metric values.
              const metricCols = Object.keys(headerMap).filter((k) => k !== 'date').length;
              if (headerMap.date !== undefined && metricCols >= 2) {
                for (let i = headerRowIdx + 1; i < rows.length; i++) {
                  const row = rows[i];
                  const dateStr = parseDate(row[headerMap.date]);
                  if (!dateStr) continue;
                  const get = (k: string) => headerMap[k] !== undefined ? parseNumber(row[headerMap[k]]) : 0;
                  const impressions = get('impressions');
                  const clicks = get('clicks');
                  part.push({
                    date: dateStr, ad_spend: get('ad_spend'), impressions, clicks,
                    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
                    leads: get('leads'), spam_leads: get('spam_leads'),
                    calls: get('calls'), showed_calls: get('showed_calls'),
                    commitments: get('commitments'), commitment_dollars: get('commitment_dollars'),
                    funded_investors: get('funded_investors'), funded_dollars: get('funded_dollars'),
                    reconnect_calls: get('reconnect_calls'), reconnect_showed: get('reconnect_showed'),
                  });
                }
              } else if (headerMap.date !== undefined) {
                // Record-level tab: one row per event with only a date column.
                // Count rows per date and attribute to the metric implied by tab title.
                const recordMetric = inferRecordMetric(title);
                if (recordMetric) {
                  const counts: Record<string, number> = {};
                  const dollarSums: Record<string, number> = {};
                  // Look for a $ amount column on funded / commitment record tabs
                  // so we can sum dollars in addition to row counts.
                  const headerNormForDollar = (rows[headerRowIdx] || []).map((c) => normalize(String(c ?? '')));
                  const dollarColIdx = (() => {
                    if (recordMetric !== 'funded_investors' && recordMetric !== 'commitments') return -1;
                    const patterns = [
                      /funded\s*\$/, /\$\s*funded/, /funded\s*amount/, /funded\s*dollars?/,
                      /commit(?:ment)?\s*\$/, /commit(?:ment)?\s*amount/, /commit(?:ment)?\s*dollars?/,
                      /capital\s*raised/, /raised/, /investment\s*amount/, /amount\s*invested/,
                      /\$\s*amount/, /amount\s*\$/, /\bamount\b/, /\binvestment\b/,
                      /^funded$/, /^committed$/,
                    ];
                    for (let c = 0; c < headerNormForDollar.length; c++) {
                      const h = headerNormForDollar[c];
                      if (!h) continue;
                      if (patterns.some((p) => p.test(h))) return c;
                    }
                    return -1;
                  })();
                  // Build an ordered list of candidate date columns. Many client
                  // sheets have multiple date headers (e.g. "Current Date",
                  // "Funded Date", "Date Created") and individual rows often only
                  // populate one of them. We try them in priority order per row.
                  const headerNormForDate = (rows[headerRowIdx] || []).map((c) => normalize(String(c ?? '')));
                  const dateColCandidates: number[] = (() => {
                    const priority: RegExp[] = recordMetric === 'funded_investors'
                      ? [/funded\s*date/, /^current\s*date$/, /^date$/, /date\s*created/, /created/, /booked\s*(call\s*)?date/]
                      : recordMetric === 'commitments'
                        ? [/commit(?:ted|ment)?\s*date/, /^current\s*date$/, /^date$/, /date\s*created/, /created/, /booked\s*(call\s*)?date/]
                        : [/^date$/, /^current\s*date$/, /booked\s*(call\s*)?date/, /scheduled/, /date\s*created/, /created/];
                    const found: number[] = [];
                    for (const p of priority) {
                      for (let c = 0; c < headerNormForDate.length; c++) {
                        if (found.includes(c)) continue;
                        if (p.test(headerNormForDate[c])) found.push(c);
                      }
                    }
                    // Always include the originally detected date column as a fallback
                    if (!found.includes(headerMap.date as number)) found.push(headerMap.date as number);
                    return found;
                  })();
                  const rowDate = (row: any[]): string | null => {
                    for (const c of dateColCandidates) {
                      const ds = parseDate(row[c]);
                      if (ds) return ds;
                    }
                    return null;
                  };
                  for (let i = headerRowIdx + 1; i < rows.length; i++) {
                    const row = rows[i] || [];
                    const dateStr = rowDate(row);
                    if (!dateStr) continue;
                    counts[dateStr] = (counts[dateStr] || 0) + 1;
                    if (dollarColIdx >= 0) {
                      const v = parseNumber(row[dollarColIdx]);
                      if (v > 0) dollarSums[dateStr] = (dollarSums[dateStr] || 0) + v;
                    }
                  }
                  for (const [ds, n] of Object.entries(counts)) {
                    const d = emptyDaily(ds);
                    (d as any)[recordMetric] = n;
                    const dol = dollarSums[ds] || 0;
                    if (dol > 0) {
                      if (recordMetric === 'funded_investors') d.funded_dollars = dol;
                      else if (recordMetric === 'commitments') d.commitment_dollars = dol;
                    }
                    part.push(d);
                  }
                }

                // Capital to Deploy: scan Leads-style record tabs for the
                // lowest positive value in any "Capital to Deploy" column.
                if (recordMetric === 'leads' || /\blead/.test(normalize(title))) {
                  const headerNorm = (rows[headerRowIdx] || []).map((c) => normalize(String(c ?? '')));
                  const capCol = headerNorm.findIndex((h) =>
                    /capital\s*to\s*deploy/.test(h) ||
                    /capital\s*available/.test(h) ||
                    /investable\s*capital/.test(h) ||
                    /investment\s*range/.test(h) ||
                    /ideal\s*investment/.test(h) ||
                    /investment\s*amount/.test(h)
                  );
                  if (capCol >= 0) {
                    for (let i = headerRowIdx + 1; i < rows.length; i++) {
                      const row = rows[i] || [];
                      // Handle range strings like "$50,000-$100,000" → take the
                      // lower bound; otherwise fall back to plain parseNumber.
                      const raw = String(row[capCol] ?? '').trim();
                      if (!raw) continue;
                      const nums = (raw.match(/\$?\s*[\d,]+(?:\.\d+)?\s*[kKmM]?/g) || [])
                        .map((m) => {
                          const isK = /[kK]\s*$/.test(m);
                          const isM = /[mM]\s*$/.test(m);
                          const n = parseNumber(m.replace(/[kKmM]/g, ''));
                          if (isK) return n * 1_000;
                          if (isM) return n * 1_000_000;
                          return n;
                        })
                        .filter((n) => n > 0);
                      const v = nums.length > 0 ? Math.min(...nums) : 0;
                      if (v > 0) {
                        capitalToDeployMin = capitalToDeployMin === null ? v : Math.min(capitalToDeployMin, v);
                      }
                    }
                  }
                }
              }
            }
            if (layoutForTab === 'row-major') layout = 'row-major';
            if (part.length === 0) {
              if (title !== sheetTitle) tabsSkipped.push({ title, reason: 'no dates' });
              continue;
            }
            tabsUsed.push(title);
            partsByTab.push({ title, daily: part });
            for (const d of part) {
              const acc = mergedByDate[d.date];
              if (!acc) { mergedByDate[d.date] = { ...d }; continue; }
              acc.ad_spend = Math.max(acc.ad_spend, d.ad_spend);
              acc.impressions = Math.max(acc.impressions, d.impressions);
              acc.clicks = Math.max(acc.clicks, d.clicks);
              acc.leads = Math.max(acc.leads, d.leads);
              acc.spam_leads = Math.max(acc.spam_leads, d.spam_leads);
              acc.calls = Math.max(acc.calls, d.calls);
              acc.showed_calls = Math.max(acc.showed_calls, d.showed_calls);
              acc.commitments = Math.max(acc.commitments, d.commitments);
              acc.commitment_dollars = Math.max(acc.commitment_dollars, d.commitment_dollars);
              acc.funded_investors = Math.max(acc.funded_investors, d.funded_investors);
              acc.funded_dollars = Math.max(acc.funded_dollars, d.funded_dollars);
              acc.reconnect_calls = Math.max(acc.reconnect_calls, d.reconnect_calls);
              acc.reconnect_showed = Math.max(acc.reconnect_showed, d.reconnect_showed);
              acc.ctr = acc.impressions > 0 ? (acc.clicks / acc.impressions) * 100 : 0;
            }
          }
          const daily: DailyMetric[] = Object.values(mergedByDate).sort((a, b) => a.date.localeCompare(b.date));
          const payload = {
            sheetTitle, daily, layout,
            tabsScanned: titlesToFetch,
            tabsUsed,
            tabsSkipped,
            partsByTab,
            pipelineValue: capitalToDeployMin || 0,
            fetchedAt: new Date().toISOString(),
          };
          parsedCache.set(cacheKey, { at: Date.now(), payload });
          return payload;
        })();
        inflight.set(cacheKey, pending);
        pending.finally(() => inflight.delete(cacheKey));
      }
      baseParsed = await pending;
    }

    const sheetTitle = baseParsed!.sheetTitle;
    const layout = baseParsed!.layout;
    let daily: DailyMetric[] = baseParsed!.daily.slice();
    const partsByTab: { title: string; daily: DailyMetric[] }[] = (baseParsed as any).partsByTab || [];

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

    // Per-tab breakdown within the active date range. Lets the UI show which
    // tabs contributed to each KPI and flag overlapping dates (potential dupes).
    const inRange = (ds: string) => {
      const dt = new Date(ds);
      if (startD && dt < startD) return false;
      if (endD && dt > endD) return false;
      return true;
    };
    // First pass: count tabs per date to flag overlap.
    const dateTabCount: Record<string, number> = {};
    for (const t of partsByTab) {
      const seen = new Set<string>();
      for (const d of t.daily) {
        if (!inRange(d.date)) continue;
        if (seen.has(d.date)) continue;
        seen.add(d.date);
        dateTabCount[d.date] = (dateTabCount[d.date] || 0) + 1;
      }
    }
    const tabsBreakdown = partsByTab.map((t) => {
      const filtered = t.daily.filter((d) => inRange(d.date));
      const sum = filtered.reduce((acc, d) => ({
        adSpend: acc.adSpend + d.ad_spend,
        impressions: acc.impressions + d.impressions,
        clicks: acc.clicks + d.clicks,
        leads: acc.leads + d.leads,
        spamLeads: acc.spamLeads + d.spam_leads,
        calls: acc.calls + d.calls,
        showedCalls: acc.showedCalls + d.showed_calls,
        commitments: acc.commitments + d.commitments,
        commitmentDollars: acc.commitmentDollars + d.commitment_dollars,
        fundedInvestors: acc.fundedInvestors + d.funded_investors,
        fundedDollars: acc.fundedDollars + d.funded_dollars,
      }), {
        adSpend: 0, impressions: 0, clicks: 0, leads: 0, spamLeads: 0,
        calls: 0, showedCalls: 0, commitments: 0, commitmentDollars: 0,
        fundedInvestors: 0, fundedDollars: 0,
      });
      const dates = filtered.map((d) => d.date).sort();
      const overlapDates = dates.filter((d) => (dateTabCount[d] || 0) > 1);
      return {
        title: t.title,
        isPrimary: t.title === sheetTitle,
        dayCount: filtered.length,
        dateRange: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
        overlapDayCount: overlapDates.length,
        ...sum,
      };
    }).sort((a, b) => b.adSpend - a.adSpend || b.leads - a.leads);

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
      pipelineValue: Number((baseParsed as any)?.pipelineValue || 0),
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
      tabsScanned: (baseParsed as any).tabsScanned ?? [],
      tabsUsed: (baseParsed as any).tabsUsed ?? [],
      tabsSkipped: (baseParsed as any).tabsSkipped ?? [],
      tabsBreakdown,
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