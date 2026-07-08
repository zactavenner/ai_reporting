// Audit client accuracy — compares Meta + GHL source-of-truth vs our DB.
// Writes rows to client_audit_reports + client_audit_findings and optionally
// enqueues backfill syncs when variance exceeds thresholds.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_TOKEN = Deno.env.get("META_SHARED_ACCESS_TOKEN") || "";

const THRESHOLDS = { info: 2, warning: 5, failure: 10 }; // percent

type Finding = {
  category: string;
  metric: string;
  expected: number | null;
  actual: number | null;
  variance_pct: number | null;
  severity: "pass" | "info" | "warning" | "failure";
  message?: string;
  remediation_action?: string | null;
};

function severityFor(expected: number | null, actual: number | null): { sev: Finding["severity"]; pct: number | null } {
  if (expected === null || actual === null) return { sev: "info", pct: null };
  if (expected === 0 && actual === 0) return { sev: "pass", pct: 0 };
  const base = Math.max(Math.abs(expected), 1);
  const pct = Math.abs(expected - actual) / base * 100;
  let sev: Finding["severity"] = "pass";
  if (pct >= THRESHOLDS.failure) sev = "failure";
  else if (pct >= THRESHOLDS.warning) sev = "warning";
  else if (pct >= THRESHOLDS.info) sev = "info";
  return { sev, pct: Math.round(pct * 100) / 100 };
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, body: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, body: text }; }
}

// ---------- Meta ad stats ----------
async function auditMeta(sb: any, client: any, start: string, end: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const adAccountId = client.meta_ad_account_id;
  if (!adAccountId || !META_TOKEN) {
    findings.push({
      category: "ads", metric: "config", expected: null, actual: null, variance_pct: null,
      severity: "info", message: "Meta ad account or token not configured",
    });
    return findings;
  }
  const url = new URL(`https://graph.facebook.com/v20.0/act_${adAccountId}/insights`);
  url.searchParams.set("time_range", JSON.stringify({ since: start, until: end }));
  url.searchParams.set("fields", "spend,impressions,clicks,actions");
  url.searchParams.set("level", "account");
  url.searchParams.set("access_token", META_TOKEN);
  const r = await fetchJson(url.toString());
  if (!r.ok) {
    findings.push({ category: "ads", metric: "api", expected: null, actual: null, variance_pct: null, severity: "failure", message: `Meta API error: ${JSON.stringify(r.body).slice(0, 200)}` });
    return findings;
  }
  const row = r.body?.data?.[0] || {};
  const metaSpend = Number(row.spend || 0);
  const metaImpr = Number(row.impressions || 0);
  const metaClicks = Number(row.clicks || 0);
  const metaLeads = Number((row.actions || []).find((a: any) => a.action_type === "lead")?.value || 0);

  const { data: db } = await sb
    .from("meta_ad_daily_insights")
    .select("spend,impressions,clicks,leads")
    .eq("client_id", client.id)
    .gte("date", start)
    .lte("date", end);
  const dbSpend = (db || []).reduce((s: number, r: any) => s + Number(r.spend || 0), 0);
  const dbImpr = (db || []).reduce((s: number, r: any) => s + Number(r.impressions || 0), 0);
  const dbClicks = (db || []).reduce((s: number, r: any) => s + Number(r.clicks || 0), 0);
  const dbLeads = (db || []).reduce((s: number, r: any) => s + Number(r.leads || 0), 0);

  const push = (metric: string, exp: number, act: number) => {
    const { sev, pct } = severityFor(exp, act);
    findings.push({
      category: "ads", metric, expected: exp, actual: act, variance_pct: pct, severity: sev,
      remediation_action: sev === "warning" || sev === "failure" ? "sync-meta-ad-daily-insights" : null,
    });
  };
  push("spend", metaSpend, dbSpend);
  push("impressions", metaImpr, dbImpr);
  push("clicks", metaClicks, dbClicks);
  push("leads_meta", metaLeads, dbLeads);
  return findings;
}

