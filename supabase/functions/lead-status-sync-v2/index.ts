// lead-status-sync-v2 — v2 GHL lead-status sync API for agents & cron.
// Modes:
//   single  { mode:"single",  client_id, lead_id? | external_id? | email? | phone? }
//   batch   { mode:"batch",   client_id, lead_ids:[uuid] }  (max 100)
//   client  { mode:"client",  client_id, sinceHours?=24, limit?=200 }
//
// For each contact:
//   - GET  /contacts/{id}                       (custom fields, tags, status)
//   - GET  /contacts/{id}/appointments          (booked / showed)
//   - GET  /opportunities/search?contact_id=    (pipeline stage, monetary value)
// Writes to: leads, calls, pipeline_opportunities, funded_investors
// Then closes the loop with Meta attribution + daily-metrics recalc.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENCY_PIT = (Deno.env.get("AGENCY_GHL_PIT_TOKEN") || Deno.env.get("AGENCY_GHL_API_KEY") || "").trim();

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── GHL v2 helper: client PIT first, fall back to agency PIT on 401/403.
function makeGhl(clientToken: string | null | undefined) {
  const primary = (clientToken || "").trim();
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  });
  return async function ghl(url: string, init: RequestInit = {}): Promise<Response> {
    const tokens = [primary || AGENCY_PIT, AGENCY_PIT].filter((t, i, a) => t && a.indexOf(t) === i);
    let last: Response | null = null;
    for (const tok of tokens) {
      const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), ...headers(tok) } });
      if (res.status !== 401 && res.status !== 403) return res;
      last = res;
    }
    return last as Response;
  };
}

// ── Normalization helpers
function parseMoney(v: unknown): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extractFunded(contact: any, opps: any[]): { funded: number; commitment: number } {
  const tags: string[] = (contact?.tags || []).map((t: string) => String(t).toLowerCase());
  const cf: any[] = contact?.customFields || [];
  const byName = (re: RegExp) => cf.find((f: any) => re.test(String(f?.name || f?.key || "").toLowerCase()))?.value;
  const fundedTag = tags.some((t) => /(^|-|_)funded(-|_|$)|invested|closed[-_]?won/.test(t));
  const funded = parseMoney(byName(/funded|invested|wire[-_]?amount|deposit/) ?? (fundedTag ? 0 : null));
  const commitment = parseMoney(byName(/commit|pledge|soft[-_]?circle/));
  // Also credit opportunities in a "Closed Won" / "Funded" stage
  const oppFunded = (opps || []).reduce((sum, o) => {
    const s = String(o?.status || o?.pipelineStageName || "").toLowerCase();
    if (s.includes("won") || s.includes("funded")) return sum + parseMoney(o?.monetaryValue);
    return sum;
  }, 0);
  return { funded: Math.max(funded, oppFunded), commitment };
}

function pickAttribution(contact: any) {
  const cf: any[] = contact?.customFields || [];
  const byName = (re: RegExp) => cf.find((f: any) => re.test(String(f?.name || f?.key || "").toLowerCase()))?.value;
  return {
    utm_source: contact?.attributionSource?.utmSource || byName(/utm[-_ ]?source/) || null,
    utm_medium: contact?.attributionSource?.utmMedium || byName(/utm[-_ ]?medium/) || null,
    utm_campaign: contact?.attributionSource?.campaign || byName(/utm[-_ ]?campaign|campaign[-_ ]?name/) || null,
    utm_content: contact?.attributionSource?.utmContent || byName(/utm[-_ ]?content|ad[-_ ]?name/) || null,
    utm_term: contact?.attributionSource?.utmTerm || byName(/utm[-_ ]?term/) || null,
    ad_id: contact?.attributionSource?.adId || byName(/^ad[-_ ]?id$|meta[-_ ]?ad[-_ ]?id/) || null,
  };
}

// ── Attribution: try to match lead to Meta ad/adset/campaign
async function attributeToMeta(supa: any, clientId: string, lead: any) {
  // 1) Direct ad_id → meta_ads
  if (lead.ad_id) {
    const { data: ad } = await supa.from("meta_ads")
      .select("meta_ad_id,name,meta_adset_id,meta_campaign_id")
      .eq("client_id", clientId).eq("meta_ad_id", lead.ad_id).maybeSingle();
    if (ad) {
      const [set, camp] = await Promise.all([
        supa.from("meta_ad_sets").select("name").eq("meta_adset_id", ad.meta_adset_id).maybeSingle(),
        supa.from("meta_campaigns").select("name,meta_campaign_id").eq("meta_campaign_id", ad.meta_campaign_id).maybeSingle(),
      ]);
      return {
        meta_ad_id: ad.meta_ad_id, ad_name: ad.name,
        meta_adset_id: ad.meta_adset_id, adset_name: set.data?.name,
        meta_campaign_id: ad.meta_campaign_id, campaign_name: camp.data?.name,
      };
    }
  }
  // 2) UTM campaign name
  if (lead.utm_campaign) {
    const { data: camp } = await supa.from("meta_campaigns")
      .select("name,meta_campaign_id").eq("client_id", clientId)
      .ilike("name", `%${lead.utm_campaign}%`).limit(1).maybeSingle();
    if (camp) return { meta_campaign_id: camp.meta_campaign_id, campaign_name: camp.name };
  }
  return null;
}

