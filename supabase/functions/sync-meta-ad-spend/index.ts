// Daily Meta ad-spend sync. Writes to public.ad_spend_daily (source of truth)
// and mirrors the same rows into each client's own KPI Google Sheet on a
// tab called "FB Spend" (via the google_sheets connector gateway). Each
// client account is isolated in its own try/catch with a single retry, and
// every attempt is logged to public.ad_spend_sync_runs so the Data Health
// dashboard can surface stale or failing accounts.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Body = {
  mode?: 'daily' | 'manual';
  client_id?: string;
  date?: string; // YYYY-MM-DD
  days_back?: number; // backfill: syncs [today - days_back .. yesterday]
};

const SHEET_TAB = 'FB Spend';
// Daily report send hour in America/Los_Angeles (finalized platform spend).
const SEND_HOUR_LA = 8;
const HEADER = [
  'Date','Campaign Name','Ad Spend','Impressions','Clicks','Frequency','CTR',
  'Reach','CPM','CPC','Leads','Cost/Lead','Campaign ID','Account ID','Synced At',
];
const LAST_COL = 'O'; // 15 columns
const GATEWAY = 'https://connector-gateway.lovable.dev/google_sheets/v4';

const yesterdayISO = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const isoNDaysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Minimum gap between Google Sheets gateway calls (read quota is per-minute
// per project, and every client in the loop touches the same quota).
const SHEETS_MIN_GAP_MS = 350;
let sheetsLastCallAt = 0;
async function sheetsThrottle() {
  const wait = sheetsLastCallAt + SHEETS_MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  sheetsLastCallAt = Date.now();
}

function extractSpreadsheetId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

type AccountRow = { client_id: string; client_name: string; ad_account_id: string; token: string };

async function loadAccounts(sb: any, clientId?: string): Promise<AccountRow[]> {
  const q = sb.from('clients')
    .select('id, name, status, meta_ad_account_id, meta_ad_account_ids, meta_access_token, meta_system_user_token');
  // Explicit single-client runs (manual/backfill) bypass the status filter so
  // onboarding/paused clients can still be synced on demand.
  if (clientId) q.eq('id', clientId); else q.eq('status', 'active');
  const { data, error } = await q;
  if (error) throw error;
  const shared = Deno.env.get('META_SHARED_ACCESS_TOKEN') ?? '';
  const out: AccountRow[] = [];
  for (const c of data ?? []) {
    const token = c.meta_system_user_token || c.meta_access_token || shared;
    if (!token) continue;
    const seen = new Set<string>();
    const push = (aid?: string | null) => {
      if (!aid) return;
      const norm = aid.startsWith('act_') ? aid : `act_${aid}`;
      if (seen.has(norm)) return;
      seen.add(norm);
      out.push({ client_id: c.id, client_name: c.name, ad_account_id: norm, token });
    };
    push(c.meta_ad_account_id);
    for (const a of c.meta_ad_account_ids ?? []) push(a);
  }
  return out;
}

type CampaignRow = {
  campaign_id: string; campaign_name: string;
  spend: number; impressions: number; clicks: number; leads: number;
  reach: number; frequency: number; ctr: number; cpm: number; cpc: number;
};

async function fetchMetaInsights(acct: AccountRow, date: string): Promise<CampaignRow[]> {
  const url = new URL(`https://graph.facebook.com/v21.0/${acct.ad_account_id}/insights`);
  url.searchParams.set('level', 'campaign');
  url.searchParams.set('time_range', JSON.stringify({ since: date, until: date }));
  url.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,reach,frequency,ctr,cpm,cpc,actions');
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', acct.token);
  const res = await fetch(url.toString());
  const text = await res.text();
  if (!res.ok) throw new Error(`meta ${res.status}: ${text.slice(0, 400)}`);
  const body = JSON.parse(text);
  const rows: CampaignRow[] = [];
  for (const r of body.data ?? []) {
    let leads = 0;
    for (const a of r.actions ?? []) {
      if (a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped' || a.action_type === 'leadgen.other') {
        leads += Number(a.value ?? 0);
      }
    }
    rows.push({
      campaign_id: String(r.campaign_id),
      campaign_name: r.campaign_name ?? '',
      spend: Number(r.spend ?? 0),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      leads,
      reach: Number(r.reach ?? 0),
      frequency: Number(r.frequency ?? 0),
      ctr: Number(r.ctr ?? 0),
      cpm: Number(r.cpm ?? 0),
      cpc: Number(r.cpc ?? 0),
    });
  }
  return rows;
}

// ---------- ad account health ----------
// account_status: 1 ACTIVE, 2 DISABLED, 3 UNSETTLED, 7 PENDING_RISK_REVIEW,
// 8 PENDING_SETTLEMENT, 9 IN_GRACE_PERIOD, 100 PENDING_CLOSURE, 101 CLOSED,
// 201 ANY_ACTIVE, 202 ANY_CLOSED. Anything other than 1/9 cannot deliver, so a
// "0 rows" sync is expected — we must surface WHY instead of blaming the token.
type AccountHealth = { status: number; disable_reason: number | null; ok: boolean; label: string };
const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending risk review',
  8: 'pending settlement', 9: 'in grace period', 100: 'pending closure', 101: 'closed',
};
const DISABLE_REASON_LABEL: Record<number, string> = {
  0: 'none', 1: 'ads integrity policy', 2: 'ads-ip review', 3: 'risk payment',
  4: 'gray account shut down', 5: 'ads afc review', 6: 'business integrity rar',
  7: 'permanent close', 8: 'unused reseller account', 9: 'unused account',
};
async function fetchAccountHealth(acct: AccountRow, cache: Map<string, AccountHealth>): Promise<AccountHealth | null> {
  const hit = cache.get(acct.ad_account_id);
  if (hit) return hit;
  try {
    const url = new URL(`https://graph.facebook.com/v21.0/${acct.ad_account_id}`);
    url.searchParams.set('fields', 'account_status,disable_reason');
    url.searchParams.set('access_token', acct.token);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const b = await res.json();
    const status = Number(b.account_status ?? 0);
    const disable_reason = b.disable_reason == null ? null : Number(b.disable_reason);
    const health: AccountHealth = {
      status,
      disable_reason,
      ok: status === 1 || status === 9,
      label: `${ACCOUNT_STATUS_LABEL[status] ?? `status ${status}`}${
        disable_reason ? ` (${DISABLE_REASON_LABEL[disable_reason] ?? `reason ${disable_reason}`})` : ''
      }`,
    };
    cache.set(acct.ad_account_id, health);
    return health;
  } catch {
    return null;
  }
}