// ---------- GHL contacts / leads ----------
async function ghlHeaders(client: any) {
  return {
    Authorization: `Bearer ${client.ghl_api_key}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

async function auditLeads(sb: any, client: any, start: string, end: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  if (!client.ghl_api_key || !client.ghl_location_id) {
    findings.push({ category: "leads", metric: "config", expected: null, actual: null, variance_pct: null, severity: "info", message: "GHL not configured" });
    return findings;
  }
  // Count leads in DB
  const { count: dbLeadCount } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .gte("created_at", `${start}T00:00:00Z`)
    .lte("created_at", `${end}T23:59:59Z`);

  // Query GHL contacts count via search endpoint
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T23:59:59Z`).getTime();
  const r = await fetchJson("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: await ghlHeaders(client),
    body: JSON.stringify({
      locationId: client.ghl_location_id,
      pageLimit: 1,
      filters: [{ field: "dateAdded", operator: "range", value: { gte: startMs, lte: endMs } }],
    }),
  });
  const ghlLeadCount = r.ok ? Number(r.body?.total || 0) : null;
  const { sev, pct } = ghlLeadCount === null ? { sev: "info" as const, pct: null } : severityFor(ghlLeadCount, dbLeadCount || 0);
  findings.push({
    category: "leads", metric: "count", expected: ghlLeadCount, actual: dbLeadCount || 0, variance_pct: pct, severity: sev,
    message: ghlLeadCount === null ? `GHL error: ${JSON.stringify(r.body).slice(0, 200)}` : undefined,
    remediation_action: sev === "warning" || sev === "failure" ? "sync-ghl-contacts" : null,
  });

  // Enrichment coverage
  const { count: enrichedCount } = await sb
    .from("lead_enrichment")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id);
  const { count: totalLeadCount } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id);
  const coverage = totalLeadCount ? Math.round(((enrichedCount || 0) / totalLeadCount) * 10000) / 100 : 0;
  findings.push({
    category: "leads", metric: "enrichment_coverage_pct", expected: 100, actual: coverage,
    variance_pct: 100 - coverage, severity: coverage >= 90 ? "pass" : coverage >= 75 ? "info" : coverage >= 50 ? "warning" : "failure",
    remediation_action: coverage < 75 ? "bulk-enrich-account" : null,
  });
  return findings;
}

// ---------- Calls + showed ----------
async function auditCalls(sb: any, client: any, start: string, end: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { count: totalCalls } = await sb
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .gte("booked_at", `${start}T00:00:00Z`)
    .lte("booked_at", `${end}T23:59:59Z`);
  const { count: showedCalls } = await sb
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .eq("showed", true)
    .gte("booked_at", `${start}T00:00:00Z`)
    .lte("booked_at", `${end}T23:59:59Z`);

  // Basic presence check — full GHL calendar reconciliation delegated to sync-calendar-appointments
  findings.push({ category: "calls", metric: "booked_calls", expected: null, actual: totalCalls || 0, variance_pct: null, severity: "pass" });
  findings.push({ category: "calls", metric: "showed_calls", expected: null, actual: showedCalls || 0, variance_pct: null, severity: "pass" });
  if ((totalCalls || 0) === 0) {
    findings.push({ category: "calls", metric: "no_calls_recorded", expected: null, actual: 0, variance_pct: null, severity: "warning", message: "No calls in window — verify calendar mappings", remediation_action: "sync-calendar-appointments" });
  }
  return findings;
}

// ---------- Dispositions ----------
async function auditDispositions(sb: any, client: any, start: string, end: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { data: leads } = await sb
    .from("leads")
    .select("current_disposition")
    .eq("client_id", client.id)
    .gte("created_at", `${start}T00:00:00Z`)
    .lte("created_at", `${end}T23:59:59Z`);
  const total = (leads || []).length;
  const withDisp = (leads || []).filter((l: any) => l.current_disposition).length;
  const coverage = total ? Math.round((withDisp / total) * 10000) / 100 : 0;
  findings.push({
    category: "dispositions", metric: "coverage_pct", expected: total > 0 ? 60 : null, actual: coverage,
    variance_pct: null,
    severity: total === 0 ? "info" : coverage >= 60 ? "pass" : coverage >= 30 ? "warning" : "failure",
    remediation_action: coverage < 60 && total > 0 ? "sync-lead-dispositions" : null,
  });
  return findings;
}

