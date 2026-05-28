import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';

// Columns we append to the right of each matched row.
const RIQ_HEADERS = [
  'RIQ Net Worth',
  'RIQ HH Income',
  'RIQ Discretionary Income',
  'RIQ Home Value',
  'RIQ Home Ownership',
  'RIQ Credit Range',
  'RIQ Age',
  'RIQ Marital Status',
  'RIQ Education',
  'RIQ Occupation',
  'RIQ Company',
  'RIQ Title',
  'RIQ LinkedIn',
  'RIQ City',
  'RIQ State',
  'RIQ Investor',
  'RIQ Enriched At',
];

function extractSheetId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function normPhone(p: any): string {
  return String(p || '').replace(/\D/g, '').slice(-10);
}
function normEmail(e: any): string {
  return String(e || '').trim().toLowerCase();
}

function colLetter(n: number): string {
  // 1 -> A
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeRange(title: string): string {
  return title.includes("'") ? title.replace(/'/g, "''") : title;
}

function fmtVal(v: any): string {
  if (v === null || v === undefined || v === '') return '';
  return String(v);
}

function rowValues(enr: any): string[] {
  return [
    fmtVal(enr.net_worth),
    fmtVal(enr.household_income),
    fmtVal(enr.discretionary_income),
    enr.home_value ? `$${Number(enr.home_value).toLocaleString()}` : '',
    fmtVal(enr.home_ownership),
    fmtVal(enr.credit_range),
    fmtVal(enr.age),
    fmtVal(enr.marital_status),
    fmtVal(enr.education),
    fmtVal(enr.occupation),
    fmtVal(enr.company_name),
    fmtVal(enr.company_title),
    fmtVal(enr.linkedin_url),
    fmtVal(enr.city),
    fmtVal(enr.state),
    enr.is_investor ? 'Yes' : '',
    enr.enriched_at ? new Date(enr.enriched_at).toISOString().slice(0, 10) : '',
  ];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const onlyClientId: string | undefined = body.client_id;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_SHEETS_API_KEY = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!LOVABLE_API_KEY || !GOOGLE_SHEETS_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'Google Sheets connector not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const sheetHeaders = {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
    };

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Eligible clients: auto-enrich ON + slug set
    const settingsQ = supabase
      .from('client_settings')
      .select('client_id, retargetiq_auto_enrich, retargetiq_website_slug, kpi_google_sheet_url')
      .eq('retargetiq_auto_enrich', true)
      .not('retargetiq_website_slug', 'is', null);
    const { data: settings, error: sErr } = await settingsQ;
    if (sErr) throw sErr;

    let ids = (settings || []).map(s => s.client_id);
    if (onlyClientId) ids = ids.filter(i => i === onlyClientId);
    if (ids.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No eligible clients', processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, status')
      .in('id', ids)
      .in('status', ['active', 'onboarding', 'paused']);

    const sheetUrlByClient = new Map<string, string | null>(
      (settings || []).map((s: any) => [s.client_id, s.kpi_google_sheet_url || null])
    );

    const results: any[] = [];

    for (const c of (clients || [])) {
      const sheetId = extractSheetId(sheetUrlByClient.get(c.id) || null);
      if (!sheetId) {
        results.push({ client: c.name, skipped: 'no_sheet' });
        continue;
      }

      // Pull all enrichment for this client (most recent ~5000)
      const { data: enrichments } = await supabase
        .from('lead_enrichment')
        .select('external_id, enriched_at, net_worth, household_income, discretionary_income, home_value, home_ownership, credit_range, age, marital_status, education, occupation, company_name, company_title, linkedin_url, city, state, is_investor')
        .eq('client_id', c.id)
        .order('enriched_at', { ascending: false })
        .limit(5000);

      if (!enrichments || enrichments.length === 0) {
        results.push({ client: c.name, skipped: 'no_enrichments' });
        continue;
      }

      // Index enrichments by associated lead email/phone (need leads table for contact info)
      const externalIds = enrichments.map(e => e.external_id).filter(Boolean);
      const { data: leads } = await supabase
        .from('leads')
        .select('external_id, email, phone')
        .eq('client_id', c.id)
        .in('external_id', externalIds);

      const enrByExt = new Map(enrichments.map(e => [e.external_id, e]));
      const enrByEmail = new Map<string, any>();
      const enrByPhone = new Map<string, any>();
      for (const l of (leads || [])) {
        const enr = enrByExt.get(l.external_id);
        if (!enr) continue;
        const e = normEmail(l.email);
        const p = normPhone(l.phone);
        if (e) enrByEmail.set(e, enr);
        if (p && p.length === 10) enrByPhone.set(p, enr);
      }

      if (enrByEmail.size === 0 && enrByPhone.size === 0) {
        results.push({ client: c.name, skipped: 'no_lead_contact_info' });
        continue;
      }

      // List tabs
      const metaRes = await fetch(
        `${GATEWAY_URL}/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title))`,
        { headers: sheetHeaders },
      );
      if (!metaRes.ok) {
        const t = await metaRes.text();
        results.push({ client: c.name, error: `meta ${metaRes.status}: ${t.slice(0, 120)}` });
        continue;
      }
      const meta = await metaRes.json();
      const tabs: { title: string }[] = (meta?.sheets || []).map((s: any) => ({ title: s?.properties?.title || '' })).filter((t: any) => t.title);

      let totalMatched = 0;
      let totalWritten = 0;
      const tabResults: any[] = [];

      for (const tab of tabs) {
        try {
          const range = `'${escapeRange(tab.title)}'!A1:ZZ5000`;
          const valRes = await fetch(`${GATEWAY_URL}/spreadsheets/${sheetId}/values/${range}`, { headers: sheetHeaders });
          if (!valRes.ok) continue;
          const valJson = await valRes.json();
          const rows: string[][] = valJson.values || [];
          if (rows.length < 2) continue;

          const headerRow = rows[0].map(h => String(h || '').trim());
          const headerLower = headerRow.map(h => h.toLowerCase());

          // Find email/phone columns (heuristic)
          const emailIdx = headerLower.findIndex(h => /\bemail\b|e-?mail/.test(h));
          const phoneIdx = headerLower.findIndex(h => /\bphone\b|mobile|cell/.test(h));
          if (emailIdx < 0 && phoneIdx < 0) continue;

          // Determine where to write enrichment cols.
          // If header row already contains "RIQ Net Worth", reuse that start; else append after current width.
          let riqStart = headerLower.indexOf('riq net worth');
          const writeRequests: { range: string; values: string[][] }[] = [];

          if (riqStart < 0) {
            riqStart = headerRow.length; // 0-based index where RIQ block begins
            const headerRange = `'${escapeRange(tab.title)}'!${colLetter(riqStart + 1)}1:${colLetter(riqStart + RIQ_HEADERS.length)}1`;
            writeRequests.push({ range: headerRange, values: [RIQ_HEADERS] });
          }

          let matchedInTab = 0;
          // Iterate data rows
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;
            const e = emailIdx >= 0 ? normEmail(row[emailIdx]) : '';
            const p = phoneIdx >= 0 ? normPhone(row[phoneIdx]) : '';
            let enr: any = null;
            if (e && enrByEmail.has(e)) enr = enrByEmail.get(e);
            else if (p && p.length === 10 && enrByPhone.has(p)) enr = enrByPhone.get(p);
            if (!enr) continue;

            // Skip if RIQ Enriched At already filled with same date (avoid rewrites)
            const existingEnrichedAt = row[riqStart + RIQ_HEADERS.length - 1];
            const todayStr = enr.enriched_at ? new Date(enr.enriched_at).toISOString().slice(0, 10) : '';
            if (existingEnrichedAt && existingEnrichedAt === todayStr) continue;

            matchedInTab++;
            const rowNum = i + 1;
            const rng = `'${escapeRange(tab.title)}'!${colLetter(riqStart + 1)}${rowNum}:${colLetter(riqStart + RIQ_HEADERS.length)}${rowNum}`;
            writeRequests.push({ range: rng, values: [rowValues(enr)] });
          }

          totalMatched += matchedInTab;

          if (writeRequests.length === 0) continue;

          // Batch update (up to ~500 ranges per call to stay under quota)
          const CHUNK = 400;
          for (let i = 0; i < writeRequests.length; i += CHUNK) {
            const chunk = writeRequests.slice(i, i + CHUNK);
            const bRes = await fetch(`${GATEWAY_URL}/spreadsheets/${sheetId}/values:batchUpdate`, {
              method: 'POST',
              headers: { ...sheetHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: chunk }),
            });
            if (!bRes.ok) {
              const t = await bRes.text();
              console.error(`[SHEET-WRITEBACK] ${c.name} / ${tab.title} batchUpdate ${bRes.status}: ${t.slice(0, 200)}`);
              break;
            }
            totalWritten += chunk.length;
            await new Promise(r => setTimeout(r, 250));
          }

          tabResults.push({ tab: tab.title, matched: matchedInTab });
        } catch (tabErr) {
          console.error(`[SHEET-WRITEBACK] tab error ${c.name}/${tab.title}:`, tabErr);
        }
      }

      results.push({ client: c.name, sheet_id: sheetId, matched: totalMatched, written: totalWritten, tabs: tabResults });
      console.log(`[SHEET-WRITEBACK] ${c.name}: ${totalMatched} matched, ${totalWritten} writes`);
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[SHEET-WRITEBACK] error:', err);
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});