import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','tempmail.com','10minutemail.com','guerrillamail.com',
  'yopmail.com','trashmail.com','sharklasers.com','dispostable.com',
  'fakeinbox.com','getnada.com','maildrop.cc','throwawaymail.com',
]);
const ROLE_PREFIXES = ['info','admin','support','contact','sales','noreply','no-reply','test','example'];
const TEST_NAME_TOKENS = ['test','asdf','qwerty','aaaa','xxxxx','spam','dummy'];

function lower(v: any): string { return (v ?? '').toString().trim().toLowerCase(); }
function isEmailValid(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isPhoneValid(p: string) { const d = (p || '').replace(/\D/g, ''); return d.length >= 7 && d.length <= 15; }

function findColIndex(headers: string[], aliases: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = lower(headers[i]).replace(/[_\-]+/g, ' ');
    if (aliases.some(a => h.includes(a))) return i;
  }
  return -1;
}

function runDeterministicChecks(headers: string[], rows: any[][]) {
  const emailIdx = findColIndex(headers, ['email']);
  const phoneIdx = findColIndex(headers, ['phone','mobile','tel']);
  const nameIdx = findColIndex(headers, ['name','full name','first name']);
  const dateIdx = findColIndex(headers, ['date','created','timestamp','submitted']);

  const spamFlags: any[] = [];
  const qualityIssues: any[] = [];
  const emailSeen = new Map<string, number>();
  const phoneSeen = new Map<string, number>();
  let validLeadCount = 0;

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // 1-based + header
    const email = emailIdx >= 0 ? lower(row[emailIdx]) : '';
    const phone = phoneIdx >= 0 ? lower(row[phoneIdx]) : '';
    const name = nameIdx >= 0 ? lower(row[nameIdx]) : '';
    const dateVal = dateIdx >= 0 ? row[dateIdx] : null;

    // Quality: missing email/phone (project rule = both required)
    if (!email && !phone) {
      qualityIssues.push({ row: rowNum, type: 'missing_contact', detail: 'Email and phone both empty' });
    } else if (!email || !phone) {
      qualityIssues.push({ row: rowNum, type: 'incomplete_contact', detail: !email ? 'Missing email' : 'Missing phone' });
    } else {
      validLeadCount++;
    }

    if (email) {
      if (!isEmailValid(email)) {
        qualityIssues.push({ row: rowNum, type: 'invalid_email', detail: email });
      } else {
        const domain = email.split('@')[1] || '';
        const localPart = email.split('@')[0] || '';
        if (DISPOSABLE_DOMAINS.has(domain)) spamFlags.push({ row: rowNum, type: 'disposable_email', detail: email });
        if (ROLE_PREFIXES.some(p => localPart === p || localPart.startsWith(p + '+'))) spamFlags.push({ row: rowNum, type: 'role_email', detail: email });
      }
      emailSeen.set(email, (emailSeen.get(email) || 0) + 1);
    }
    if (phone) {
      if (!isPhoneValid(phone)) qualityIssues.push({ row: rowNum, type: 'invalid_phone', detail: phone });
      const norm = phone.replace(/\D/g, '');
      phoneSeen.set(norm, (phoneSeen.get(norm) || 0) + 1);
    }
    if (name && TEST_NAME_TOKENS.some(t => name.includes(t))) {
      spamFlags.push({ row: rowNum, type: 'test_name', detail: name });
    }
    if (dateVal) {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now() + 86400000) {
        qualityIssues.push({ row: rowNum, type: 'future_date', detail: String(dateVal) });
      }
    }
  });

  for (const [email, count] of emailSeen) {
    if (count > 1) spamFlags.push({ type: 'duplicate_email', detail: email, occurrences: count });
  }
  for (const [phone, count] of phoneSeen) {
    if (count > 1) spamFlags.push({ type: 'duplicate_phone', detail: phone, occurrences: count });
  }

  return { spamFlags, qualityIssues, validLeadCount, totalRows: rows.length };
}

