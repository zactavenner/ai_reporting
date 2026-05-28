import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';

const RIQ_HEADERS = [
  'RIQ Net Worth','RIQ HH Income','RIQ Discretionary Income','RIQ Home Value','RIQ Home Ownership',
  'RIQ Credit Range','RIQ Age','RIQ Marital Status','RIQ Education','RIQ Occupation','RIQ Company',
  'RIQ Title','RIQ LinkedIn','RIQ City','RIQ State','RIQ Investor','RIQ Enriched At',
];

function extractSheetId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}
const normPhone = (p: any) => String(p || '').replace(/\D/g, '').slice(-10);
const normEmail = (e: any) => String(e || '').trim().toLowerCase();
function colLetter(n: number) { let s=''; while(n>0){const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; }
const escapeRange = (t: string) => t.includes("'") ? t.replace(/'/g, "''") : t;
const fmt = (v: any) => (v === null || v === undefined || v === '') ? '' : String(v);
function rowValues(enr: any): string[] {
  return [
    fmt(enr.net_worth), fmt(enr.household_income), fmt(enr.discretionary_income),
    enr.home_value ? `$${Number(enr.home_value).toLocaleString()}` : '',
    fmt(enr.home_ownership), fmt(enr.credit_range), fmt(enr.age), fmt(enr.marital_status),
    fmt(enr.education), fmt(enr.occupation), fmt(enr.company_name), fmt(enr.company_title),
    fmt(enr.linkedin_url), fmt(enr.city), fmt(enr.state),
    enr.is_investor ? 'Yes' : '',
    enr.enriched_at ? new Date(enr.enriched_at).toISOString().slice(0,10) : '',
  ];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const clientId: string = body.client_id;
    const limit: number = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
    const dryRun: boolean = body.dry_run === true;
    if (!clientId) return new Response(JSON.stringify({ success:false, error:'client_id required' }), { status:400, headers:{...corsHeaders,'Content-Type':'application/json'} });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const audit: any = {
      client_id: clientId, limit, dry_run: dryRun,
      leads_considered: 0, missing_contact: 0,
      enrichment: { already_enriched: 0, newly_enriched: 0, failed: 0, failures: [] as any[] },
      sheet: null as any,
    };

    // 1) Fetch client + settings
    const { data: client } = await supabase.from('clients').select('id, name, ghl_api_key, ghl_location_id').eq('id', clientId).maybeSingle();
    const { data: setting } = await supabase.from('client_settings').select('retargetiq_website_slug, kpi_google_sheet_url').eq('client_id', clientId).maybeSingle();
    if (!client) throw new Error('Client not found');
    audit.client_name = client.name;
    audit.slug = setting?.retargetiq_website_slug || null;

    // 2) Pull recent leads
    const { data: leads } = await supabase
      .from('leads')
      .select('id, external_id, name, email, phone, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit);
    audit.leads_considered = (leads || []).length;
    audit.lead_sample = (leads || []).map(l => ({ name: l.name, email: l.email, phone: l.phone, created_at: l.created_at }));

    if (!leads || leads.length === 0) {
      return new Response(JSON.stringify({ success: true, audit }), { headers:{...corsHeaders,'Content-Type':'application/json'} });
    }

    // 3) Identify already-enriched
    const extIds = leads.map(l => l.external_id).filter(Boolean);
    const { data: existing } = await supabase
      .from('lead_enrichment')
      .select('external_id')
      .eq('client_id', clientId)
      .in('external_id', extIds);
    const enrichedSet = new Set((existing || []).map(e => e.external_id));

    // 4) Enrich missing ones (unless dry run)
    for (const lead of leads) {
      if (!lead.external_id) { audit.missing_contact++; continue; }
      if (enrichedSet.has(lead.external_id)) { audit.enrichment.already_enriched++; continue; }
      if (!lead.email && !lead.phone) {
        audit.missing_contact++;
        audit.enrichment.failures.push({ lead: lead.name, reason: 'no email/phone' });
        continue;
      }
      if (dryRun) continue;
      try {
        const nameParts = (lead.name || '').split(' ');
        const res = await fetch(`${supabaseUrl}/functions/v1/enrich-lead-retargetiq`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            client_id: clientId, lead_id: lead.id, external_id: lead.external_id,
            phone: lead.phone || undefined, email: lead.email || undefined,
            first_name: nameParts[0] || undefined, last_name: nameParts.slice(1).join(' ') || undefined,
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (j?.success) audit.enrichment.newly_enriched++;
        else { audit.enrichment.failed++; audit.enrichment.failures.push({ lead: lead.name, reason: j?.error || `status ${res.status}` }); }
      } catch (e: any) {
        audit.enrichment.failed++;
        audit.enrichment.failures.push({ lead: lead.name, reason: e.message });
      }
      await new Promise(r => setTimeout(r, 800));
    }

    // 5) Sheet writeback restricted to these lead external_ids
    const sheetId = extractSheetId(setting?.kpi_google_sheet_url);
    if (!sheetId) {
      audit.sheet = { skipped: 'no_sheet_connected' };
      return new Response(JSON.stringify({ success: true, audit }), { headers:{...corsHeaders,'Content-Type':'application/json'} });
    }
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GS = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!LOVABLE_API_KEY || !GS) {
      audit.sheet = { skipped: 'sheets_connector_unconfigured' };
      return new Response(JSON.stringify({ success: true, audit }), { headers:{...corsHeaders,'Content-Type':'application/json'} });
    }
    const sheetHeaders = { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'X-Connection-Api-Key': GS };

    // Re-fetch enrichments for these leads
    const { data: enrichments } = await supabase
      .from('lead_enrichment')
      .select('external_id, enriched_at, net_worth, household_income, discretionary_income, home_value, home_ownership, credit_range, age, marital_status, education, occupation, company_name, company_title, linkedin_url, city, state, is_investor')
      .eq('client_id', clientId)
      .in('external_id', extIds);

    const enrByExt = new Map((enrichments || []).map(e => [e.external_id, e]));
    const enrByEmail = new Map<string, any>();
    const enrByPhone = new Map<string, any>();
    for (const l of leads) {
      const e = enrByExt.get(l.external_id);
      if (!e) continue;
      const em = normEmail(l.email); const ph = normPhone(l.phone);
      if (em) enrByEmail.set(em, e);
      if (ph.length === 10) enrByPhone.set(ph, e);
    }

    const metaRes = await fetch(`${GATEWAY_URL}/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title,gridProperties))`, { headers: sheetHeaders });
    if (!metaRes.ok) {
      audit.sheet = { error: `meta ${metaRes.status}` };
      return new Response(JSON.stringify({ success: true, audit }), { headers:{...corsHeaders,'Content-Type':'application/json'} });
    }
    const meta = await metaRes.json();
    const tabs = (meta?.sheets || []).map((s: any) => ({
      title: s?.properties?.title || '',
      sheetId: s?.properties?.sheetId ?? 0,
      columnCount: s?.properties?.gridProperties?.columnCount ?? 26,
    })).filter((t: any) => t.title);

    const sheetAudit: any = { sheet_id: sheetId, dry_run: dryRun, tabs: [] as any[], totals: { matched: 0, written: 0, skipped: 0 } };

    for (const tab of tabs) {
      const tabRes: any = { tab: tab.title, scanned_rows: 0, matched: 0, written: 0, skipped: [] as any[], matches: [] as any[] };
      try {
        const range = `'${escapeRange(tab.title)}'!A1:ZZ5000`;
        const valRes = await fetch(`${GATEWAY_URL}/spreadsheets/${sheetId}/values/${range}`, { headers: sheetHeaders });
        if (!valRes.ok) { tabRes.error = `values ${valRes.status}`; sheetAudit.tabs.push(tabRes); continue; }
        const valJson = await valRes.json();
        const rows: string[][] = valJson.values || [];
        if (rows.length < 2) { tabRes.note = 'empty'; sheetAudit.tabs.push(tabRes); continue; }
        const headerRow = rows[0].map(h => String(h || '').trim());
        const headerLower = headerRow.map(h => h.toLowerCase());
        const emailIdx = headerLower.findIndex(h => /\bemail\b|e-?mail/.test(h));
        const phoneIdx = headerLower.findIndex(h => /\bphone\b|mobile|cell/.test(h));
        if (emailIdx < 0 && phoneIdx < 0) { tabRes.note = 'no_email_or_phone_column'; sheetAudit.tabs.push(tabRes); continue; }

        let riqStart = headerLower.indexOf('riq net worth');
        const writeRequests: { range: string; values: string[][] }[] = [];
        if (riqStart < 0) {
          riqStart = headerRow.length;
          if (!dryRun) writeRequests.push({ range: `'${escapeRange(tab.title)}'!${colLetter(riqStart + 1)}1:${colLetter(riqStart + RIQ_HEADERS.length)}1`, values: [RIQ_HEADERS] });
        }
        const neededCols = riqStart + RIQ_HEADERS.length;
        if (!dryRun && neededCols > tab.columnCount) {
          await fetch(`${GATEWAY_URL}/spreadsheets/${sheetId}:batchUpdate`, {
            method: 'POST', headers: { ...sheetHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests: [{ appendDimension: { sheetId: tab.sheetId, dimension: 'COLUMNS', length: neededCols - tab.columnCount } }] }),
          });
        }

        tabRes.scanned_rows = rows.length - 1;
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]; if (!row || row.length === 0) continue;
          const em = emailIdx >= 0 ? normEmail(row[emailIdx]) : '';
          const ph = phoneIdx >= 0 ? normPhone(row[phoneIdx]) : '';
          let enr: any = null; let matchedBy = '';
          if (em && enrByEmail.has(em)) { enr = enrByEmail.get(em); matchedBy = 'email'; }
          else if (ph.length === 10 && enrByPhone.has(ph)) { enr = enrByPhone.get(ph); matchedBy = 'phone'; }
          if (!enr) continue;

          const existingEnrichedAt = row[riqStart + RIQ_HEADERS.length - 1];
          const todayStr = enr.enriched_at ? new Date(enr.enriched_at).toISOString().slice(0, 10) : '';
          if (existingEnrichedAt && existingEnrichedAt === todayStr) {
            tabRes.skipped.push({ row: i + 1, reason: 'already_written_today', matched_by: matchedBy });
            continue;
          }
          tabRes.matched++;
          tabRes.matches.push({ row: i + 1, matched_by: matchedBy, email: em || null, phone: ph || null });
          if (!dryRun) {
            const rng = `'${escapeRange(tab.title)}'!${colLetter(riqStart + 1)}${i + 1}:${colLetter(riqStart + RIQ_HEADERS.length)}${i + 1}`;
            writeRequests.push({ range: rng, values: [rowValues(enr)] });
          }
        }

        if (!dryRun && writeRequests.length > 0) {
          const bRes = await fetch(`${GATEWAY_URL}/spreadsheets/${sheetId}/values:batchUpdate`, {
            method: 'POST', headers: { ...sheetHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writeRequests }),
          });
          if (bRes.ok) tabRes.written = writeRequests.length;
          else tabRes.error = `batchUpdate ${bRes.status}: ${(await bRes.text()).slice(0, 200)}`;
        }
      } catch (e: any) {
        tabRes.error = e.message;
      }
      sheetAudit.totals.matched += tabRes.matched;
      sheetAudit.totals.written += tabRes.written;
      sheetAudit.totals.skipped += tabRes.skipped.length;
      sheetAudit.tabs.push(tabRes);
    }
    audit.sheet = sheetAudit;

    return new Response(JSON.stringify({ success: true, audit }), { headers:{...corsHeaders,'Content-Type':'application/json'} });
  } catch (err: any) {
    console.error('[ENRICHMENT-TEST-RUN] error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers:{...corsHeaders,'Content-Type':'application/json'} });
  }
});