async function upsertDaily(sb: any, acct: AccountRow, date: string, rows: CampaignRow[]): Promise<number> {
  if (!rows.length) return 0;
  const payload = rows.map((r) => ({
    date, client_id: acct.client_id, client_name: acct.client_name,
    ad_account_id: acct.ad_account_id,
    campaign_id: r.campaign_id, campaign_name: r.campaign_name,
    spend: r.spend, impressions: r.impressions, clicks: r.clicks, leads: r.leads,
    reach: r.reach, frequency: r.frequency, ctr: r.ctr, cpm: r.cpm, cpc: r.cpc,
    cost_per_lead: r.leads > 0 ? r.spend / r.leads : null,
    synced_at: new Date().toISOString(),
  }));
  // One row per client + ad account + campaign + date: re-runs update in place.
  const { error } = await sb.from('ad_spend_daily')
    .upsert(payload, { onConflict: 'client_id,ad_account_id,campaign_id,date' });
  if (error) throw error;
  return payload.length;
}

// ---------- Google Sheets mirror ----------

async function gwFetch(path: string, init: RequestInit & { qs?: Record<string, string> } = {}) {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const gsKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
  if (!lovableKey || !gsKey) throw new Error('sheets connector env missing');
  const url = new URL(`${GATEWAY}${path}`);
  for (const [k, v] of Object.entries(init.qs ?? {})) url.searchParams.set(k, v);
  // Sheets quota is per-minute; serialize requests with a small floor gap and
  // back off on 429/5xx (honoring Retry-After). 4xx other than 429 never
  // recovers on retry, so those throw immediately.
  const MAX_ATTEMPTS = 6;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await sheetsThrottle();
    const res = await fetch(url.toString(), {
      ...init,
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        'X-Connection-Api-Key': gsKey,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`sheets ${res.status}: ${text.slice(0, 400)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after') ?? 0);
    const waitMs = retryAfter > 0
      ? retryAfter * 1000
      : Math.min(60000, 3000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 1000);
    console.warn(`sheets ${res.status} on ${path} — retrying in ${waitMs}ms (attempt ${attempt})`);
    await sleep(waitMs);
  }
  throw new Error('sheets: exhausted retries');
}

// Cache of the "FB Spend" tab gid per spreadsheet (needed to delete rows).
const tabGidCache = new Map<string, number>();

async function ensureTab(spreadsheetId: string) {
  const meta = await gwFetch(`/spreadsheets/${spreadsheetId}`);
  const tab = (meta.sheets ?? []).find((s: any) => s.properties?.title === SHEET_TAB);
  if (!tab) {
    const created = await gwFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] }),
    });
    const gid = created?.replies?.[0]?.addSheet?.properties?.sheetId;
    if (typeof gid === 'number') tabGidCache.set(spreadsheetId, gid);
    await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A1:${LAST_COL}1`, {
      method: 'PUT',
      qs: { valueInputOption: 'RAW' },
      body: JSON.stringify({ values: [HEADER] }),
    });
    return;
  }
  if (typeof tab.properties?.sheetId === 'number') {
    tabGidCache.set(spreadsheetId, tab.properties.sheetId);
  }
  // ensure header
  const cur = await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A1:${LAST_COL}1`);
  const first = (cur.values?.[0] ?? []).join('|');
  if (first !== HEADER.join('|')) {
    await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A1:${LAST_COL}1`, {
      method: 'PUT',
      qs: { valueInputOption: 'RAW' },
      body: JSON.stringify({ values: [HEADER] }),
    });
  }
}

