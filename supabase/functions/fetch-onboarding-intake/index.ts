const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';
const SHEET_ID = '1vuD4QA45XuVgRw1SKgq2nlRWJTIjwj4X6avyED5DpKU';
const TAB_NAME = 'CRA Onboarding';
const RANGE = `${TAB_NAME}!A1:AN200`;

// Columns we never want to surface (sensitive billing data)
const HIDDEN_HEADERS = new Set([
  'name on card',
  'credit card number',
  'valid thru date',
  'security code',
]);

// Group definitions for nicer presentation
const GROUPS: { label: string; matchers: (h: string) => boolean }[] = [
  { label: 'Company', matchers: (h) => /company|name$|email|phone|website|address|business type|ein/i.test(h) },
  { label: 'Offer & Strategy', matchers: (h) => /offer|industry|outcome|distribution|investor|return|hold period|investment range|credibility|due diligence|pitch deck|drive|dropbox|additional information|customers/i.test(h) },
  { label: 'Operations & Access', matchers: (h) => /gohighlevel|domain|pixel/i.test(h) },
  { label: 'Budget', matchers: (h) => /ad budget|monthly/i.test(h) },
];

function groupFor(header: string): string {
  for (const g of GROUPS) if (g.matchers(header)) return g.label;
  return 'Other';
}

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[,.]/g, ' ')
    .replace(/\b(llc|inc|lp|llp|ltd|co|corp|company|holdings|group|capital|fund|funds|partners|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1000;
  if (na.includes(nb) || nb.includes(na)) return 500;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  let shared = 0;
  ta.forEach((t) => { if (tb.has(t)) shared++; });
  if (shared === 0) return 0;
  return Math.round((shared / Math.max(ta.size, tb.size)) * 100);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { client_name, client_id } = await req.json().catch(() => ({}));

    let nameToMatch: string | null = (client_name || '').toString().trim() || null;

    // Look up client name from Supabase if only id supplied
    if (!nameToMatch && client_id) {
      const supaUrl = Deno.env.get('SUPABASE_URL')!;
      const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const r = await fetch(`${supaUrl}/rest/v1/clients?id=eq.${client_id}&select=name`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
      });
      const rows = await r.json();
      nameToMatch = rows?.[0]?.name ?? null;
    }

    if (!nameToMatch) {
      return new Response(JSON.stringify({ matched: false, reason: 'no_client_name' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_SHEETS_API_KEY = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!LOVABLE_API_KEY || !GOOGLE_SHEETS_API_KEY) {
      return new Response(JSON.stringify({ error: 'Google Sheets connector not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = `${GATEWAY_URL}/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB_NAME)}!A1:AN200`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
      },
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Sheets API ${resp.status}: ${txt}`);
    }
    const data = await resp.json();
    const values: string[][] = data.values || [];
    if (values.length < 2) {
      return new Response(JSON.stringify({ matched: false, reason: 'empty_sheet' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const headers = values[0];
    const rows = values.slice(1);

    // Find best matching row by company name (column index 1)
    let best: { row: string[]; score: number; sheetName: string } | null = null;
    for (const row of rows) {
      const sheetName = (row[1] || '').trim();
      if (!sheetName) continue;
      const s = scoreMatch(nameToMatch, sheetName);
      if (s > 0 && (!best || s > best.score)) best = { row, score: s, sheetName };
    }

    if (!best || best.score < 30) {
      return new Response(JSON.stringify({
        matched: false, reason: 'no_row_match', client_name: nameToMatch,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Group fields
    type Field = { label: string; value: string; group: string };
    const fields: Field[] = [];
    headers.forEach((h, i) => {
      const label = (h || '').trim();
      if (!label) return;
      if (HIDDEN_HEADERS.has(label.toLowerCase())) return;
      const value = (best!.row[i] || '').toString().trim();
      if (!value) return;
      fields.push({ label, value, group: groupFor(label) });
    });

    return new Response(JSON.stringify({
      matched: true,
      client_name: nameToMatch,
      matched_company: best.sheetName,
      match_score: best.score,
      fields,
      source: 'CRA Onboarding',
      fetched_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('fetch-onboarding-intake error', err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});