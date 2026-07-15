// Daily Meta ad-spend sync. Writes to public.ad_spend_daily (source of truth)
// and mirrors the same rows into a Google Sheet "Daily Spend" tab (via the
// google_sheets connector gateway). Each client account is isolated in its
// own try/catch with a single retry, and every attempt is logged to
// public.ad_spend_sync_runs so the Data Health dashboard can surface stale
// or failing accounts.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Body = {
  mode?: 'daily' | 'manual';
  client_id?: string;
  date?: string; // YYYY-MM-DD
};

const SHEET_TAB = 'Daily Spend';
const HEADER = ['Date','Client','Account ID','Campaign ID','Campaign Name','Spend','Impressions','Clicks','Leads','Synced At'];
const GATEWAY = 'https://connector-gateway.lovable.dev/google_sheets/v4';

const yesterdayISO = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
};

async function fetchMetaInsights(acct: AccountRow, date: string): Promise<CampaignRow[]> {
  const url = new URL(`https://graph.facebook.com/v21.0/${acct.ad_account_id}/insights`);
  url.searchParams.set('level', 'campaign');
  url.searchParams.set('time_range', JSON.stringify({ since: date, until: date }));
  url.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,actions');
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
  if (!res.ok) throw new Error(`sheets ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function ensureTab(spreadsheetId: string) {
  const meta = await gwFetch(`/spreadsheets/${spreadsheetId}`);
  const has = (meta.sheets ?? []).some((s: any) => s.properties?.title === SHEET_TAB);
  if (!has) {
    await gwFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: SHEET_TAB } } }] }),
    });
    await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A1:J1`, {
      method: 'PUT',
      qs: { valueInputOption: 'RAW' },
      body: JSON.stringify({ values: [HEADER] }),
    });
    return;
  }
  // ensure header
  const cur = await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A1:J1`);
  const first = (cur.values?.[0] ?? []).join('|');
  if (first !== HEADER.join('|')) {
    await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A1:J1`, {
      method: 'PUT',
      qs: { valueInputOption: 'RAW' },
      body: JSON.stringify({ values: [HEADER] }),
    });
  }
}

async function mirrorToSheet(spreadsheetId: string, acct: AccountRow, date: string, rows: CampaignRow[]) {
  if (!rows.length) return;
  // Read existing keys (Date col A, CampaignId col D)
  const existing = await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A2:D`);
  const rowIndexByKey = new Map<string, number>(); // 1-based row number
  for (let i = 0; i < (existing.values?.length ?? 0); i++) {
    const r = existing.values[i];
    const key = `${r[0]}|${r[3]}`;
    rowIndexByKey.set(key, i + 2);
  }
  const now = new Date().toISOString();
  const toAppend: any[][] = [];
  const updates: { range: string; values: any[][] }[] = [];
  for (const r of rows) {
    const row = [date, acct.client_name, acct.ad_account_id, r.campaign_id, r.campaign_name, r.spend, r.impressions, r.clicks, r.leads, now];
    const key = `${date}|${r.campaign_id}`;
    const existingRow = rowIndexByKey.get(key);
    if (existingRow) {
      updates.push({ range: `${SHEET_TAB}!A${existingRow}:J${existingRow}`, values: [row] });
    } else {
      toAppend.push(row);
    }
  }
  if (updates.length) {
    await gwFetch(`/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
  }
  if (toAppend.length) {
    await gwFetch(`/spreadsheets/${spreadsheetId}/values/${SHEET_TAB}!A:J:append`, {
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
    const date = body.date ?? yesterdayISO();

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: settings } = await sb.from('agency_settings').select('meta_spend_sheet_url').limit(1).maybeSingle();
    const spreadsheetId = extractSpreadsheetId(settings?.meta_spend_sheet_url);
    let sheetReady = false;
    if (spreadsheetId) {
      try { await ensureTab(spreadsheetId); sheetReady = true; }
      catch (e) { console.error('ensureTab failed', e); }
    }

    const accounts = await loadAccounts(sb, body.client_id);
    const summary = { total_accounts: accounts.length, ok: 0, failed: 0, total_rows: 0, sheet_ok: 0, sheet_failed: 0 };

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

      let sheetStatus: 'ok' | 'error' | 'skipped' = spreadsheetId ? 'ok' : 'skipped';
      let sheetErr: string | null = null;
      if (spreadsheetId && sheetReady) {
        try { await mirrorToSheet(spreadsheetId, acct, date, rows); summary.sheet_ok++; }
        catch (e) { sheetStatus = 'error'; sheetErr = (e as Error).message; summary.sheet_failed++; }
      } else if (spreadsheetId && !sheetReady) {
        sheetStatus = 'error'; sheetErr = 'sheet tab could not be prepared'; summary.sheet_failed++;
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

    return new Response(JSON.stringify({ ok: true, date, mode, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('sync-meta-ad-spend fatal', e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});