type SheetIndex = { rowIndexByKey: Map<string, number>; nextRow: number };

const rowKey = (r: any[]) => `${r?.[0] ?? ''}|${r?.[12] ?? ''}|${r?.[13] ?? ''}`;

// Removes pre-existing duplicate rows for the same date+campaign+account,
// keeping the most recent (last) occurrence. Deletions run bottom-up so the
// row numbers of the pending deletes stay valid.
async function dedupeSheetRows(spreadsheetId: string, values: any[][]): Promise<any[][]> {
  const gid = tabGidCache.get(spreadsheetId);
  const lastByKey = new Map<string, number>();
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    if (!r || !r[0]) continue;
    lastByKey.set(rowKey(r), i);
  }
  const dupIdx: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    if (!r || !r[0]) continue;
    if (lastByKey.get(rowKey(r)) !== i) dupIdx.push(i);
  }
  if (!dupIdx.length) return values;
  if (typeof gid !== 'number') {
    console.warn(`dedupe skipped for ${spreadsheetId}: tab gid unknown`);
    return values;
  }
  const requests = dupIdx
    .slice()
    .sort((a, b) => b - a)
    .map((i) => ({
      deleteDimension: {
        range: { sheetId: gid, dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 },
      },
    }));
  for (let i = 0; i < requests.length; i += 200) {
    await gwFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: requests.slice(i, i + 200) }),
    });
  }
  console.log(`dedupe: removed ${dupIdx.length} duplicate FB Spend rows from ${spreadsheetId}`);
  const drop = new Set(dupIdx);
  return values.filter((_, i) => !drop.has(i));
}