async function runAccuracyCheck(supabase: any, clientId: string, sheetValidLeads: number) {
  // Compare sheet's valid lead count against DB lead count (last 90 days).
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { count } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('is_spam', false)
    .not('email', 'is', null)
    .not('phone', 'is', null)
    .gte('created_at', since);
  const dbLeads = count || 0;
  const delta = sheetValidLeads - dbLeads;
  const pct = dbLeads ? Math.abs(delta) / dbLeads * 100 : (sheetValidLeads ? 100 : 0);
  return {
    sheet_valid_leads: sheetValidLeads,
    db_valid_leads_90d: dbLeads,
    delta,
    delta_pct: Math.round(pct * 10) / 10,
    flagged: pct > 5,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { client_id, sheet_url, gid, scope = 'client', triggered_by } = body || {};

    let resolvedSheetUrl: string | null = sheet_url || null;
    let clientName = 'Master';
    if (client_id) {
      const { data: c } = await supabase.from('clients').select('id,name,kpi_google_sheet_url').eq('id', client_id).maybeSingle();
      if (c) { clientName = c.name; resolvedSheetUrl = resolvedSheetUrl || c.kpi_google_sheet_url; }
    }
    if (!resolvedSheetUrl && scope === 'master') {
      const { data: ag } = await supabase.from('agency_settings').select('master_google_sheet_url, master_default_gid').limit(1).maybeSingle();
      resolvedSheetUrl = ag?.master_google_sheet_url || null;
    }
    if (!resolvedSheetUrl) {
      return new Response(JSON.stringify({ error: 'No sheet URL configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const idMatch = resolvedSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) {
      return new Response(JSON.stringify({ error: 'Invalid sheet URL' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const sheetId = idMatch[1];

    // Fetch raw grid via fetch-sheet-metrics
    const fetchRes = await fetch(`${SUPABASE_URL}/functions/v1/fetch-sheet-metrics`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
      },
      body: JSON.stringify({ sheet_id: sheetId, gid, action: 'raw_grid' }),
    });
    const fetchText = await fetchRes.text();
    if (!fetchRes.ok) throw new Error(`raw_grid failed [${fetchRes.status}]: ${fetchText}`);
    const grid = JSON.parse(fetchText);
    const headers: string[] = (grid.headers || []).map((h: any) => String(h ?? ''));
    const rows: any[][] = grid.rows || [];

    const { spamFlags, qualityIssues, validLeadCount, totalRows } = runDeterministicChecks(headers, rows);

    let accuracy: any = null;
    if (client_id) {
      try { accuracy = await runAccuracyCheck(supabase, client_id, validLeadCount); } catch (e) { console.error('accuracy check failed', e); }
    }

    // Compute quality score (0-100): 100 minus weighted issue ratio
    const issueRatio = totalRows ? (spamFlags.length + qualityIssues.length) / totalRows : 0;
    let score = Math.max(0, Math.round(100 - issueRatio * 100));
    if (accuracy?.flagged) score = Math.max(0, score - 15);

    // AI summary
    let summary = '';
    let whatsappMessage = '';
    if (LOVABLE_API_KEY) {
      try {
        const findingsForAI = {
          client: clientName, sheet: grid.sheetTitle, total_rows: totalRows,
          valid_leads: validLeadCount, spam_count: spamFlags.length,
          quality_issue_count: qualityIssues.length,
          spam_examples: spamFlags.slice(0, 5),
          quality_examples: qualityIssues.slice(0, 5),
          accuracy,
          quality_score: score,
        };
        const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are AUDITOR, a Google Sheet QA agent. Return ONLY JSON with {summary, whatsapp_message}. summary = 2-3 sentence narrative; whatsapp_message = under 600 chars, plain text, includes top 3 issues + score, NO "guaranteed" language.' },
              { role: 'user', content: JSON.stringify(findingsForAI) },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
        });
        const aiJson = await aiRes.json();
        const content = aiJson?.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(content);
        summary = parsed.summary || '';
        whatsappMessage = parsed.whatsapp_message || '';
      } catch (e) { console.error('AI summary failed', e); }
    }

    if (!whatsappMessage) {
      whatsappMessage = `📊 ${clientName} sheet audit: score ${score}/100. ${spamFlags.length} spam, ${qualityIssues.length} quality issues across ${totalRows} rows.${accuracy?.flagged ? ` Accuracy delta ${accuracy.delta_pct}% vs DB.` : ''}`;
    }

    const findings = { spamFlags: spamFlags.slice(0, 100), qualityIssues: qualityIssues.slice(0, 100), accuracy, headers, total_rows: totalRows, valid_leads: validLeadCount };

    const { data: inserted } = await supabase.from('sheet_audit_runs').insert({
      client_id: client_id || null,
      scope,
      sheet_url: resolvedSheetUrl,
      tab_gid: gid ? String(gid) : null,
      quality_score: score,
      spam_count: spamFlags.length,
      quality_issue_count: qualityIssues.length,
      accuracy_delta_count: accuracy?.flagged ? 1 : 0,
      findings,
      summary,
      whatsapp_message: whatsappMessage,
      triggered_by: triggered_by || null,
    }).select('id').single();

    return new Response(JSON.stringify({
      success: true,
      audit_id: inserted?.id,
      quality_score: score,
      spam_count: spamFlags.length,
      quality_issue_count: qualityIssues.length,
      accuracy,
      summary,
      whatsapp_message: whatsappMessage,
      findings,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('agent-sheet-audit error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});