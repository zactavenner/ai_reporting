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
    .select('id, name, status, meta_ad_account_id, meta_ad_account_ids, meta_access_token, meta_system_user_token')
    .eq('status', 'active');
  if (clientId) q.eq('id', clientId);
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
  const { error } = await sb.from('ad_spend_daily')
    .upsert(payload, { onConflict: 'date,campaign_id' });
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
  for (let attempt = 1; attempt <= 4; attempt++) {
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
    if (!retryable || attempt === 4) {
      throw new Error(`sheets ${res.status}: ${text.slice(0, 400)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after') ?? 0);
    const waitMs = retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30000, 2000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 750);
    console.warn(`sheets ${res.status} on ${path} — retrying in ${waitMs}ms (attempt ${attempt})`);
    await sleep(waitMs);
  }
  throw new Error('sheets: exhausted retries');
}

async function ensureTab(spreadsheetId: string) {
  const meta = await gwFetch(`/spreadsheets/${spreadsheetId}`);
  const has = (meta.sheets ?? []).some((s: any) => s.properties?.title === SHEET_TAB);
  if (!has) {
    await gwFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] }),
    });
    await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A1:${LAST_COL}1`, {
      method: 'PUT',
      qs: { valueInputOption: 'RAW' },
      body: JSON.stringify({ values: [HEADER] }),
    });
    return;
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

// One read per spreadsheet per run instead of one read per client/date —
// the repeated A2:N reads were what tripped the Sheets read quota (429).
async function loadSheetIndex(spreadsheetId: string, cache: Map<string, SheetIndex>): Promise<SheetIndex> {
  const hit = cache.get(spreadsheetId);
  if (hit) return hit;
  const existing = await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A2:N`);
  const rowIndexByKey = new Map<string, number>(); // 1-based row number
  const values = existing.values ?? [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    // columns: A=date(0) ... M=campaign_id(12) N=account_id(13)
    rowIndexByKey.set(`${r[0]}|${r[12] ?? ''}|${r[13] ?? ''}`, i + 2);
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
            try { await mirrorToSheet(clientSheetId, acct, date, rows); summary.sheet_ok++; }
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
          status: overall, rows_written: written,
          sheet_status: sheetStatus, sheet_error: sheetErr,
          finished_at: new Date().toISOString(),
        }).eq('id', runId);
      }
    }

    return new Response(JSON.stringify({ ok: true, dates, mode, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('sync-meta-ad-spend fatal', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});