// ---------- Committed / Funded ----------
async function auditFunded(sb: any, client: any, start: string, end: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { data: funded } = await sb
    .from("funded_investors")
    .select("funded_amount,commitment_amount")
    .eq("client_id", client.id)
    .gte("funded_at", `${start}T00:00:00Z`)
    .lte("funded_at", `${end}T23:59:59Z`);
  const fundedTotal = (funded || []).reduce((s: number, r: any) => s + Number(r.funded_amount || 0), 0);
  const committedTotal = (funded || []).reduce((s: number, r: any) => s + Number(r.commitment_amount || 0), 0);
  findings.push({ category: "funded", metric: "funded_dollars", expected: null, actual: fundedTotal, variance_pct: null, severity: "pass" });
  findings.push({ category: "funded", metric: "committed_dollars", expected: null, actual: committedTotal, variance_pct: null, severity: "pass" });
  const { data: pipeline } = await sb
    .from("pipeline_opportunities")
    .select("monetary_value,stage_name")
    .eq("client_id", client.id);
  const pipelineTotal = (pipeline || []).reduce((s: number, r: any) => s + Number(r.monetary_value || 0), 0);
  findings.push({ category: "funded", metric: "pipeline_open_dollars", expected: null, actual: pipelineTotal, variance_pct: null, severity: "pass" });
  return findings;
}

// ---------- Auto remediation ----------
async function triggerRemediations(sb: any, client: any, actions: Set<string>, start: string, end: string) {
  const dispatched: string[] = [];
  for (const fn of actions) {
    try {
      const body: any = { client_id: client.id, clientId: client.id, start_date: start, end_date: end };
      // fire and forget
      fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify(body),
      }).catch(() => {});
      dispatched.push(fn);
    } catch (_) {}
  }
  return dispatched;
}

async function auditOneClient(sb: any, client: any, cadence: string, start: string, end: string, autoRemediate: boolean) {
  const { data: report } = await sb
    .from("client_audit_reports")
    .insert({ client_id: client.id, cadence, window_start: start, window_end: end, status: "running" })
    .select().single();

  const findings: Finding[] = [];
  try {
    findings.push(...await auditMeta(sb, client, start, end));
    findings.push(...await auditLeads(sb, client, start, end));
    findings.push(...await auditCalls(sb, client, start, end));
    findings.push(...await auditDispositions(sb, client, start, end));
    findings.push(...await auditFunded(sb, client, start, end));
  } catch (e) {
    await sb.from("client_audit_reports").update({ status: "failed", error: String(e) }).eq("id", report.id);
    return { report_id: report.id, error: String(e) };
  }

  const rows = findings.map((f) => ({ ...f, report_id: report.id, client_id: client.id }));
  if (rows.length) await sb.from("client_audit_findings").insert(rows);

  const passed = findings.filter((f) => f.severity === "pass" || f.severity === "info").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const failures = findings.filter((f) => f.severity === "failure").length;

  const remediations = new Set<string>();
  if (autoRemediate) {
    for (const f of findings) {
      if ((f.severity === "warning" || f.severity === "failure") && f.remediation_action) {
        remediations.add(f.remediation_action);
      }
    }
  }
  const dispatched = remediations.size ? await triggerRemediations(sb, client, remediations, start, end) : [];

  await sb.from("client_audit_reports").update({
    status: "completed",
    total_checks: findings.length,
    passed, warnings, failures,
    summary: { dispatched, categories: [...new Set(findings.map((f) => f.category))] },
  }).eq("id", report.id);

  return { report_id: report.id, total: findings.length, passed, warnings, failures, dispatched };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const cadence = body.cadence || "manual";
  const autoRemediate = body.auto_remediate !== false;

  const end = body.end_date || ymd(new Date());
  const defaultDays = cadence === "monthly" ? 30 : cadence === "weekly" ? 7 : 2;
  const start = body.start_date || ymd(new Date(Date.now() - defaultDays * 86400000));

  let q = sb.from("clients").select("id,name,ghl_api_key,ghl_location_id,meta_ad_account_id,status").eq("status", "active");
  if (body.client_id) q = q.eq("id", body.client_id);
  const { data: clients } = await q;
  if (!clients?.length) return new Response(JSON.stringify({ error: "no clients" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results: any[] = [];
  for (const c of clients) {
    try { results.push({ client_id: c.id, name: c.name, ...(await auditOneClient(sb, c, cadence, start, end, autoRemediate)) }); }
    catch (e) { results.push({ client_id: c.id, name: c.name, error: String(e) }); }
  }
  return new Response(JSON.stringify({ success: true, cadence, window: { start, end }, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});