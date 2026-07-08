import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const META_GRAPH_API_VERSION = "v21.0";
const META_GRAPH_API_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

interface MetaApiResponse {
  data?: any[];
  paging?: { next?: string };
  error?: { message: string; type: string; code: number };
  [key: string]: any; // for non-array responses like timezone lookup
}

// ── Strict Meta API call budget ──
const META_API_CALL_LIMIT = 190;
let metaApiCallCount = 0;

function checkCallBudget(label: string) {
  if (metaApiCallCount >= META_API_CALL_LIMIT) {
    throw new Error(`Meta API call budget exhausted (${META_API_CALL_LIMIT} calls). Stopped before: ${label}`);
  }
}

// ── API call logging ──
let _supabaseForLogging: any = null;
let _clientIdForLogging: string | null = null;

async function logMetaApiCall(
  endpoint: string,
  params: Record<string, any> | null,
  startedAt: number,
  statusCode: number,
  responseSummary: Record<string, any> | null,
  error: string | null,
) {
  if (!_supabaseForLogging) return;
  try {
    const durationMs = Date.now() - startedAt;
    await _supabaseForLogging.from("meta_api_calls").insert({
      client_id: _clientIdForLogging,
      endpoint,
      params: params || {},
      started_at: new Date(startedAt).toISOString(),
      duration_ms: durationMs,
      status_code: statusCode,
      response_summary: responseSummary,
      error,
    });
  } catch (logErr) {
    console.warn("Failed to log Meta API call:", logErr);
  }
}

async function fetchMeta(url: string, accessToken: string, label = "unknown"): Promise<MetaApiResponse> {
  checkCallBudget(label);
  metaApiCallCount++;
  console.log(`Meta API call #${metaApiCallCount}/${META_API_CALL_LIMIT}: ${label}`);

  const separator = url.includes("?") ? "&" : "?";
  const fullUrl = `${url}${separator}access_token=${accessToken}`;
  const startedAt = Date.now();

  // Extract endpoint for logging (strip access token)
  const endpointForLog = url.replace(META_GRAPH_API_URL, "").split("?")[0];
  const paramsForLog = Object.fromEntries(new URL(fullUrl).searchParams.entries());
  delete paramsForLog.access_token; // never log tokens

  let statusCode = 0;
  try {
    const res = await fetch(fullUrl);
    statusCode = res.status;
    if (!res.ok) {
      const errBody = await res.text();
      await logMetaApiCall(endpointForLog, paramsForLog, startedAt, statusCode, null, errBody.substring(0, 500));
      throw new Error(`Meta API ${res.status}: ${errBody.substring(0, 500)}`);
    }
    const json = await res.json();
    const summary = { data_count: Array.isArray(json.data) ? json.data.length : null, has_paging: !!json.paging?.next };
    await logMetaApiCall(endpointForLog, paramsForLog, startedAt, statusCode, summary, null);
    return json;
  } catch (err) {
    if (statusCode === 0) {
      await logMetaApiCall(endpointForLog, paramsForLog, startedAt, 0, null, err instanceof Error ? err.message : "Unknown fetch error");
    }
    throw err;
  }
}

async function fetchAllPages(url: string, accessToken: string, limit = 100, label = "unknown"): Promise<any[]> {
  const all: any[] = [];
  let nextUrl: string | undefined = `${url}&limit=${limit}`;
  let page = 0;
  while (nextUrl) {
    page++;
    const res = await fetchMeta(nextUrl, accessToken, `${label} page ${page}`);
    if (res.error) throw new Error(res.error.message);
    if (res.data) all.push(...res.data);
    nextUrl = res.paging?.next;
    if (all.length > 1000) break;
    if (metaApiCallCount >= META_API_CALL_LIMIT - 5) {
      console.warn(`Stopping pagination for ${label} - nearing API budget`);
      break;
    }
  }
  return all;
}

// ── Adaptive insights fetcher ──
// Wraps an insights URL builder and auto-shrinks the date window when Meta
// returns the "Please reduce the amount of data you're asking for" error
// (code:1 / HTTP 500) or rate-limits us. Always respects the global call budget.
async function fetchInsightsAdaptive(
  builder: (since: string, until: string) => string,
  accessToken: string,
  startDate: string,
  endDate: string,
  label: string,
  initialChunkDays = 14,
  minChunkDays = 1,
  pageLimit = 50,
): Promise<any[]> {
  const out: any[] = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  let chunkDays = initialChunkDays;

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    const since = cursor.toISOString().split("T")[0];
    const until = chunkEnd.toISOString().split("T")[0];

    try {
      const url = builder(since, until);
      const rows = await fetchAllPages(url, accessToken, pageLimit, `${label} ${since}→${until}`);
      out.push(...rows);
      // success → advance cursor; gently grow back toward initial size
      cursor.setUTCDate(cursor.getUTCDate() + chunkDays);
      if (chunkDays < initialChunkDays) chunkDays = Math.min(initialChunkDays, chunkDays * 2);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTooMuch = /reduce the amount of data|code"?:\s*1\b|"code":1/i.test(msg);
      const isRateLimit = /\(#(4|17|32|613|80000|80001|80002|80003|80004|80008|80014)\)|2446079/.test(msg);
      if ((isTooMuch || isRateLimit) && chunkDays > minChunkDays) {
        const next = Math.max(minChunkDays, Math.floor(chunkDays / 2));
        console.warn(`[insights] ${label} ${since}→${until} hit ${isTooMuch ? "data cap" : "rate limit"}; shrinking ${chunkDays}d → ${next}d`);
        chunkDays = next;
        if (isRateLimit) await new Promise((r) => setTimeout(r, 3000));
        continue; // retry same cursor with smaller chunk
      }
      console.warn(`[insights] ${label} ${since}→${until} failed, skipping chunk:`, msg.slice(0, 200));
      cursor.setUTCDate(cursor.getUTCDate() + chunkDays); // skip & continue so one bad window doesn't kill the run
    }
  }
  return out;
}