// ── Sync one contact
async function syncOneContact(
  supa: any,
  client: { id: string; ghl_location_id: string; ghl_api_key: string | null },
  ghlContactId: string,
  lead: any | null,
) {
  const ghl = makeGhl(client.ghl_api_key);
  const [cRes, aRes, oRes] = await Promise.all([
    ghl(`${GHL_BASE}/contacts/${ghlContactId}`),
    ghl(`${GHL_BASE}/contacts/${ghlContactId}/appointments`),
    ghl(`${GHL_BASE}/opportunities/search?location_id=${client.ghl_location_id}&contact_id=${ghlContactId}&limit=100`),
  ]);
  if (!cRes.ok) {
    return { ok: false, error: `GHL /contacts ${cRes.status}: ${(await cRes.text()).slice(0, 200)}` };
  }
  const contact = (await cRes.json())?.contact || (await cRes.json());
  const appts = aRes.ok ? ((await aRes.json())?.events || (await aRes.json())?.appointments || []) : [];
  const opps = oRes.ok ? ((await oRes.json())?.opportunities || []) : [];

  const attr = pickAttribution(contact);
  const { funded, commitment } = extractFunded(contact, opps);
  const topOpp = opps[0] || null;

  // Upsert lead
  const leadPayload: any = {
    client_id: client.id,
    external_id: ghlContactId,
    source: lead?.source || "ghl",
    name: [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.name || lead?.name || null,
    email: contact.email || lead?.email || null,
    phone: contact.phone || lead?.phone || null,
    status: (contact.tags || []).length ? String(contact.tags[0]).toLowerCase() : (lead?.status || "new"),
    custom_fields: contact,
    opportunity_stage: topOpp?.pipelineStageName || topOpp?.status || null,
    opportunity_stage_id: topOpp?.pipelineStageId || null,
    opportunity_status: topOpp?.status || null,
    opportunity_value: parseMoney(topOpp?.monetaryValue),
    ghl_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(attr).filter(([, v]) => v != null)),
  };
  const { data: upsertedLead, error: leadErr } = await supa.from("leads")
    .upsert(leadPayload, { onConflict: "client_id,external_id" })
    .select("id,client_id,external_id,utm_campaign,ad_id,created_at").maybeSingle();
  if (leadErr) return { ok: false, error: `leads upsert: ${leadErr.message}` };

  // Upsert appointments → calls
  const callRows: any[] = [];
  for (const a of appts) {
    const started = a.startTime || a.startedAt || a.selectedTimezone && a.time;
    if (!started) continue;
    const status = String(a.appointmentStatus || a.status || "").toLowerCase();
    const showed = ["showed", "attended", "confirmed"].includes(status);
    callRows.push({
      client_id: client.id,
      lead_id: upsertedLead?.id || null,
      external_id: a.id,
      ghl_appointment_id: a.id,
      ghl_calendar_id: a.calendarId || null,
      appointment_status: status || null,
      scheduled_at: started,
      booked_at: a.createdAt || started,
      showed,
      showed_at: showed ? started : null,
      outcome: status || null,
      contact_name: contact.firstName ? `${contact.firstName} ${contact.lastName || ""}`.trim() : null,
      contact_email: contact.email || null,
      contact_phone: contact.phone || null,
      direction: "outbound",
      ghl_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  if (callRows.length) {
    await supa.from("calls").upsert(callRows, { onConflict: "client_id,external_id" });
  }

  // Upsert pipeline_opportunities (best-effort — only if pipeline row exists locally)
  if (opps.length) {
    const oppRows = opps.map((o: any) => ({
      ghl_opportunity_id: o.id,
      ghl_contact_id: ghlContactId,
      contact_name: o.contact?.name || contact.name || null,
      contact_email: o.contact?.email || contact.email || null,
      contact_phone: o.contact?.phone || contact.phone || null,
      monetary_value: parseMoney(o.monetaryValue),
      status: o.status || null,
      source: o.source || null,
    }));
    await supa.from("pipeline_opportunities").upsert(oppRows as any, { onConflict: "ghl_opportunity_id", ignoreDuplicates: false }).select().catch(() => null);
  }

  // Funded investor
  if (funded > 0 || commitment > 0) {
    const first = upsertedLead?.created_at || null;
    const days = first ? Math.max(0, Math.floor((Date.now() - new Date(first).getTime()) / 86400000)) : null;
    await supa.from("funded_investors").upsert({
      client_id: client.id,
      lead_id: upsertedLead?.id || null,
      external_id: ghlContactId,
      name: leadPayload.name,
      funded_amount: funded,
      commitment_amount: commitment,
      funded_at: new Date().toISOString(),
      first_contact_at: first,
      time_to_fund_days: days,
      source: "lead-status-sync-v2",
    }, { onConflict: "client_id,external_id" });
  }

  // Attribution
  const attribution = upsertedLead ? await attributeToMeta(supa, client.id, upsertedLead) : null;
  if (attribution?.campaign_name || attribution?.ad_name) {
    await supa.from("leads").update({
      campaign_name: attribution.campaign_name || null,
      ad_set_name: (attribution as any).adset_name || null,
      ad_id: (attribution as any).meta_ad_id || upsertedLead?.ad_id || null,
    }).eq("id", upsertedLead!.id);
  }

  return {
    ok: true,
    lead_id: upsertedLead?.id,
    external_id: ghlContactId,
    status: leadPayload.status,
    stage: leadPayload.opportunity_stage,
    booked_calls: callRows.length,
    showed_calls: callRows.filter((r) => r.showed).length,
    committed_amount: commitment,
    funded_amount: funded,
    attribution,
  };
}

// ── Resolve client + set of contact IDs to sync
async function resolveContactIds(
  supa: any,
  clientId: string,
  body: any,
): Promise<{ contactIds: string[]; leadsByExt: Map<string, any> }> {
  const contactIds = new Set<string>();
  const leadsByExt = new Map<string, any>();

  const load = async (query: any) => {
    const { data } = await query;
    for (const l of data || []) {
      if (l.external_id) { contactIds.add(l.external_id); leadsByExt.set(l.external_id, l); }
    }
  };

  const mode = body.mode || "single";
  if (mode === "single") {
    let q = supa.from("leads").select("*").eq("client_id", clientId).limit(1);
    if (body.lead_id) q = q.eq("id", body.lead_id);
    else if (body.external_id) q = q.eq("external_id", body.external_id);
    else if (body.email) q = q.eq("email", body.email);
    else if (body.phone) q = q.eq("phone", body.phone);
    else throw new Error("single mode requires lead_id | external_id | email | phone");
    await load(q);
  } else if (mode === "batch") {
    const ids = (body.lead_ids || []).slice(0, 100);
    if (!ids.length) throw new Error("batch mode requires lead_ids");
    await load(supa.from("leads").select("*").eq("client_id", clientId).in("id", ids));
  } else if (mode === "client") {
    const hours = Math.max(1, Math.min(720, Number(body.sinceHours) || 24));
    const limit = Math.min(500, Number(body.limit) || 200);
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    await load(
      supa.from("leads").select("*").eq("client_id", clientId)
        .or(`ghl_synced_at.is.null,ghl_synced_at.lt.${since}`)
        .order("ghl_synced_at", { ascending: true, nullsFirst: true }).limit(limit),
    );
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  return { contactIds: Array.from(contactIds), leadsByExt };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return j({ error: "invalid json" }, 400); }
  const clientId = body.client_id;
  if (!clientId) return j({ error: "client_id required" }, 400);

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: client, error: cErr } = await supa.from("clients")
    .select("id,name,ghl_api_key,ghl_location_id").eq("id", clientId).maybeSingle();
  if (cErr || !client) return j({ error: "client not found" }, 404);
  if (!client.ghl_location_id) return j({ error: "client missing ghl_location_id" }, 400);
  if (!client.ghl_api_key && !AGENCY_PIT) return j({ error: "no GHL v2 token available" }, 400);

  let contactIds: string[] = [];
  let leadsByExt = new Map<string, any>();
  try {
    const r = await resolveContactIds(supa, clientId, body);
    contactIds = r.contactIds; leadsByExt = r.leadsByExt;
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  if (!contactIds.length) return j({ ok: true, mode: body.mode, results: [], note: "no matching leads" });

  // Concurrency-limited fan-out (max 5 parallel)
  const results: any[] = [];
  const affectedDates = new Set<string>();
  const CHUNK = 5;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const settled = await Promise.all(slice.map((cid) =>
      syncOneContact(supa, client as any, cid, leadsByExt.get(cid) || null)
        .catch((e) => ({ ok: false, external_id: cid, error: e instanceof Error ? e.message : String(e) })),
    ));
    for (const r of settled) {
      results.push(r);
      affectedDates.add(new Date().toISOString().slice(0, 10));
    }
  }

  // Fire metrics recalc (background, non-blocking failures)
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/recalculate-daily-metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ clientId, days: 2 }),
    });
  } catch (e) {
    console.warn("[lead-status-sync-v2] metrics recalc failed", e);
  }

  const okCount = results.filter((r) => r.ok).length;
  return j({
    ok: true,
    mode: body.mode || "single",
    client_id: clientId,
    synced: okCount,
    failed: results.length - okCount,
    results,
  });
});