// One read per spreadsheet per run instead of one read per client/date —
// the repeated A2:N reads were what tripped the Sheets read quota (429).
async function loadSheetIndex(spreadsheetId: string, cache: Map<string, SheetIndex>): Promise<SheetIndex> {
  const hit = cache.get(spreadsheetId);
  if (hit) return hit;
  const existing = await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A2:N`);
  // Collapse any historical duplicates first so the index below is 1:1.
  const values = await dedupeSheetRows(spreadsheetId, existing.values ?? []);
  const rowIndexByKey = new Map<string, number>(); // 1-based row number
  for (let i = 0; i < values.length; i++) {
    // columns: A=date(0) ... M=campaign_id(12) N=account_id(13)
    rowIndexByKey.set(rowKey(values[i]), i + 2);
  }
  const idx: SheetIndex = { rowIndexByKey, nextRow: values.length + 2 };
  cache.set(spreadsheetId, idx);
  return idx;
}


async function mirrorToSheet(
  spreadsheetId: string,
  acct: AccountRow,
  date: string,
  rows: CampaignRow[],
  cache: Map<string, SheetIndex>,
) {
  if (!rows.length) return;
  const index = await loadSheetIndex(spreadsheetId, cache);
  const { rowIndexByKey } = index;
  const now = new Date().toISOString();
  const toAppend: any[][] = [];
  const updates: { range: string; values: any[][] }[] = [];
  for (const r of rows) {
    const costPerLead = r.leads > 0 ? +(r.spend / r.leads).toFixed(2) : '';
    const row = [
      date, r.campaign_name, r.spend, r.impressions, r.clicks,
      r.frequency, r.ctr, r.reach, r.cpm, r.cpc,
      r.leads, costPerLead, r.campaign_id, acct.ad_account_id, now,
    ];
    const key = `${date}|${r.campaign_id}|${acct.ad_account_id}`;
    const existingRow = rowIndexByKey.get(key);
    if (existingRow) {
      updates.push({ range: `${SHEET_TAB}!A${existingRow}:${LAST_COL}${existingRow}`, values: [row] });
    } else {
      toAppend.push(row);
      // Reserve the row locally so a later account/date in the same run
      // updates it instead of appending a duplicate.
      rowIndexByKey.set(key, index.nextRow);
      index.nextRow += 1;
    }
  }
  if (updates.length) {
    await gwFetch(`/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
  }
  if (toAppend.length) {
    await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A:${LAST_COL}:append`, {
      method: 'POST',
      qs: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
      body: JSON.stringify({ values: toAppend }),
    });
  }
}

// ---------- main handler ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body: Body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const mode = body.mode ?? 'manual';

    // Scheduled runs only fire at ~08:00 America/Los_Angeles. Platform spend
    // for "yesterday" is not finalized at 04:00, which caused discrepancies.
    // pg_cron has no timezone support, so the cron fires hourly around the
    // window and this DST-safe local-hour gate picks the right one.
    if (mode === 'daily' && !body.date && !body.days_back) {
      const laHour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false,
        }).format(new Date())
      );
      if (laHour !== SEND_HOUR_LA) {
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: `local hour ${laHour} != ${SEND_HOUR_LA}`, tz: 'America/Los_Angeles' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    const daysBack = Math.max(0, Math.min(30, Number(body.days_back ?? 0)));
    const dates: string[] = body.date
      ? [body.date]
      : daysBack > 0
        ? Array.from({ length: daysBack }, (_, i) => isoNDaysAgo(i + 1)) // yesterday backwards
        : [yesterdayISO()];

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Per-client KPI sheet map (kpi_google_sheet_url → spreadsheetId)
    const { data: cs } = await sb
      .from('client_settings')
      .select('client_id, kpi_google_sheet_url');
    const sheetIdByClient = new Map<string, string>();
    for (const row of cs ?? []) {
      const id = extractSpreadsheetId((row as any).kpi_google_sheet_url);
      if (id) sheetIdByClient.set((row as any).client_id, id);
    }
    const readySheets = new Set<string>();
    const sheetIndexCache = new Map<string, SheetIndex>();
    const healthCache = new Map<string, AccountHealth>();

    const accounts = await loadAccounts(sb, body.client_id);
    const summary = {
      total_accounts: accounts.length, dates: dates.length,
      ok: 0, failed: 0, total_rows: 0, sheet_ok: 0, sheet_failed: 0, sheet_skipped: 0,
    };

    for (const date of dates) {
      for (const acct of accounts) {
        const { data: runIns } = await sb.from('ad_spend_sync_runs').insert({
          client_id: acct.client_id, client_name: acct.client_name,
          ad_account_id: acct.ad_account_id, sync_date: date,
          status: 'running', triggered_by: mode,
        }).select('id').single();
        const runId = runIns?.id;

        let rows: CampaignRow[] = [];
        let lastErr: string | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try { rows = await fetchMetaInsights(acct, date); lastErr = null; break; }
          catch (e) { lastErr = (e as Error).message; if (attempt === 1) await sleep(2000); }
        }
        if (lastErr) {
          summary.failed++;
          await sb.from('ad_spend_sync_runs').update({
            status: 'error', error_message: lastErr, finished_at: new Date().toISOString(),
          }).eq('id', runId);
          continue;
        }

        // A clean fetch that returns nothing is ambiguous: either the account
        // genuinely didn't deliver, or Meta has it disabled/unsettled. Resolve
        // that here so the run row states the real reason.
        let blockedReason: string | null = null;
        if (!rows.length) {
          const health = await fetchAccountHealth(acct, healthCache);
          if (health && !health.ok) {
            blockedReason = `Meta ad account ${acct.ad_account_id} is ${health.label} — no delivery, so no spend to report. Resolve in Meta Business Manager.`;
          }
        }

        let written = 0;
        try { written = await upsertDaily(sb, acct, date, rows); }
        catch (e) {
          summary.failed++;
          await sb.from('ad_spend_sync_runs').update({
            status: 'error', error_message: `db upsert: ${(e as Error).message}`,
            finished_at: new Date().toISOString(),
          }).eq('id', runId);
          continue;
        }

        // Per-client sheet mirror
        const clientSheetId = sheetIdByClient.get(acct.client_id);
        let sheetStatus: 'ok' | 'error' | 'skipped' = clientSheetId ? 'ok' : 'skipped';
        let sheetErr: string | null = null;
        if (clientSheetId) {
          if (!readySheets.has(clientSheetId)) {
            try { await ensureTab(clientSheetId); readySheets.add(clientSheetId); }
            catch (e) { sheetStatus = 'error'; sheetErr = `ensureTab: ${(e as Error).message}`; }
          }
          if (sheetStatus === 'ok') {
            try { await mirrorToSheet(clientSheetId, acct, date, rows, sheetIndexCache); summary.sheet_ok++; }
            catch (e) { sheetStatus = 'error'; sheetErr = (e as Error).message; summary.sheet_failed++; }
          } else {
            summary.sheet_failed++;
          }
        } else {
          summary.sheet_skipped++;
        }

        const overall = sheetStatus === 'error' ? 'partial' : 'success';
        summary.ok++;
        summary.total_rows += written;
        await sb.from('ad_spend_sync_runs').update({
          status: blockedReason ? 'blocked' : overall,
          rows_written: written,
          error_message: blockedReason,
          sheet_status: sheetStatus, sheet_error: sheetErr,
          finished_at: new Date().toISOString(),
        }).eq('id', runId);
      }
    }

    // ---- Stale-spend watchdog -------------------------------------------
    // Any active client with Meta sync enabled that has no ad_spend_daily row
    // for yesterday gets one retry, then a logged discrepancy so Data Health
    // shows it before the 6 AM PST report window.
    const watchdog: Array<{ client_id: string; client_name: string; recovered: boolean }> = [];
    if (mode === 'daily') {
      const yday = yesterdayISO();
      const clientIds = [...new Set(accounts.map((a) => a.client_id))];
      for (const cid of clientIds) {
        const { count } = await sb.from('ad_spend_daily')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', cid).eq('date', yday);
        if ((count ?? 0) > 0) continue;

        const clientAccts = accounts.filter((a) => a.client_id === cid);
        let recovered = 0;
        for (const acct of clientAccts) {
          try {
            const rows = await fetchMetaInsights(acct, yday);
            recovered += await upsertDaily(sb, acct, yday, rows);
          } catch (e) {
            console.error(`watchdog retry failed ${acct.client_name}`, (e as Error).message);
          }
        }
        watchdog.push({
          client_id: cid,
          client_name: clientAccts[0]?.client_name ?? '',
          recovered: recovered > 0,
        });
        if (recovered === 0) {
          const reasons: string[] = [];
          for (const acct of clientAccts) {
            const health = await fetchAccountHealth(acct, healthCache);
            if (health && !health.ok) reasons.push(`${acct.ad_account_id}: ${health.label}`);
          }
          const detail = reasons.length
            ? `Meta ad account not delivering — ${reasons.join('; ')}. Resolve in Meta Business Manager; no spend exists to backfill.`
            : `No ad_spend_daily rows for ${yday} after retry — check Meta token / ad account access.`;
          await sb.from('data_discrepancies').insert({
            client_id: cid,
            discrepancy_type: 'ad_spend_missing',
            date_range_start: yday,
            date_range_end: yday,
            api_count: 0,
            db_count: 0,
            difference: 0,
            severity: reasons.length ? 'critical' : 'high',
            status: 'open',
            resolution_notes: detail,
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, dates, mode, summary, watchdog }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('sync-meta-ad-spend fatal', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});