// Resolve a usable since/until pair (same defaults as getTimeRange) for the adaptive fetcher.
function resolveDateRange(startDate?: string, endDate?: string, tz?: string): { since: string; until: string } {
  const until = endDate || (tz ? getDateInTimezone(tz) : new Date().toISOString().split("T")[0]);
  const since = startDate || (tz ? getDateInTimezone(tz, -30) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
  return { since, until };
}

// ── Timezone helper with 24h cache ──
const tzCache = new Map<string, { tz: string; fetchedAt: number }>();

async function getAdAccountTimezone(adAccountId: string, accessToken: string, supabase: any): Promise<string> {
  const cacheKey = adAccountId;
  const cached = tzCache.get(cacheKey);
  const now = Date.now();

  // In-memory cache hit (24h)
  if (cached && now - cached.fetchedAt < 24 * 60 * 60 * 1000) {
    return cached.tz;
  }

  // Check DB cache
  const { data: dbRow } = await supabase
    .from("meta_ad_accounts")
    .select("timezone_name, account_name, last_seen_at")
    .eq("ad_account_id", adAccountId)
    .maybeSingle();

  if (dbRow && dbRow.last_seen_at) {
    const dbAge = now - new Date(dbRow.last_seen_at).getTime();
    if (dbAge < 24 * 60 * 60 * 1000) {
      tzCache.set(cacheKey, { tz: dbRow.timezone_name, fetchedAt: now });
      console.log(`Timezone for ${adAccountId}: ${dbRow.timezone_name} (DB cache)`);
      return dbRow.timezone_name;
    }
  }

  // Fetch from Meta Graph API
  console.log(`Fetching timezone for ${adAccountId} from Meta API...`);
  const res = await fetchMeta(
    `${META_GRAPH_API_URL}/${adAccountId}?fields=timezone_name,name`,
    accessToken,
    "ad-account-timezone"
  );

  const tz = res.timezone_name || "America/New_York";
  const accountName = res.name || null;
  console.log(`Timezone for ${adAccountId}: ${tz} (API)`);

  // Upsert to DB
  await supabase.from("meta_ad_accounts").upsert(
    { ad_account_id: adAccountId, timezone_name: tz, account_name: accountName, last_seen_at: new Date().toISOString() },
    { onConflict: "ad_account_id" }
  );

  tzCache.set(cacheKey, { tz, fetchedAt: now });
  return tz;
}

// ── Timezone-aware date helpers ──
// Get "yesterday" in a given IANA timezone without external deps
function getDateInTimezone(tz: string, offsetDays = 0): string {
  // Use Intl to format a date in the target timezone
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA gives YYYY-MM-DD
}

function getTimeRange(startDate?: string, endDate?: string, tz?: string): string {
  const until = endDate || (tz ? getDateInTimezone(tz) : new Date().toISOString().split("T")[0]);
  const since = startDate || (tz ? getDateInTimezone(tz, -30) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
  return `time_range={"since":"${since}","until":"${until}"}`;
}

function getDateChunks(startDate?: string, endDate?: string, chunkDays = 7, tz?: string): Array<{ since: string; until: string }> {
  const until = endDate || (tz ? getDateInTimezone(tz) : new Date().toISOString().split("T")[0]);
  const since = startDate || (tz ? getDateInTimezone(tz, -30) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);
  const chunks: Array<{ since: string; until: string }> = [];
  let cursor = new Date(since);
  const end = new Date(until);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push({
      since: cursor.toISOString().split("T")[0],
      until: chunkEnd.toISOString().split("T")[0],
    });
    cursor.setDate(cursor.getDate() + chunkDays);
  }
  return chunks;
}

// ── Attribution: aggregate CRM data back onto meta tables ──
async function fetchAllRowsPaginated(supabase: any, table: string, select: string, filters: { column: string; op: string; value: any }[]): Promise<any[]> {
  const PAGE_SIZE = 1000;
  const all: any[] = [];
  let from = 0;
  let hasMore = true;
  while (hasMore) {
    let query = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    for (const f of filters) {
      if (f.op === 'eq') query = query.eq(f.column, f.value);
      else if (f.op === 'gte') query = query.gte(f.column, f.value);
      else if (f.op === 'lte') query = query.lte(f.column, f.value);
      else if (f.op === 'not.is') query = query.not(f.column, 'is', f.value);
    }
    const { data, error } = await query;
    if (error) { console.error(`Pagination error on ${table}:`, error); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    hasMore = data.length === PAGE_SIZE;
    from += PAGE_SIZE;
  }
  return all;
}

async function attributeCRMData(supabase: any, clientId: string, startDate?: string, endDate?: string) {
  console.log(`Starting CRM attribution (date range: ${startDate || 'all'} to ${endDate || 'all'})...`);

  const dateStart = startDate ? `${startDate}T00:00:00.000Z` : null;
  const dateEnd = endDate ? `${endDate}T23:59:59.999Z` : null;

  const { data: metaCampaigns } = await supabase
    .from("meta_campaigns")
    .select("id, name, spend, meta_campaign_id")
    .eq("client_id", clientId);

  if (!metaCampaigns || metaCampaigns.length === 0) {
    console.log("No meta campaigns found, skipping attribution");
    return;
  }

  const { data: metaAdSets } = await supabase
    .from("meta_ad_sets")
    .select("id, name, spend, meta_adset_id")
    .eq("client_id", clientId);

  const { data: metaAds } = await supabase
    .from("meta_ads")
    .select("id, name, spend, ad_set_id, meta_ad_id, meta_adset_id")
    .eq("client_id", clientId);

  const leadFilters: { column: string; op: string; value: any }[] = [
    { column: "client_id", op: "eq", value: clientId },
  ];
  if (dateStart) leadFilters.push({ column: "created_at", op: "gte", value: dateStart });
  if (dateEnd) leadFilters.push({ column: "created_at", op: "lte", value: dateEnd });
  const leads = await fetchAllRowsPaginated(supabase, "leads", "id, campaign_name, ad_set_name, ad_id, is_spam, utm_source, utm_medium, utm_campaign, utm_content, source", leadFilters);
  console.log(`Attribution: fetched ${leads.length} leads (paginated)`);

  const leadsWithCampaign = leads.filter((l: any) => l.campaign_name && l.campaign_name.trim());
  console.log(`Attribution debug: ${leadsWithCampaign.length} leads have campaign_name`);

  const callFilters: { column: string; op: string; value: any }[] = [
    { column: "client_id", op: "eq", value: clientId },
  ];
  if (dateStart) callFilters.push({ column: "booked_at", op: "gte", value: dateStart });
  if (dateEnd) callFilters.push({ column: "booked_at", op: "lte", value: dateEnd });
  const calls = await fetchAllRowsPaginated(supabase, "calls", "id, lead_id, showed", callFilters);

  const fundedFilters: { column: string; op: string; value: any }[] = [
    { column: "client_id", op: "eq", value: clientId },
  ];
  if (dateStart) fundedFilters.push({ column: "funded_at", op: "gte", value: dateStart });
  if (dateEnd) fundedFilters.push({ column: "funded_at", op: "lte", value: dateEnd });
  const funded = await fetchAllRowsPaginated(supabase, "funded_investors", "id, lead_id, funded_amount, commitment_amount", fundedFilters);

  const callsByLead = new Map<string, { total: number; showed: number }>();
  for (const c of calls || []) {
    if (!c.lead_id) continue;
    const existing = callsByLead.get(c.lead_id) || { total: 0, showed: 0 };
    existing.total++;
    if (c.showed) existing.showed++;
    callsByLead.set(c.lead_id, existing);
  }

  const fundedByLead = new Map<string, { count: number; dollars: number }>();
  for (const f of funded || []) {
    if (!f.lead_id) continue;
    const existing = fundedByLead.get(f.lead_id) || { count: 0, dollars: 0 };
    existing.count++;
    const amount = (Number(f.funded_amount) > 0) ? Number(f.funded_amount) : (Number(f.commitment_amount) || 0);
    existing.dollars += amount;
    fundedByLead.set(f.lead_id, existing);
  }

  const adsByAdSetId = new Map<string, any[]>();
  for (const ad of metaAds || []) {
    if (!ad.ad_set_id) continue;
    const existing = adsByAdSetId.get(ad.ad_set_id) || [];
    existing.push(ad);
    adsByAdSetId.set(ad.ad_set_id, existing);
  }

  const metaAdByMetaId = new Map<string, any>();
  for (const ad of metaAds || []) {
    metaAdByMetaId.set(ad.meta_ad_id, ad);
  }

  // Duplicate names are common on Meta (renamed campaigns, draft duplicates,
  // multi-account fanout). A plain Map<name, row> overwrites silently and a
  // single campaign ends up reporting 0 leads. Keep all rows per name so the
  // attribution loop can fan stats out to every match.
  const campaignByName = new Map<string, any[]>();
  for (const c of metaCampaigns) {
    if (!c?.name) continue;
    const arr = campaignByName.get(c.name) || [];
    arr.push(c);
    campaignByName.set(c.name, arr);
  }

  const adSetByName = new Map<string, any[]>();
  for (const as of metaAdSets || []) {
    if (!as?.name) continue;
    const arr = adSetByName.get(as.name) || [];
    arr.push(as);
    adSetByName.set(as.name, arr);
  }

  const campaignByMetaId = new Map<string, any>();
  for (const c of metaCampaigns) {
    campaignByMetaId.set(c.meta_campaign_id, c);
  }

  type Stats = { leads: number; spamLeads: number; calls: number; showed: number; funded: number; fundedDollars: number };
  const campaignStats = new Map<string, Stats>();
  const adSetStats = new Map<string, Stats>();
  const adStats = new Map<string, Stats>();
  let unattributedCount = 0;

  function addStats(map: Map<string, Stats>, key: string, leadId: string, isSpam: boolean) {
    const stats = map.get(key) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
    if (isSpam) {
      stats.spamLeads++;
    } else {
      stats.leads++;
    }
    if (!isSpam) {
      const leadCalls = callsByLead.get(leadId);
      if (leadCalls) { stats.calls += leadCalls.total; stats.showed += leadCalls.showed; }
      const leadFunded = fundedByLead.get(leadId);
      if (leadFunded) { stats.funded += leadFunded.count; stats.fundedDollars += leadFunded.dollars; }
    }
    map.set(key, stats);
  }

  for (const lead of leads || []) {
    const isSpam = !!lead.is_spam;
    let attributed = false;

    const campaignName = lead.campaign_name || lead.utm_campaign;
    if (campaignName) {
      if (campaignByName.has(campaignName)) {
        addStats(campaignStats, campaignName, lead.id, isSpam);
        attributed = true;
      } else if (campaignByMetaId.has(campaignName)) {
        const matchedCampaign = campaignByMetaId.get(campaignName);
        addStats(campaignStats, matchedCampaign.name, lead.id, isSpam);
        attributed = true;
      }
    }

    const adSetName = lead.ad_set_name || lead.utm_medium;
    if (adSetName) {
      if (adSetByName.has(adSetName)) {
        addStats(adSetStats, adSetName, lead.id, isSpam);
        attributed = true;
      } else {
        const matchedAdSet = (metaAdSets || []).find((as: any) => as.meta_adset_id === adSetName);
        if (matchedAdSet) {
          addStats(adSetStats, matchedAdSet.name, lead.id, isSpam);
          attributed = true;
        }
      }
    }

    let matchedAdId: string | null = null;
    const adIdToMatch = lead.ad_id || lead.utm_content;
    if (adIdToMatch) {
      const directAd = metaAdByMetaId.get(adIdToMatch);
      if (directAd) matchedAdId = directAd.id;
      if (!matchedAdId) {
        const adByName = (metaAds || []).find((a: any) => a.name === adIdToMatch);
        if (adByName) matchedAdId = adByName.id;
      }
    }

    if (!matchedAdId && adSetName) {
      const matchedAdSets = adSetByName.get(adSetName) ||
        ((metaAdSets || []).filter((as: any) => as.meta_adset_id === adSetName));
      if (matchedAdSets && matchedAdSets.length === 1) {
        const adsInSet = adsByAdSetId.get(matchedAdSets[0].id) || [];
        if (adsInSet.length === 1) {
          matchedAdId = adsInSet[0].id;
        }
      }
    }

    if (matchedAdId) {
      addStats(adStats, matchedAdId, lead.id, isSpam);
      attributed = true;
    }

    if (!attributed && !isSpam) {
      unattributedCount++;
    }
  }

  console.log(`Attribution: ${unattributedCount} leads unattributed out of ${(leads || []).filter((l: any) => !l.is_spam).length} total`);

  for (const campaign of metaCampaigns) {
    const stats = campaignStats.get(campaign.name) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
    const spend = Number(campaign.spend) || 0;
    await supabase.from("meta_campaigns").update({
      attributed_leads: stats.leads,
      attributed_spam_leads: stats.spamLeads,
      attributed_calls: stats.calls,
      attributed_showed: stats.showed,
      attributed_funded: stats.funded,
      attributed_funded_dollars: stats.fundedDollars,
      cost_per_lead: stats.leads > 0 ? Math.round((spend / stats.leads) * 100) / 100 : 0,
      cost_per_call: stats.calls > 0 ? Math.round((spend / stats.calls) * 100) / 100 : 0,
      cost_per_funded: stats.funded > 0 ? Math.round((spend / stats.funded) * 100) / 100 : 0,
    }).eq("id", campaign.id);
  }

  // ── Proportional fallback: distribute campaign-level attribution to ad sets/ads
  // by spend share when sub-level UTMs (ad_set_name, ad_id) are missing. ──
  const adSetsByCampaignId = new Map<string, any[]>();
  for (const as of metaAdSets || []) {
    const cid = (metaCampaigns.find((c: any) => c.meta_campaign_id === (as as any).meta_campaign_id) || {}).id;
    if (!cid) continue;
    const arr = adSetsByCampaignId.get(cid) || [];
    arr.push(as);
    adSetsByCampaignId.set(cid, arr);
  }

  function distribute(total: number, weights: number[]): number[] {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0 || total <= 0) return weights.map(() => 0);
    const raw = weights.map(w => (w / sum) * total);
    const floored = raw.map(v => Math.floor(v));
    let remainder = Math.round(total - floored.reduce((a, b) => a + b, 0));
    const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
    for (const { i } of order) { if (remainder <= 0) break; floored[i]++; remainder--; }
    return floored;
  }

  for (const campaign of metaCampaigns) {
    const cStats = campaignStats.get(campaign.name);
    if (!cStats) continue;
    const childAdSets = adSetsByCampaignId.get(campaign.id) || [];
    if (childAdSets.length === 0) continue;

    // Sum of stats already directly attributed to ad sets in this campaign
    const directlyAttributed = childAdSets.reduce(
      (acc, as) => {
        const s = adSetStats.get(as.name);
        if (s) {
          acc.leads += s.leads; acc.spamLeads += s.spamLeads;
          acc.calls += s.calls; acc.showed += s.showed;
          acc.funded += s.funded; acc.fundedDollars += s.fundedDollars;
        }
        return acc;
      },
      { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 },
    );

    const remainder = {
      leads: Math.max(0, cStats.leads - directlyAttributed.leads),
      spamLeads: Math.max(0, cStats.spamLeads - directlyAttributed.spamLeads),
      calls: Math.max(0, cStats.calls - directlyAttributed.calls),
      showed: Math.max(0, cStats.showed - directlyAttributed.showed),
      funded: Math.max(0, cStats.funded - directlyAttributed.funded),
      fundedDollars: Math.max(0, cStats.fundedDollars - directlyAttributed.fundedDollars),
    };
    if (remainder.leads + remainder.spamLeads + remainder.calls + remainder.funded === 0 && remainder.fundedDollars === 0) continue;

    const weights = childAdSets.map(as => Number(as.spend) || 0);
    const totalChildSpend = weights.reduce((a, b) => a + b, 0);
    if (totalChildSpend <= 0) continue;

    const leadDist = distribute(remainder.leads, weights);
    const spamDist = distribute(remainder.spamLeads, weights);
    const callDist = distribute(remainder.calls, weights);
    const showedDist = distribute(remainder.showed, weights);
    const fundedDist = distribute(remainder.funded, weights);

    childAdSets.forEach((as, idx) => {
      const existing = adSetStats.get(as.name) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
      existing.leads += leadDist[idx];
      existing.spamLeads += spamDist[idx];
      existing.calls += callDist[idx];
      existing.showed += showedDist[idx];
      existing.funded += fundedDist[idx];
      existing.fundedDollars += remainder.fundedDollars * (weights[idx] / totalChildSpend);
      adSetStats.set(as.name, existing);
    });
  }

  // Now distribute each ad set's stats down to its ads by spend share
  for (const adSet of metaAdSets || []) {
    const asStats = adSetStats.get(adSet.name);
    if (!asStats) continue;
    const childAds = adsByAdSetId.get(adSet.id) || [];
    if (childAds.length === 0) continue;

    const directly = childAds.reduce(
      (acc, ad) => {
        const s = adStats.get(ad.id);
        if (s) {
          acc.leads += s.leads; acc.spamLeads += s.spamLeads;
          acc.calls += s.calls; acc.showed += s.showed;
          acc.funded += s.funded; acc.fundedDollars += s.fundedDollars;
        }
        return acc;
      },
      { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 },
    );

    const rem = {
      leads: Math.max(0, asStats.leads - directly.leads),
      spamLeads: Math.max(0, asStats.spamLeads - directly.spamLeads),
      calls: Math.max(0, asStats.calls - directly.calls),
      showed: Math.max(0, asStats.showed - directly.showed),
      funded: Math.max(0, asStats.funded - directly.funded),
      fundedDollars: Math.max(0, asStats.fundedDollars - directly.fundedDollars),
    };
    if (rem.leads + rem.spamLeads + rem.calls + rem.funded === 0 && rem.fundedDollars === 0) continue;

    const weights = childAds.map(ad => Number(ad.spend) || 0);
    const totalChildSpend = weights.reduce((a, b) => a + b, 0);
    if (totalChildSpend <= 0) continue;

    const leadDist = distribute(rem.leads, weights);
    const spamDist = distribute(rem.spamLeads, weights);
    const callDist = distribute(rem.calls, weights);
    const showedDist = distribute(rem.showed, weights);
    const fundedDist = distribute(rem.funded, weights);

    childAds.forEach((ad, idx) => {
      const existing = adStats.get(ad.id) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
      existing.leads += leadDist[idx];
      existing.spamLeads += spamDist[idx];
      existing.calls += callDist[idx];
      existing.showed += showedDist[idx];
      existing.funded += fundedDist[idx];
      existing.fundedDollars += rem.fundedDollars * (weights[idx] / totalChildSpend);
      adStats.set(ad.id, existing);
    });
  }

  for (const adSet of metaAdSets || []) {
    const stats = adSetStats.get(adSet.name) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
    const spend = Number(adSet.spend) || 0;
    await supabase.from("meta_ad_sets").update({
      attributed_leads: stats.leads,
      attributed_spam_leads: stats.spamLeads,
      attributed_calls: stats.calls,
      attributed_showed: stats.showed,
      attributed_funded: stats.funded,
      attributed_funded_dollars: stats.fundedDollars,
      cost_per_lead: stats.leads > 0 ? Math.round((spend / stats.leads) * 100) / 100 : 0,
      cost_per_call: stats.calls > 0 ? Math.round((spend / stats.calls) * 100) / 100 : 0,
      cost_per_funded: stats.funded > 0 ? Math.round((spend / stats.funded) * 100) / 100 : 0,
    }).eq("id", adSet.id);
  }

  for (const ad of metaAds || []) {
    const stats = adStats.get(ad.id) || { leads: 0, spamLeads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 };
    const spend = Number(ad.spend) || 0;
    await supabase.from("meta_ads").update({
      attributed_leads: stats.leads,
      attributed_spam_leads: stats.spamLeads,
      attributed_calls: stats.calls,
      attributed_showed: stats.showed,
      attributed_funded: stats.funded,
      attributed_funded_dollars: stats.fundedDollars,
      cost_per_lead: stats.leads > 0 ? Math.round((spend / stats.leads) * 100) / 100 : 0,
      cost_per_call: stats.calls > 0 ? Math.round((spend / stats.calls) * 100) / 100 : 0,
      cost_per_funded: stats.funded > 0 ? Math.round((spend / stats.funded) * 100) / 100 : 0,
    }).eq("id", ad.id);
  }

  if (unattributedCount > 0 && startDate) {
    const { data: existing } = await supabase
      .from("daily_metrics")
      .select("id")
      .eq("client_id", clientId)
      .eq("date", startDate)
      .maybeSingle();

    if (existing) {
      await supabase.from("daily_metrics").update({
        unattributed_leads: unattributedCount,
      }).eq("id", existing.id);
    }
  }

  console.log(`Attribution complete: ${campaignStats.size} campaigns, ${adSetStats.size} ad sets, ${adStats.size} ads, ${unattributedCount} unattributed`);
}

// ── Main handler ──
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Reset API call counter for each request
  metaApiCallCount = 0;

  try {
    const { clientId, startDate, endDate, adAccountOverride } = await req.json();
    if (!clientId) {
      return new Response(JSON.stringify({ success: false, error: "clientId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Set up logging context
    _supabaseForLogging = supabase;
    _clientIdForLogging = clientId;

    // ── Multi-account fan-out ──
    // If the client has additional Meta ad accounts (meta_ad_account_ids), sync each
    // extra account by recursively invoking this function with adAccountOverride.
    // The current invocation continues with the primary meta_ad_account_id.
    if (!adAccountOverride) {
      const { data: clientForFanout } = await supabase
        .from("clients")
        .select("meta_ad_account_id, meta_ad_account_ids")
        .eq("id", clientId)
        .maybeSingle();
      const extras: string[] = Array.isArray((clientForFanout as any)?.meta_ad_account_ids)
        ? ((clientForFanout as any).meta_ad_account_ids as string[]).filter(
            (a) => a && a !== clientForFanout?.meta_ad_account_id,
          )
        : [];
      // Cap to 2 extras (3 accounts total including the primary)
      const fanoutTargets = extras.slice(0, 2);
      for (const acct of fanoutTargets) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/sync-meta-ads`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({ clientId, startDate, endDate, adAccountOverride: acct }),
          });
          console.log(`[fanout] Triggered sync for extra Meta account ${acct}`);
        } catch (e) {
          console.warn(`[fanout] Failed to trigger sync for ${acct}:`, e);
        }
      }
    }

    // ── Create sync_run record ──
    const { data: syncRun } = await supabase.from("sync_runs").insert({
      function_name: "sync-meta-ads",
      client_id: clientId,
      started_at: new Date().toISOString(),
      status: "running",
      metadata: { startDate, endDate },
    }).select("id").single();
    const syncRunId = syncRun?.id;

    let totalRowsWritten = 0;

    try {
      // Get client's Meta credentials
      const { data: client, error: clientErr } = await supabase
        .from("clients")
        .select("meta_access_token, meta_ad_account_id, name")
        .eq("id", clientId)
        .single();

      if (clientErr || !client) {
        throw new Error("Client not found");
      }

      const effectiveAccountId = adAccountOverride || client.meta_ad_account_id;
      if (!effectiveAccountId) {
        return new Response(
          JSON.stringify({
            success: false,
            skipped: true,
            fallback: true,
            error: "Meta Ad Account ID must be configured in client settings.",
            client_id: clientId,
            client_name: client.name,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const accessToken = client.meta_access_token || Deno.env.get("META_SHARED_ACCESS_TOKEN");
      if (!accessToken) {
        throw new Error("No Meta access token available (client token and shared token both missing).");
      }
      const adAccountId = effectiveAccountId.startsWith("act_")
        ? effectiveAccountId
        : `act_${effectiveAccountId}`;

      console.log(`Syncing Meta Ads for ${client.name} (${adAccountId})`);

      // ── Get ad account timezone ──
      const accountTz = await getAdAccountTimezone(adAccountId, accessToken, supabase);
      console.log(`Ad account timezone: ${accountTz}`);

      // ── 1. Fetch Campaigns ──
      const campaignFields = "id,name,status,objective,buying_type,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time";
      const campaigns = await fetchAllPages(
        `${META_GRAPH_API_URL}/${adAccountId}/campaigns?fields=${campaignFields}`,
        accessToken, 100, "campaigns"
      );
      console.log(`Fetched ${campaigns.length} campaigns`);

      const campaignRecords = campaigns.map((c: any) => ({
        client_id: clientId,
        meta_campaign_id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective || null,
        buying_type: c.buying_type || null,
        daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        budget_remaining: c.budget_remaining ? Number(c.budget_remaining) / 100 : null,
        start_time: c.start_time || null,
        stop_time: c.stop_time || null,
        created_time: c.created_time || null,
        updated_time: c.updated_time || null,
        synced_at: new Date().toISOString(),
      }));

      for (const rec of campaignRecords) {
        await supabase.from("meta_campaigns").upsert(rec, { onConflict: "client_id,meta_campaign_id" });
        totalRowsWritten++;
      }

      const { data: dbCampaigns } = await supabase
        .from("meta_campaigns")
        .select("id, meta_campaign_id")
        .eq("client_id", clientId);
      const campaignIdMap = new Map((dbCampaigns || []).map((c: any) => [c.meta_campaign_id, c.id]));

      // ── 2. Fetch Daily Breakdown with proper attribution windows ──
      let dailyRows = 0;
      try {
        const dailyFields = "spend,impressions,clicks,ctr,actions,action_values,reach,frequency,date_start,date_stop";
        const attrWindows = encodeURIComponent('["7d_click","1d_view"]');
        const dailyRange = resolveDateRange(startDate, endDate, accountTz);
        const dailyInsights = await fetchInsightsAdaptive(
          (since, until) =>
            `${META_GRAPH_API_URL}/${adAccountId}/insights?fields=${dailyFields}` +
            `&time_range={"since":"${since}","until":"${until}"}` +
            `&time_increment=1&level=account&action_attribution_windows=${attrWindows}`,
          accessToken,
          dailyRange.since,
          dailyRange.until,
          "daily-insights",
          14, 1, 100,
        );
        console.log(`Fetched ${dailyInsights.length} daily insight rows`);

        for (const day of dailyInsights) {
          const dateStr = day.date_start;
          if (!dateStr) continue;

          // Extract conversion actions
          let purchases = 0;
          let purchaseValue = 0;
          if (day.actions) {
            for (const action of day.actions) {
              if (action.action_type === "purchase" || action.action_type === "offsite_conversion.fb_pixel_purchase") {
                purchases += Number(action.value) || 0;
              }
            }
          }
          if (day.action_values) {
            for (const av of day.action_values) {
              if (av.action_type === "purchase" || av.action_type === "offsite_conversion.fb_pixel_purchase") {
                purchaseValue += Number(av.value) || 0;
              }
            }
          }

          const { data: existing } = await supabase
            .from("daily_metrics")
            .select("id")
            .eq("client_id", clientId)
            .eq("date", dateStr)
            .maybeSingle();

          const metricsPayload = {
            ad_spend: Number(day.spend) || 0,
            impressions: Number(day.impressions) || 0,
            clicks: Number(day.clicks) || 0,
            ctr: Number(day.ctr) || 0,
            date_account_tz: dateStr,
          };

          if (existing) {
            await supabase.from("daily_metrics").update(metricsPayload).eq("id", existing.id);
          } else {
            await supabase.from("daily_metrics").insert({
              client_id: clientId,
              date: dateStr,
              ...metricsPayload,
            });
          }
          dailyRows++;
          totalRowsWritten++;
        }
        console.log(`Upserted ${dailyRows} daily metric rows`);
      } catch (dailyErr) {
        console.error("Daily insights fetch error (non-fatal):", dailyErr);
      }

      // ── 3. Fetch Ad Sets ──
      const adSetFields = "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,budget_remaining,bid_strategy,optimization_goal,billing_event,targeting,start_time,end_time";
      const adSets = await fetchAllPages(
        `${META_GRAPH_API_URL}/${adAccountId}/adsets?fields=${adSetFields}`,
        accessToken, 100, "adsets"
      );
      console.log(`Fetched ${adSets.length} ad sets`);

      const adSetRecords = adSets.map((a: any) => ({
        client_id: clientId,
        campaign_id: campaignIdMap.get(a.campaign_id) || null,
        meta_adset_id: a.id,
        meta_campaign_id: a.campaign_id || null,
        name: a.name,
        status: a.status,
        effective_status: a.effective_status || null,
        daily_budget: a.daily_budget ? Number(a.daily_budget) / 100 : null,
        lifetime_budget: a.lifetime_budget ? Number(a.lifetime_budget) / 100 : null,
        budget_remaining: a.budget_remaining ? Number(a.budget_remaining) / 100 : null,
        bid_strategy: a.bid_strategy || null,
        optimization_goal: a.optimization_goal || null,
        billing_event: a.billing_event || null,
        targeting: a.targeting || {},
        start_time: a.start_time || null,
        end_time: a.end_time || null,
        synced_at: new Date().toISOString(),
      }));

      for (const rec of adSetRecords) {
        await supabase.from("meta_ad_sets").upsert(rec, { onConflict: "client_id,meta_adset_id" });
        totalRowsWritten++;
      }

      const { data: dbAdSets } = await supabase
        .from("meta_ad_sets")
        .select("id, meta_adset_id")
        .eq("client_id", clientId);
      const adSetIdMap = new Map((dbAdSets || []).map((a: any) => [a.meta_adset_id, a.id]));

      // ── 4. Fetch Ads ──
      const adFields = "id,name,status,effective_status,adset_id,campaign_id,creative{id,thumbnail_url,image_url,object_story_spec}";
      const ads = await fetchAllPages(
        `${META_GRAPH_API_URL}/${adAccountId}/ads?fields=${adFields}`,
        accessToken, 50, "ads"
      );
      console.log(`Fetched ${ads.length} ads`);

      const videoIdMap = new Map<string, string>();

      const adRecords = ads.map((a: any) => {
        const creative = a.creative || {};
        const storySpec = creative.object_story_spec || {};
        const videoData = storySpec.video_data;
        const linkData = storySpec.link_data;

        let imageUrl = creative.image_url || null;
        let fullImageUrl = creative.image_url || null;
        let videoThumbnailUrl: string | null = null;
        let mediaType = 'image';

        if (videoData) {
          mediaType = 'video';
          videoThumbnailUrl = videoData.image_url || videoData.image_hash || null;
          if (!imageUrl) imageUrl = videoThumbnailUrl;
          if (videoData.video_id) {
            videoIdMap.set(a.id, videoData.video_id);
          }
        } else if (linkData?.picture) {
          if (!imageUrl) imageUrl = linkData.picture;
          if (!fullImageUrl) fullImageUrl = linkData.picture;
        }

        return {
          client_id: clientId,
          ad_set_id: adSetIdMap.get(a.adset_id) || null,
          meta_ad_id: a.id,
          meta_adset_id: a.adset_id || null,
          meta_campaign_id: a.campaign_id || null,
          name: a.name,
          status: a.status,
          effective_status: a.effective_status || null,
          creative_id: creative.id || null,
          thumbnail_url: creative.thumbnail_url || null,
          image_url: imageUrl,
          video_thumbnail_url: videoThumbnailUrl,
          full_image_url: fullImageUrl,
          media_type: mediaType,
          synced_at: new Date().toISOString(),
        };
      });

      for (const rec of adRecords) {
        await supabase.from("meta_ads").upsert(rec, { onConflict: "client_id,meta_ad_id" });
        totalRowsWritten++;
      }

      // ── Fetch HD video source URLs ──
      let hdVideosFetched = 0;
      for (const [metaAdId, videoId] of videoIdMap) {
        try {
          checkCallBudget("video-source");
          const video = await fetchMeta(
            `${META_GRAPH_API_URL}/${videoId}?fields=source`,
            accessToken, `video-source-${metaAdId}`
          );
          if (video.source) {
            await supabase.from("meta_ads")
              .update({ video_source_url: video.source })
              .eq("client_id", clientId)
              .eq("meta_ad_id", metaAdId);
            hdVideosFetched++;
          }
        } catch (videoErr) {
          console.warn(`Failed to fetch video source for ${metaAdId}:`, videoErr);
          break;
        }
      }
      console.log(`Fetched ${hdVideosFetched} HD video source URLs`);

      // ── 5. Fetch Per-Entity Insights with attribution windows ──
      const attrWindowsParam = encodeURIComponent('["7d_click","1d_view"]');

      // Helper: extract Meta-reported conversion metrics from actions/action_values arrays
      const LEAD_TYPES = new Set([
        "lead",
        "leadgen.other",
        "offsite_conversion.fb_pixel_lead",
        "onsite_conversion.lead_grouped",
        "onsite_web_lead",
        "onsite_conversion.messaging_conversation_started_7d",
        "onsite_web_app_lead",
        "leadgen_grouped",
      ]);
      const PURCHASE_TYPES = new Set([
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "onsite_conversion.purchase",
        "omni_purchase",
        "web_in_store_purchase",
      ]);
      function extractMetaReported(actions: any[] | undefined, actionValues: any[] | undefined) {
        let leads = 0, purchases = 0, conversions = 0, conversionValue = 0;
        // Track unknown action types for debugging
        const unknownActionTypes = new Set<string>();
        for (const a of actions || []) {
          const t = a.action_type;
          const v = Number(a.value) || 0;
          if (LEAD_TYPES.has(t)) leads += v;
          if (PURCHASE_TYPES.has(t)) purchases += v;
          // Catch any action type containing "lead" we missed
          else if (t && typeof t === "string" && t.toLowerCase().includes("lead") && !LEAD_TYPES.has(t)) {
            unknownActionTypes.add(t);
            leads += v; // best-effort include
          }
          // Treat any "offsite_conversion" or "onsite_conversion" or core conversion event as a conversion
          if (
            LEAD_TYPES.has(t) ||
            PURCHASE_TYPES.has(t) ||
            t === "complete_registration" ||
            t === "offsite_conversion.fb_pixel_complete_registration" ||
            t === "submit_application" ||
            t === "schedule"
          ) {
            conversions += v;
          }
        }
        if (unknownActionTypes.size > 0) {
          console.log(`Auto-included unknown lead-like action types:`, Array.from(unknownActionTypes));
        }
        for (const av of actionValues || []) {
          const t = av.action_type;
          const v = Number(av.value) || 0;
          if (PURCHASE_TYPES.has(t) || LEAD_TYPES.has(t)) conversionValue += v;
        }
        return { leads, purchases, conversions, conversionValue };
      }

      try {
        const insightsFields = "campaign_id,impressions,clicks,spend,ctr,cpc,cpm,actions,action_values";
        const campRange = resolveDateRange(startDate, endDate, accountTz);
        const insights = await fetchInsightsAdaptive(
          (since, until) =>
            `${META_GRAPH_API_URL}/${adAccountId}/insights?fields=${insightsFields}` +
            `&level=campaign&time_range={"since":"${since}","until":"${until}"}` +
            `&time_increment=all_days&action_attribution_windows=${attrWindowsParam}`,
          accessToken,
          campRange.since,
          campRange.until,
          "campaign-insights",
          14, 1, 50,
        );
        for (const ins of insights) {
          const m = extractMetaReported(ins.actions, ins.action_values);
          await supabase.from("meta_campaigns").update({
            spend: Number(ins.spend) || 0,
            impressions: Number(ins.impressions) || 0,
            clicks: Number(ins.clicks) || 0,
            ctr: Number(ins.ctr) || 0,
            cpc: Number(ins.cpc) || 0,
            cpm: Number(ins.cpm) || 0,
            meta_reported_leads: m.leads,
            meta_reported_purchases: m.purchases,
            meta_reported_conversions: m.conversions,
            meta_reported_conversion_value: m.conversionValue,
          }).eq("client_id", clientId).eq("meta_campaign_id", ins.campaign_id);
        }

        const adsetRange = resolveDateRange(startDate, endDate, accountTz);
        const adSetInsights = await fetchInsightsAdaptive(
          (since, until) =>
            `${META_GRAPH_API_URL}/${adAccountId}/insights?fields=adset_id,impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values` +
            `&level=adset&time_range={"since":"${since}","until":"${until}"}` +
            `&time_increment=all_days&action_attribution_windows=${attrWindowsParam}` +
            `&filtering=[{"field":"spend","operator":"GREATER_THAN","value":"0"}]`,
          accessToken,
          adsetRange.since,
          adsetRange.until,
          "adset-insights",
          7, 1, 50,
        );
        for (const ins of adSetInsights) {
          const m = extractMetaReported(ins.actions, ins.action_values);
          await supabase.from("meta_ad_sets").update({
            spend: Number(ins.spend) || 0,
            impressions: Number(ins.impressions) || 0,
            clicks: Number(ins.clicks) || 0,
            ctr: Number(ins.ctr) || 0,
            cpc: Number(ins.cpc) || 0,
            cpm: Number(ins.cpm) || 0,
            reach: Number(ins.reach) || 0,
            frequency: Number(ins.frequency) || 0,
            meta_reported_leads: m.leads,
            meta_reported_purchases: m.purchases,
            meta_reported_conversions: m.conversions,
            meta_reported_conversion_value: m.conversionValue,
          }).eq("client_id", clientId).eq("meta_adset_id", ins.adset_id);
        }

        // Ad-level insights — adaptive 3-day chunks (shrinks further on data-cap errors)
        const adRange = resolveDateRange(startDate, endDate, accountTz);
        const adSpendAccum = new Map<string, { spend: number; impressions: number; clicks: number; reach: number; leads: number; purchases: number; conversions: number; conversionValue: number }>();

        const adInsightsAll = await fetchInsightsAdaptive(
          (since, until) =>
            `${META_GRAPH_API_URL}/${adAccountId}/insights?fields=ad_id,impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values` +
            `&level=ad&time_range={"since":"${since}","until":"${until}"}` +
            `&time_increment=all_days&action_attribution_windows=${attrWindowsParam}` +
            `&filtering=[{"field":"spend","operator":"GREATER_THAN","value":"0"}]`,
          accessToken,
          adRange.since,
          adRange.until,
          "ad-insights",
          3, 1, 50,
        );
        for (const ins of adInsightsAll) {
              const existing = adSpendAccum.get(ins.ad_id) || { spend: 0, impressions: 0, clicks: 0, reach: 0, leads: 0, purchases: 0, conversions: 0, conversionValue: 0 };
              existing.spend += Number(ins.spend) || 0;
              existing.impressions += Number(ins.impressions) || 0;
              existing.clicks += Number(ins.clicks) || 0;
              existing.reach += Number(ins.reach) || 0;
              const m = extractMetaReported(ins.actions, ins.action_values);
              existing.leads += m.leads;
              existing.purchases += m.purchases;
              existing.conversions += m.conversions;
              existing.conversionValue += m.conversionValue;
              adSpendAccum.set(ins.ad_id, existing);
        }

        for (const [adId, stats] of adSpendAccum) {
          const ctr = stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0;
          const cpc = stats.clicks > 0 ? stats.spend / stats.clicks : 0;
          const cpm = stats.impressions > 0 ? (stats.spend / stats.impressions) * 1000 : 0;
          await supabase.from("meta_ads").update({
            spend: stats.spend,
            impressions: stats.impressions,
            clicks: stats.clicks,
            ctr: Math.round(ctr * 100) / 100,
            cpc: Math.round(cpc * 100) / 100,
            cpm: Math.round(cpm * 100) / 100,
            reach: stats.reach,
            meta_reported_leads: stats.leads,
            meta_reported_purchases: stats.purchases,
            meta_reported_conversions: stats.conversions,
            meta_reported_conversion_value: stats.conversionValue,
          }).eq("client_id", clientId).eq("meta_ad_id", adId);
        }
      } catch (insightErr) {
        console.error("Per-entity insights fetch error (non-fatal):", insightErr);
      }

      // ── 6. CRM Attribution ──
      try {
        await attributeCRMData(supabase, clientId, startDate, endDate);
      } catch (attrErr) {
        console.error("CRM attribution error (non-fatal):", attrErr);
      }

      // Update sync timestamp and streak
      const today = new Date().toISOString().slice(0, 10);
      const { data: currentSettings } = await supabase
        .from("client_settings")
        .select("meta_ads_sync_streak, meta_ads_last_sync_date")
        .eq("client_id", clientId)
        .maybeSingle();

      let newStreak = 1;
      if (currentSettings?.meta_ads_last_sync_date) {
        const lastDate = new Date(currentSettings.meta_ads_last_sync_date);
        const todayDate = new Date(today);
        const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) {
          newStreak = currentSettings.meta_ads_sync_streak || 1;
        } else if (diffDays === 1) {
          newStreak = (currentSettings.meta_ads_sync_streak || 0) + 1;
        }
      }

      await supabase.from("client_settings").upsert({
        client_id: clientId,
        meta_ads_sync_enabled: true,
        meta_ads_last_sync: new Date().toISOString(),
        meta_ads_sync_streak: newStreak,
        meta_ads_last_sync_date: today,
      }, { onConflict: "client_id" });

      // ── Mark sync_run as completed ──
      if (syncRunId) {
        await supabase.from("sync_runs").update({
          finished_at: new Date().toISOString(),
          status: "completed",
          rows_written: totalRowsWritten,
          metadata: { startDate, endDate, campaigns: campaigns.length, adSets: adSets.length, ads: ads.length, dailyMetrics: dailyRows, metaApiCalls: metaApiCallCount, timezone: accountTz },
        }).eq("id", syncRunId);
      }

      console.log(`Sync complete. Total Meta API calls: ${metaApiCallCount}/${META_API_CALL_LIMIT}`);

      // ── Fire-and-forget recalculate-daily-metrics for this client/range ──
      try {
        const recalcStart = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const recalcEnd = endDate || new Date().toISOString().split("T")[0];
        await supabase.functions.invoke("recalculate-daily-metrics", {
          body: { client_id: clientId, start_date: recalcStart, end_date: recalcEnd },
        });
        console.log(`[sync-meta-ads] recalculate-daily-metrics invoked for ${clientId} (${recalcStart}→${recalcEnd})`);
      } catch (recalcErr) {
        console.error("[sync-meta-ads] recalculate-daily-metrics invoke failed (non-fatal):", recalcErr);
      }

      return new Response(JSON.stringify({
        success: true,
        campaigns: campaigns.length,
        adSets: adSets.length,
        ads: ads.length,
        dailyMetrics: dailyRows,
        metaApiCalls: metaApiCallCount,
        timezone: accountTz,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (innerErr) {
      // Mark sync_run as failed
      if (syncRunId) {
        await supabase.from("sync_runs").update({
          finished_at: new Date().toISOString(),
          status: "failed",
          rows_written: totalRowsWritten,
          error_message: innerErr instanceof Error ? innerErr.message : "Unknown error",
        }).eq("id", syncRunId);
      }
      throw innerErr;
    }

  } catch (error) {
    console.error("sync-meta-ads error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
