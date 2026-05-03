import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Declare EdgeRuntime for background task support
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
} | undefined;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

// --- SOURCE NORMALIZATION FUNCTION ---
// Normalize raw UTM source to standardized platform names
function normalizeSourceValue(rawSource: string | null | undefined, campaignName: string | null | undefined): string {
  // If we have a raw source, normalize it
  if (rawSource) {
    const lower = rawSource.toLowerCase().trim();
    
    // Facebook/Meta detection
    if (lower.includes('facebook') || lower.includes('fb') || 
        lower.includes('meta') || lower.includes('instagram') ||
        lower.includes('ig_') || lower.match(/^ig\s/)) {
      return 'Facebook';
    }
    
    // Google detection
    if (lower.includes('google') || lower.includes('gclid') ||
        lower.includes('youtube') || lower.includes('yt_') ||
        lower.includes('adwords')) {
      return 'Google';
    }
    
    // TikTok detection
    if (lower.includes('tiktok') || lower.includes('tt_') ||
        lower.includes('bytedance')) {
      return 'TikTok';
    }
    
    // LinkedIn detection
    if (lower.includes('linkedin') || lower.includes('li_')) {
      return 'LinkedIn';
    }
    
    // Direct/Manual sources
    if (lower === 'webhook' || lower === 'manual' || lower === 'api' || 
        lower === 'direct' || lower === 'organic' || lower === 'ghl_sync') {
      return 'Direct';
    }
    
    // If it's a valid source, keep it
    if (rawSource && rawSource.length > 0 && rawSource !== 'undefined') {
      return rawSource;
    }
  }
  
  // Infer source from campaign name patterns if no valid source
  if (campaignName) {
    const campaignLower = campaignName.toLowerCase();
    
    // Facebook-style numeric IDs (10+ digits)
    if (/^\d{10,}$/.test(campaignName)) {
      return 'Facebook';
    }
    
    // Facebook patterns
    if (campaignLower.includes('fb_') || campaignLower.includes('facebook') || 
        campaignLower.includes('ig_') || campaignLower.includes('meta') ||
        campaignLower.includes('instagram')) {
      return 'Facebook';
    }
    
    // Google patterns
    if (campaignLower.includes('ggl_') || campaignLower.includes('google') ||
        campaignLower.includes('gdn_') || campaignLower.includes('search_') ||
        campaignLower.includes('pmax_')) {
      return 'Google';
    }
    
    // TikTok patterns
    if (campaignLower.includes('tt_') || campaignLower.includes('tiktok')) {
      return 'TikTok';
    }
  }
  
  return 'Unknown';
}

interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  customFields?: any;
  tags?: string[];
  source?: string;
  dateAdded?: string;
  dateUpdated?: string;
  attributionSource?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  };
}

interface GHLCall {
  id: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  status: string;
  duration?: number;
  recordingUrl?: string;
  dateAdded: string;
}

interface GHLOpportunity {
  id: string;
  contactId: string;
  status: string;
  monetaryValue?: number;
  monetary_value?: number;
  pipelineStageId?: string;
  pipelineStageName?: string;
  stageName?: string;
  dateAdded: string;
  lastStageChangeAt?: string;
}

interface GHLNote {
  id: string;
  body: string;
  userId?: string;
  dateAdded: string;
}

// Tag patterns that indicate a funded investor
const FUNDED_TAG_PATTERNS = [
  'funded',
  'funded investor',
  'fundedinvestor',
  'funded_investor',
  'active investor',
  'activeinvestor',
  'active_investor'
];

function hasFundedInvestorTag(contact: GHLContact): boolean {
  if (!contact.tags || !Array.isArray(contact.tags)) return false;
  
  return contact.tags.some(tag => 
    FUNDED_TAG_PATTERNS.some(pattern => 
      tag.toLowerCase().trim() === pattern ||
      tag.toLowerCase().includes(pattern)
    )
  );
}

function hasBadLeadTag(contact: GHLContact): boolean {
  if (!contact.tags || !Array.isArray(contact.tags)) return false;
  
  const badLeadPatterns = ['bad lead', 'badlead', 'bad_lead', 'bad-lead'];
  return contact.tags.some(tag => 
    badLeadPatterns.some(pattern => 
      tag.toLowerCase().includes(pattern)
    )
  );
}

// Retry helper for GHL API calls — handles 429 rate limiting with exponential backoff
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
      const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * Math.pow(2, attempt), 30000);
      console.warn(`[sync-ghl] 429 rate limited on ${url.split('?')[0]}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delayMs));
      continue;
    }
    return response;
  }
  // Should not reach here, but return last attempt
  return fetch(url, options);
}

async function fetchGHLContacts(
  apiKey: string,
  locationId: string,
  limit: number = 100,
  startAfterId?: string,
  page?: number
): Promise<{ contacts: GHLContact[]; nextPage?: number; total?: number }> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  // Try POST /contacts/search first (recommended v2 endpoint)
  try {
    const body: Record<string, any> = {
      locationId,
      pageLimit: limit,
      page: page || 1,
    };

    const response = await fetchWithRetry(`${GHL_BASE_URL}/contacts/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const data = await response.json();
      const contacts = data.contacts || [];
      const total = data.total || data.meta?.total || 0;
      const currentPage = data.currentPage || data.meta?.currentPage || page || 1;
      const nextPage = contacts.length === limit ? currentPage + 1 : undefined;
      return { contacts, nextPage, total };
    }

    // If POST /contacts/search returns non-429 error, fall back to GET /contacts/
    const errorText = await response.text();
    console.warn(`POST /contacts/search failed (${response.status}), falling back to GET /contacts/: ${errorText.substring(0, 200)}`);
  } catch (err) {
    console.warn(`POST /contacts/search threw error, falling back to GET /contacts/:`, err);
  }

  // Fallback: deprecated GET /contacts/ endpoint (still works for some locations)
  let url = `${GHL_BASE_URL}/contacts/?locationId=${locationId}&limit=${limit}`;
  if (startAfterId) {
    url += `&startAfterId=${startAfterId}`;
  }

  const fallbackResponse = await fetchWithRetry(url, { method: 'GET', headers });

  if (!fallbackResponse.ok) {
    const error = await fallbackResponse.text();
    throw new Error(`GHL API error (both endpoints failed): ${fallbackResponse.status} - ${error}`);
  }

  const data = await fallbackResponse.json();
  const contacts = data.contacts || [];
  const total = data.meta?.total || data.total || 0;
  const startAfter = data.meta?.startAfterId || data.meta?.startAfter || null;
  const nextPageExists = contacts.length === limit && startAfter;

  return {
    contacts,
    nextPage: nextPageExists ? (page || 1) + 1 : undefined,
    total,
  };
}

async function fetchGHLOpportunities(
  apiKey: string,
  locationId: string
): Promise<GHLOpportunity[]> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  const allOpportunities: GHLOpportunity[] = [];
  let hasMore = true;
  let startAfterId: string | null = null;
  const MAX_PAGES = 50; // Support up to 5000 opportunities
  let pageCount = 0;

  try {
    while (hasMore && pageCount < MAX_PAGES) {
      let url = `${GHL_BASE_URL}/opportunities/search?location_id=${locationId}&limit=100`;
      if (startAfterId) {
        url += `&startAfterId=${startAfterId}`;
      }

      const response = await fetchWithRetry(url, { method: 'GET', headers });

      if (!response.ok) {
        console.error(`GHL Opportunities API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      const opportunities = data.opportunities || [];
      allOpportunities.push(...opportunities);

      // Handle pagination
      if (data.meta?.startAfterId) {
        startAfterId = data.meta.startAfterId;
      } else if (data.meta?.nextPageUrl) {
        // Extract startAfterId from nextPageUrl if available
        const nextUrl = new URL(data.meta.nextPageUrl, GHL_BASE_URL);
        startAfterId = nextUrl.searchParams.get('startAfterId') || nextUrl.searchParams.get('startAfter') || null;
        if (!startAfterId && opportunities.length === 100) {
          startAfterId = opportunities[opportunities.length - 1]?.id;
        }
      } else if (opportunities.length === 100) {
        startAfterId = opportunities[opportunities.length - 1]?.id;
      } else {
        hasMore = false;
      }

      if (!startAfterId) hasMore = false;

      pageCount++;
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`Fetched total ${allOpportunities.length} opportunities across ${pageCount} pages`);
  } catch (err) {
    console.error('Error fetching GHL opportunities:', err);
  }

  return allOpportunities;
}

async function fetchGHLConversations(
  apiKey: string,
  locationId: string,
  sinceDate: Date
): Promise<GHLCall[]> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  const calls: GHLCall[] = [];
  let hasMore = true;
  let lastMessageId: string | undefined;
  const MAX_PAGES = 10;
  let pageCount = 0;

  try {
    while (hasMore && pageCount < MAX_PAGES) {
      let url = `${GHL_BASE_URL}/conversations/search?locationId=${locationId}&type=TYPE_CALL`;
      if (lastMessageId) {
        url += `&startAfterId=${lastMessageId}`;
      }

      const response = await fetch(url, { method: 'GET', headers });
      
      if (!response.ok) {
        console.error(`GHL Conversations API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      const conversations = data.conversations || [];

      for (const conv of conversations) {
        if (!conv.lastMessageDate || new Date(conv.lastMessageDate) < sinceDate) {
          hasMore = false;
          break;
        }

        if (conv.type === 'TYPE_CALL' && conv.contactId) {
          calls.push({
            id: conv.id,
            contactId: conv.contactId,
            direction: conv.lastMessageDirection === 'inbound' ? 'inbound' : 'outbound',
            status: conv.lastMessageStatus || 'unknown',
            duration: conv.lastCallDuration || undefined,
            recordingUrl: conv.lastCallRecording || undefined,
            dateAdded: conv.lastMessageDate,
          });
        }
      }

      if (conversations.length > 0) {
        lastMessageId = conversations[conversations.length - 1].id;
      } else {
        hasMore = false;
      }

      pageCount++;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (err) {
    console.error('Error fetching GHL conversations:', err);
  }

  return calls;
}

async function syncCallToDatabase(
  supabase: any,
  clientId: string,
  ghlCall: GHLCall
): Promise<{ action: 'enriched' | 'skipped' }> {
  const { data: existingCall } = await supabase
    .from('calls')
    .select('id, external_id, call_connected, recording_url')
    .eq('client_id', clientId)
    .or(`external_id.eq.${ghlCall.id},external_id.eq.${ghlCall.contactId}`)
    .maybeSingle();

  if (existingCall) {
    const updates: Record<string, any> = {
      call_connected: ghlCall.status === 'completed' || ghlCall.status === 'answered',
      ghl_synced_at: new Date().toISOString(),
    };

    if (ghlCall.duration && ghlCall.duration > 0) {
      updates.call_duration_seconds = ghlCall.duration;
    }

    if (ghlCall.recordingUrl && !existingCall.recording_url) {
      updates.recording_url = ghlCall.recordingUrl;
    }

    await supabase
      .from('calls')
      .update(updates)
      .eq('id', existingCall.id);

    return { action: 'enriched' };
  }

  return { action: 'skipped' };
}

async function syncClientCallLogs(
  supabase: any,
  client: { id: string; name: string; ghl_api_key: string; ghl_location_id: string },
  sinceDate: Date
): Promise<{ enriched: number; skipped: number; errors: string[] }> {
  const result = { enriched: 0, skipped: 0, errors: [] as string[] };

  console.log(`Starting GHL call sync for client: ${client.name}`);

  try {
    const calls = await fetchGHLConversations(client.ghl_api_key, client.ghl_location_id, sinceDate);
    console.log(`Fetched ${calls.length} calls for ${client.name}`);

    for (const call of calls) {
      try {
        const syncResult = await syncCallToDatabase(supabase, client.id, call);
        if (syncResult.action === 'enriched') result.enriched++;
        else result.skipped++;
      } catch (err) {
        result.errors.push(`Call ${call.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        result.skipped++;
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Call sync failed: ${errorMsg}`);
    console.error(`GHL call sync error for ${client.name}:`, errorMsg);
  }

  console.log(`GHL call sync complete for ${client.name}: enriched=${result.enriched}, skipped=${result.skipped}`);
  return result;
}

function parseCustomFields(customFields: any): Record<string, any> {
  if (!customFields) return {};
  
  // Handle array format: [{id, value, fieldKey}, ...]
  if (Array.isArray(customFields)) {
    const result: Record<string, any> = {};
    for (const field of customFields) {
      if (field && field.id && field.value !== undefined && field.value !== null && field.value !== '') {
        const key = field.fieldKey || field.id;
        result[key] = field.value;
      }
    }
    return result;
  }
  
  // Handle object/map format: {fieldId: value, ...} (common in search API responses)
  if (typeof customFields === 'object') {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(customFields)) {
      if (value !== undefined && value !== null && value !== '') {
        result[key] = value;
      }
    }
    return result;
  }
  
  return {};
}

// Fetch custom field definitions from GHL to get human-readable names
async function fetchGHLCustomFieldDefinitions(apiKey: string, locationId: string): Promise<Record<string, string>> {
  const fieldNameMap: Record<string, string> = {};
  if (!locationId) {
    console.warn('No locationId provided for custom field definitions fetch');
    return fieldNameMap;
  }
  try {
    const response = await fetch(`${GHL_BASE_URL}/locations/${locationId}/customFields`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
        'Accept': 'application/json',
      },
    });
    if (response.ok) {
      const data = await response.json();
      const fields = data.customFields || [];
      for (const field of fields) {
        if (field.id && field.name) {
          fieldNameMap[field.id] = field.name;
        }
        if (field.fieldKey && field.name) {
          fieldNameMap[field.fieldKey] = field.name;
        }
      }
      console.log(`Fetched ${Object.keys(fieldNameMap).length} custom field definitions. Sample keys: ${Object.keys(fieldNameMap).slice(0, 5).join(', ')}`);
    } else {
      const errText = await response.text().catch(() => '');
      console.warn(`Failed to fetch custom field definitions: ${response.status} - ${errText.substring(0, 200)}`);
    }
  } catch (err) {
    console.warn('Error fetching custom field definitions:', err);
  }
  return fieldNameMap;
}

function extractQuestionsFromCustomFields(customFields: Record<string, any>, fieldNameMap?: Record<string, string>): any[] {
  const questions: any[] = [];
  const skipFields = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'campaign_name', 'ad_set_name', 'ad_id', 'assigned_user', 'source',
    'Campaign Tracker', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term',
  ]);
  // Also skip by resolved name (case-insensitive)
  const skipNamesLower = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'campaign tracker', 'utm source', 'utm medium', 'utm campaign', 'utm content', 'utm term',
    'campaign_name', 'ad_set_name', 'ad_id', 'assigned_user',
  ]);
  
  for (const [key, value] of Object.entries(customFields)) {
    if (value !== null && value !== undefined && value !== '' && !skipFields.has(key)) {
      // Resolve human-readable name: check fieldNameMap, then fallback to key
      const displayName = (fieldNameMap && fieldNameMap[key]) || key;
      
      // Skip UTM/campaign fields by resolved name
      if (skipNamesLower.has(displayName.toLowerCase())) continue;
      
      questions.push({
        question: displayName,
        answer: value,
        source: 'ghl_sync'
      });
    }
  }
  return questions;
}

// Extract UTM parameters from questions array and return filtered questions without UTM entries
function extractUtmFromQuestions(questions: any[]): {
  filteredQuestions: any[];
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
} {
  const utmKeys: Record<string, string> = {
    'utm_source': 'utm_source',
    'utm source': 'utm_source',
    'UTM Source': 'utm_source',
    'Utm Source': 'utm_source',
    'utm_medium': 'utm_medium',
    'utm medium': 'utm_medium',
    'UTM Medium': 'utm_medium',
    'Utm Medium': 'utm_medium',
    'utm_campaign': 'utm_campaign',
    'utm campaign': 'utm_campaign',
    'UTM Campaign': 'utm_campaign',
    'Utm Campaign': 'utm_campaign',
    'utm_content': 'utm_content',
    'utm content': 'utm_content',
    'UTM Content': 'utm_content',
    'Utm Content': 'utm_content',
    'utm_term': 'utm_term',
    'utm term': 'utm_term',
    'UTM Term': 'utm_term',
    'Utm Term': 'utm_term',
  };

  const result: Record<string, string> = {};
  const filteredQuestions: any[] = [];

  for (const q of questions) {
    const questionText = String(q.question || '').trim();
    const utmField = utmKeys[questionText] || utmKeys[questionText.toLowerCase()];
    if (utmField && q.answer) {
      result[utmField] = String(q.answer);
    } else {
      filteredQuestions.push(q);
    }
  }

  return {
    filteredQuestions,
    utm_source: result.utm_source,
    utm_medium: result.utm_medium,
    utm_campaign: result.utm_campaign,
    utm_content: result.utm_content,
    utm_term: result.utm_term,
  };
}

function extractCampaignAttribution(contact: GHLContact, customFields: Record<string, any>, fieldNameMap?: Record<string, string>): {
  campaign_name: string | null;
  ad_set_name: string | null;
  ad_id: string | null;
} {
  // Build a resolved custom fields map: translate GHL internal IDs to human-readable names
  const resolved: Record<string, any> = {};
  for (const [key, value] of Object.entries(customFields)) {
    if (value === null || value === undefined || value === '') continue;
    // Store with original key
    resolved[key] = value;
    // Also store with resolved human-readable name from fieldNameMap
    if (fieldNameMap && fieldNameMap[key]) {
      resolved[fieldNameMap[key]] = value;
    }
  }

  // GHL Page Details field names + common variations
  const campaignFields = [
    'Utm Campaign',      // GHL Page Details
    'utm_campaign',      // Standard
    'Campaign Tracker',  // Common custom field
    'campaign_name',
    'campaign',
    'Campaign Id',       // GHL Page Details (ID, can use as fallback)
    'contact.utm_campaign', // GHL fieldKey format
  ];
  
  const adSetFields = [
    'Utm Medium',        // GHL stores Ad Set name in Utm Medium often
    'utm_medium',        // Standard
    'Adset Id',          // GHL Page Details
    'ad_set_name',
    'Ad Set',
    'ad_set',
    'adset_name',
    'adGroupName',
    'Ad Set Name',
    'contact.utm_medium', // GHL fieldKey format
  ];
  
  const adIdFields = [
    'Utm Content',       // GHL stores Ad name in Utm Content often
    'utm_content',       // Standard
    'Ad Id',             // GHL Page Details
    'ad_id',
    'Ad ID',
    'adId',
    'contact.utm_content', // GHL fieldKey format
  ];
  
  let campaign_name: string | null = null;
  let ad_set_name: string | null = null;
  let ad_id: string | null = null;
  
  // Check resolved custom fields for campaign name
  for (const field of campaignFields) {
    if (resolved[field]) {
      campaign_name = String(resolved[field]);
      console.log(`Found campaign_name in field "${field}": ${campaign_name}`);
      break;
    }
  }
  
  // Check resolved custom fields for ad set name  
  for (const field of adSetFields) {
    if (resolved[field]) {
      ad_set_name = String(resolved[field]);
      console.log(`Found ad_set_name in field "${field}": ${ad_set_name}`);
      break;
    }
  }
  
  // Check resolved custom fields for ad ID/name
  for (const field of adIdFields) {
    if (resolved[field]) {
      ad_id = String(resolved[field]);
      console.log(`Found ad_id in field "${field}": ${ad_id}`);
      break;
    }
  }
  
  // Fallback to attributionSource
  if (!campaign_name && contact.attributionSource?.utm_campaign) {
    campaign_name = contact.attributionSource.utm_campaign;
    console.log(`Using attributionSource.utm_campaign: ${campaign_name}`);
  }
  
  if (!ad_set_name && contact.attributionSource?.utm_medium) {
    ad_set_name = contact.attributionSource.utm_medium;
    console.log(`Using attributionSource.utm_medium as ad_set: ${ad_set_name}`);
  }
  
  if (!ad_id && contact.attributionSource?.utm_content) {
    ad_id = contact.attributionSource.utm_content;
    console.log(`Using attributionSource.utm_content as ad_id: ${ad_id}`);
  }
  
  return { campaign_name, ad_set_name, ad_id };
}

// Extract pipeline value from contact custom fields or opportunities
function extractPipelineValue(contact: GHLContact, opportunity?: GHLOpportunity): number {
  // First check opportunity monetary value
  if (opportunity) {
    const oppValue = opportunity.monetaryValue ?? opportunity.monetary_value ?? 0;
    if (oppValue > 0) return oppValue;
  }
  
  // Check custom fields for capital/investment amounts
  const customFields = parseCustomFields(contact.customFields);
  for (const [key, value] of Object.entries(customFields)) {
    const keyLower = String(key).toLowerCase();
    if (keyLower.includes('capital') || keyLower.includes('deploy') || keyLower.includes('invest') || keyLower.includes('amount')) {
      const numValue = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
      if (!isNaN(numValue) && numValue > 0) {
        return numValue;
      }
    }
  }
  
  return 0;
}

async function syncContactToDatabase(
  supabase: any,
  clientId: string,
  contact: GHLContact,
  opportunity?: GHLOpportunity,
  fieldNameMap?: Record<string, string>
): Promise<{ action: 'created' | 'updated' | 'skipped'; leadId?: string }> {
  const externalId = contact.id;
  const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
  const email = contact.email || null;
  const phone = contact.phone || null;
  
  const customFields = parseCustomFields(contact.customFields);
  const cfCount = Object.keys(customFields).length;
  if (cfCount > 0) {
    console.log(`Contact ${externalId} has ${cfCount} custom fields (raw type: ${Array.isArray(contact.customFields) ? 'array' : typeof contact.customFields})`);
  }
  const rawQuestions = extractQuestionsFromCustomFields(customFields, fieldNameMap);
  const utmFromQuestions = extractUtmFromQuestions(rawQuestions);
  const questions = utmFromQuestions.filteredQuestions;
  
  const campaignAttribution = extractCampaignAttribution(contact, customFields, fieldNameMap);
  
  const attribution = contact.attributionSource || {};
  
  const final_utm_campaign = attribution.utm_campaign || utmFromQuestions.utm_campaign;
  const final_utm_medium = attribution.utm_medium || utmFromQuestions.utm_medium;
  const final_utm_content = attribution.utm_content || utmFromQuestions.utm_content;
  const final_utm_term = attribution.utm_term || utmFromQuestions.utm_term;
  
  const isBadLead = hasBadLeadTag(contact);
  
  let existingLead = null;
  
  const { data: leadByExternalId } = await supabase
    .from('leads')
    .select('id, updated_at, is_spam, external_id, created_at')
    .eq('client_id', clientId)
    .eq('external_id', externalId)
    .maybeSingle();
  
  if (leadByExternalId) {
    existingLead = leadByExternalId;
  } else if (email) {
    const { data: leadByEmail } = await supabase
      .from('leads')
      .select('id, updated_at, is_spam, external_id, created_at')
      .eq('client_id', clientId)
      .eq('email', email)
      .maybeSingle();
    
    if (leadByEmail) {
      existingLead = leadByEmail;
      console.log(`Matched GHL contact ${externalId} to existing lead ${leadByEmail.id} by email: ${email}`);
    }
  }
  
  if (!existingLead && phone) {
    const { data: leadByPhone } = await supabase
      .from('leads')
      .select('id, updated_at, is_spam, external_id, created_at')
      .eq('client_id', clientId)
      .eq('phone', phone)
      .maybeSingle();
    
    if (leadByPhone) {
      existingLead = leadByPhone;
      console.log(`Matched GHL contact ${externalId} to existing lead ${leadByPhone.id} by phone: ${phone}`);
    }
  }

  // Use GHL dateAdded for lead creation date if creating new lead
  let ghlCreatedAt = new Date().toISOString();
  if (contact.dateAdded) {
    try {
      const parsedDate = new Date(contact.dateAdded);
      if (!isNaN(parsedDate.getTime())) {
        ghlCreatedAt = parsedDate.toISOString();
        console.log(`Using GHL dateAdded for contact ${externalId}: ${contact.dateAdded} -> ${ghlCreatedAt}`);
      }
    } catch (e) {
      console.error(`Failed to parse GHL dateAdded for contact ${externalId}: ${contact.dateAdded}`);
    }
  } else {
    console.log(`No dateAdded for contact ${externalId}, using current time`);
  }

  // Extract opportunity data if available
  const opportunityStatus = opportunity?.status || null;
  const opportunityStage = opportunity?.stageName || opportunity?.pipelineStageName || null;
  const opportunityStageId = opportunity?.pipelineStageId || null;
  const opportunityValue = opportunity?.monetaryValue ?? opportunity?.monetary_value ?? 0;
  
  // Extract pipeline value from opportunity or custom fields
  const pipelineValue = extractPipelineValue(contact, opportunity);

  // --- NORMALIZE SOURCE ---
  // Apply source normalization to utm_source
  const raw_utm_source = attribution.utm_source || contact.source || null;
  const normalized_utm_source = normalizeSourceValue(raw_utm_source, campaignAttribution.campaign_name);

  const leadData: Record<string, any> = {
    client_id: clientId,
    external_id: externalId,
    name,
    email,
    phone,
    source: contact.source || 'ghl_sync',
    custom_fields: customFields,
    questions,
    utm_source: normalized_utm_source,
    utm_medium: final_utm_medium || null,
    utm_campaign: final_utm_campaign || null,
    utm_content: final_utm_content || null,
    utm_term: final_utm_term || null,
    campaign_name: campaignAttribution.campaign_name,
    ad_set_name: campaignAttribution.ad_set_name,
    ad_id: campaignAttribution.ad_id,
    opportunity_status: opportunityStatus,
    opportunity_stage: opportunityStage,
    opportunity_stage_id: opportunityStageId,
    opportunity_value: opportunityValue,
    pipeline_value: pipelineValue,
    updated_at: new Date().toISOString(),
  };

  if (isBadLead) {
    leadData.is_spam = true;
    console.log(`Marking contact ${externalId} as bad lead (tag detected)`);
  }

  // Use UPSERT with the new unique constraint on (client_id, external_id)
  // This prevents duplicates regardless of source
  const upsertData: Record<string, any> = {
    client_id: clientId,
    external_id: externalId,
    name,
    email,
    phone,
    source: contact.source || 'ghl_sync',
    custom_fields: customFields,
    questions,
    utm_source: normalized_utm_source,
    utm_medium: final_utm_medium || null,
    utm_campaign: final_utm_campaign || null,
    utm_content: final_utm_content || null,
    utm_term: final_utm_term || null,
    campaign_name: campaignAttribution.campaign_name,
    ad_set_name: campaignAttribution.ad_set_name,
    ad_id: campaignAttribution.ad_id,
    opportunity_status: opportunityStatus,
    opportunity_stage: opportunityStage,
    opportunity_stage_id: opportunityStageId,
    opportunity_value: opportunityValue,
    pipeline_value: pipelineValue,
    is_spam: isBadLead,
    ghl_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // For new leads, set created_at from GHL dateAdded
  // For existing leads, we don't want to overwrite created_at
  if (!existingLead) {
    upsertData.created_at = ghlCreatedAt;
    upsertData.status = 'new';
  }

  const { data: upsertedLead, error } = await supabase
    .from('leads')
    .upsert(upsertData, { 
      onConflict: 'client_id,external_id',
      ignoreDuplicates: false 
    })
    .select('id')
    .single();

  if (error) {
    console.error(`Failed to upsert lead for contact ${externalId}:`, error);
    return { action: 'skipped' };
  }
  
  return { 
    action: existingLead ? 'updated' : 'created', 
    leadId: upsertedLead.id 
  };
}

async function createFundedInvestorFromContact(
  supabase: any,
  clientId: string,
  contact: GHLContact,
  leadId: string | null,
  opportunity?: GHLOpportunity
): Promise<boolean> {
  const externalId = contact.id;
  
  // Check if already exists
  const { data: existingFunded } = await supabase
    .from('funded_investors')
    .select('id')
    .eq('client_id', clientId)
    .eq('external_id', externalId)
    .maybeSingle();
  
  if (existingFunded) {
    return false; // Already exists
  }
  
  // Extract funded amount from opportunity or contact custom fields
  const fundedAmount = extractPipelineValue(contact, opportunity);
  
  // Determine funded date - prefer opportunity's lastStageChangeAt, then contact's dateUpdated
  let fundedAt = new Date().toISOString();
  if (opportunity?.lastStageChangeAt) {
    fundedAt = opportunity.lastStageChangeAt;
  } else if (contact.dateUpdated) {
    fundedAt = contact.dateUpdated;
  } else if (opportunity?.dateAdded) {
    fundedAt = opportunity.dateAdded;
  }
  
  // Get lead creation date for first_contact_at
  let firstContactAt: string | null = null;
  let timeToFundDays: number | null = null;
  let callsToFund = 0;
  
  if (leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('created_at')
      .eq('id', leadId)
      .maybeSingle();
    
    if (lead?.created_at) {
      firstContactAt = lead.created_at;
      const leadDate = new Date(lead.created_at);
      const fundDate = new Date(fundedAt);
      timeToFundDays = Math.floor((fundDate.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24));
    }
    
    const { count } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadId);
    callsToFund = count || 0;
  }
  
  const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
  
  const { error } = await supabase.from('funded_investors').insert({
    client_id: clientId,
    external_id: externalId,
    name,
    lead_id: leadId,
    funded_amount: fundedAmount,
    funded_at: fundedAt,
    first_contact_at: firstContactAt,
    time_to_fund_days: timeToFundDays,
    calls_to_fund: callsToFund,
    source: 'tag_sync',
  });
  
  if (error) {
    console.error(`Failed to create funded investor for contact ${externalId}:`, error);
    return false;
  }
  
  console.log(`Created funded investor from tag: ${name} ($${fundedAmount})`);
  return true;
}

// Discrepancy detection removed - webhooks are frozen, using API-only sync

// Sync pipeline opportunities incrementally (for hourly sync)
// Creates funded investors from opportunities in configured funded stages
async function syncPipelineOpportunitiesIncremental(
  supabase: any,
  client: { id: string; name: string; ghl_api_key: string; ghl_location_id: string },
  fundedPipelineId: string | null,
  fundedStageIds: string[],
  committedStageIds: string[]
): Promise<{ funded: number; committed: number; opportunitiesProcessed: number; errors: string[] }> {
  const result = { funded: 0, committed: 0, opportunitiesProcessed: 0, errors: [] as string[] };
  
  if (!fundedPipelineId || (fundedStageIds.length === 0 && committedStageIds.length === 0)) {
    return result;
  }
  
  console.log(`Incremental pipeline sync for ${client.name}: pipeline=${fundedPipelineId}, fundedStages=${fundedStageIds.length}, committedStages=${committedStageIds.length}`);
  
  const headers = {
    'Authorization': `Bearer ${client.ghl_api_key}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
  
  try {
    // Fetch opportunities from the configured pipeline (up to 500 for incremental sync)
    const allOpportunities: any[] = [];
    let hasMore = true;
    let startAfterId: string | null = null;
    const MAX_PAGES = 50;
    let pageCount = 0;
    const seenOppIds = new Set<string>();
    
    while (hasMore && pageCount < MAX_PAGES) {
      // Use /opportunities/search endpoint with snake_case params (not /opportunities/)
      let url = `${GHL_BASE_URL}/opportunities/search?location_id=${client.ghl_location_id}&pipeline_id=${fundedPipelineId}&limit=100`;
      if (startAfterId) {
        url += `&startAfter=${startAfterId}&startAfterId=${startAfterId}`;
      }
      
      const response = await fetch(url, { method: 'GET', headers });
      
      if (!response.ok) {
        console.error(`GHL opportunities fetch error: ${response.status}`);
        result.errors.push(`Failed to fetch opportunities: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      const opportunities = data.opportunities || [];
      
      // Deduplicate
      const newOpps = opportunities.filter((o: any) => !seenOppIds.has(o.id));
      if (newOpps.length === 0 && opportunities.length > 0) {
        console.log(`Incremental sync: pagination not advancing, stopping after ${pageCount} pages`);
        hasMore = false;
        break;
      }
      for (const o of opportunities) seenOppIds.add(o.id);
      allOpportunities.push(...newOpps);
      
      // Pagination
      const meta = data.meta || {};
      startAfterId = meta.startAfterId || meta.startAfter || null;
      if (!startAfterId && opportunities.length >= 100) {
        startAfterId = opportunities[opportunities.length - 1]?.id;
      }
      if (!startAfterId || opportunities.length < 100) hasMore = false;
      
      pageCount++;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    console.log(`Fetched ${allOpportunities.length} opportunities from pipeline for ${client.name}`);
    
    for (const opp of allOpportunities) {
      result.opportunitiesProcessed++;
      
      const contactId = opp.contactId || opp.contact?.id;
      const stageId = opp.pipelineStageId;
      const monetaryValue = opp.monetaryValue || opp.monetary_value || 0;
      const stageName = opp.pipelineStageName || opp.stageName || '';
      const status = opp.status || 'open';
      
      // Update the lead with opportunity data if contact exists
      if (contactId) {
        await supabase
          .from('leads')
          .update({
            opportunity_status: status,
            opportunity_stage: stageName,
            opportunity_stage_id: stageId,
            opportunity_value: monetaryValue,
            ghl_synced_at: new Date().toISOString(),
          })
          .eq('client_id', client.id)
          .eq('external_id', contactId);
      }
      
      // Check if this is a funded stage
      if (stageId && fundedStageIds.includes(stageId)) {
        // Always use contactId for dedup consistency with tag-based path
        const externalId = contactId || opp.id;
        
        // Check if funded_investor already exists (by contactId)
        const { data: existing } = await supabase
          .from('funded_investors')
          .select('id')
          .eq('client_id', client.id)
          .eq('external_id', externalId)
          .maybeSingle();
        
        if (!existing) {
          // Create new funded investor
          let fundedAt = opp.lastStageChangeAt || opp.dateUpdated || opp.dateAdded || new Date().toISOString();
          
          let leadId: string | null = null;
          let firstContactAt: string | null = null;
          let timeToFundDays: number | null = null;
          let callsToFund = 0;
          
          if (contactId) {
            const { data: lead } = await supabase
              .from('leads')
              .select('id, created_at')
              .eq('client_id', client.id)
              .eq('external_id', contactId)
              .maybeSingle();
            
            if (lead) {
              leadId = lead.id;
              firstContactAt = lead.created_at;
              if (lead.created_at) {
                timeToFundDays = Math.floor((new Date(fundedAt).getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24));
              }
              
              const { count } = await supabase
                .from('calls')
                .select('*', { count: 'exact', head: true })
                .eq('lead_id', lead.id);
              callsToFund = count || 0;
            }
          }
          
          const name = opp.name || opp.contact?.name || 'Unknown';
          
          const { error: insertError } = await supabase.from('funded_investors').insert({
            client_id: client.id,
            external_id: externalId,
            name,
            lead_id: leadId,
            funded_amount: monetaryValue,
            funded_at: fundedAt,
            first_contact_at: firstContactAt,
            time_to_fund_days: timeToFundDays,
            calls_to_fund: callsToFund,
            source: 'pipeline_stage',
          });
          
          if (!insertError) {
            result.funded++;
            console.log(`Created funded investor: ${name} ($${monetaryValue})`);
          }
        }
      }
      
      // Check if this is a committed stage (create commitment record)
      if (stageId && committedStageIds.includes(stageId)) {
        const externalId = contactId || opp.id;
        
        // Check if record already exists
        const { data: existing } = await supabase
          .from('funded_investors')
          .select('id, commitment_amount')
          .eq('client_id', client.id)
          .eq('external_id', externalId)
          .maybeSingle();
        
        if (!existing) {
          // Create new committed investor record
          let commitmentAt = opp.lastStageChangeAt || opp.dateUpdated || opp.dateAdded || new Date().toISOString();
          
          let leadId: string | null = null;
          if (contactId) {
            const { data: lead } = await supabase
              .from('leads')
              .select('id')
              .eq('client_id', client.id)
              .eq('external_id', contactId)
              .maybeSingle();
            
            if (lead) {
              leadId = lead.id;
            }
          }
          
          const name = opp.name || opp.contact?.name || 'Unknown';
          
          const { error: insertError } = await supabase.from('funded_investors').insert({
            client_id: client.id,
            external_id: externalId,
            name,
            lead_id: leadId,
            commitment_amount: monetaryValue,
            funded_amount: 0,
            funded_at: commitmentAt,
            source: 'commitment_stage',
          });
          
          if (!insertError) {
            result.committed++;
            console.log(`Created committed investor: ${name} ($${monetaryValue})`);
          }
        } else if (existing && !existing.commitment_amount && monetaryValue > 0) {
          // Update existing record with commitment amount
          await supabase
            .from('funded_investors')
            .update({ commitment_amount: monetaryValue })
            .eq('id', existing.id);
        }
      }
    }
  } catch (err) {
    result.errors.push(`Pipeline sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    console.error(`Pipeline sync error for ${client.name}:`, err);
  }
  
  console.log(`Pipeline sync complete for ${client.name}: funded=${result.funded}, committed=${result.committed}`);
  return result;
}

async function syncClientContacts(
  supabase: any,
  client: { id: string; name: string; ghl_api_key: string; ghl_location_id: string },
  syncLogId?: string,
  sinceDateDays?: number,
  syncTimeline: boolean = false,
  lightweightLeadSync: boolean = false
): Promise<{ created: number; updated: number; skipped: number; fundedFromTags: number; fundedFromPipeline: number; committedFromPipeline: number; callsCreated: number; callsUpdated: number; errors: string[]; totalApiContacts: number; contactsInDateRange: number; timelineSynced: number }> {
  const result = { created: 0, updated: 0, skipped: 0, fundedFromTags: 0, fundedFromPipeline: 0, committedFromPipeline: 0, callsCreated: 0, callsUpdated: 0, errors: [] as string[], totalApiContacts: 0, contactsInDateRange: 0, timelineSynced: 0 };
  
  console.log(`Starting GHL sync for client: ${client.name} (${client.id}), sinceDateDays: ${sinceDateDays || 'all'}, syncTimeline: ${syncTimeline}`);
  
// Fetch client settings for pipeline and calendar configuration
  const { data: settings } = await supabase
    .from('client_settings')
    .select('funded_pipeline_id, funded_stage_ids, committed_stage_ids, tracked_calendar_ids, reconnect_calendar_ids')
    .eq('client_id', client.id)
    .maybeSingle();
  
  const fundedPipelineId: string | null = settings?.funded_pipeline_id || null;
  const fundedStageIds: string[] = settings?.funded_stage_ids || [];
  const committedStageIds: string[] = settings?.committed_stage_ids || [];
  const trackedCalendarIds: string[] = settings?.tracked_calendar_ids || [];
  const reconnectCalendarIds: string[] = settings?.reconnect_calendar_ids || [];
  
  // Fetch opportunities to match with contacts for funded investor creation
  // For lightweight daily lead sync, skip heavy pipeline fetches.
  const opportunityByContactId = new Map<string, GHLOpportunity>();
  if (!lightweightLeadSync) {
    try {
      const opportunities = await fetchGHLOpportunities(client.ghl_api_key, client.ghl_location_id);
      for (const opp of opportunities) {
        if (opp.contactId) {
          opportunityByContactId.set(opp.contactId, opp);
        }
      }
      console.log(`Fetched ${opportunities.length} opportunities for ${client.name}`);
    } catch (err) {
      console.error(`Failed to fetch opportunities for ${client.name}, continuing without pipeline data:`, err);
      result.errors.push(`Pipeline fetch failed (non-blocking): ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  } else {
    console.log(`Lightweight lead sync enabled for ${client.name}: skipping opportunities/calendar/metrics phases`);
  }
  
  let hasMore = true;
  let currentPage = 1;
  let totalProcessed = 0;
  const MAX_CONTACTS = syncTimeline ? 500 : 50000; // Higher limit for larger accounts
  
  // Calculate cutoff date if sinceDateDays is specified
  const cutoffDate = sinceDateDays ? new Date(Date.now() - sinceDateDays * 24 * 60 * 60 * 1000) : null;
  
  // Fetch custom field definitions once for this client
  const fieldNameMap = await fetchGHLCustomFieldDefinitions(client.ghl_api_key, client.ghl_location_id);

  // Track contacts that need timeline sync
  const contactsForTimeline: string[] = [];

  try {
    while (hasMore && totalProcessed < MAX_CONTACTS) {
      const { contacts, nextPage, total } = await fetchGHLContacts(
        client.ghl_api_key,
        client.ghl_location_id,
        100,
        undefined,
        currentPage
      );

      if (totalProcessed === 0 && total) {
        console.log(`Total contacts in GHL for ${client.name}: ${total}`);
      }
      console.log(`Fetched page ${currentPage}: ${contacts.length} contacts for ${client.name}`);

      if (contacts.length === 0) {
        hasMore = false;
        break;
      }

      for (const contact of contacts) {
        
        // If sinceDateDays is set and contact is older than cutoff, skip (but count for total)
        if (cutoffDate && contact.dateAdded) {
          const contactDate = new Date(contact.dateAdded);
          if (contactDate < cutoffDate) {
            result.skipped++;
            totalProcessed++;
            continue;
          }
        }
        
        try {
          // Get opportunity for this contact to sync opportunity data
          const contactOpportunity = opportunityByContactId.get(contact.id);
          const syncResult = await syncContactToDatabase(supabase, client.id, contact, contactOpportunity, fieldNameMap);
          if (syncResult.action === 'created') result.created++;
          else if (syncResult.action === 'updated') result.updated++;
          else result.skipped++;
          
          // Queue for timeline sync if requested
          if (syncTimeline && contact.id) {
            contactsForTimeline.push(contact.id);
          }
          
          // Check if contact has funded investor tag
          if (hasFundedInvestorTag(contact)) {
            const opp = opportunityByContactId.get(contact.id);
            const created = await createFundedInvestorFromContact(
              supabase, 
              client.id, 
              contact, 
              syncResult.leadId || null,
              opp
            );
            if (created) result.fundedFromTags++;
          }
        } catch (err) {
          result.errors.push(`Contact ${contact.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          result.skipped++;
        }
        totalProcessed++;
      }

      if (nextPage) {
        currentPage = nextPage;
      } else {
        hasMore = false;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    result.totalApiContacts = totalProcessed;
    result.contactsInDateRange = totalProcessed;
    
    // Sync timeline for queued contacts (in batches to avoid timeout)
    if (syncTimeline && contactsForTimeline.length > 0) {
      console.log(`Syncing timeline for ${contactsForTimeline.length} contacts...`);
      
      // Process in batches of 10 to avoid API rate limits
      const BATCH_SIZE = 10;
      for (let i = 0; i < contactsForTimeline.length; i += BATCH_SIZE) {
        const batch = contactsForTimeline.slice(i, i + BATCH_SIZE);
        
        await Promise.allSettled(
          batch.map(async (contactId) => {
            try {
              const timelineResult = await syncContactDeepTimeline(
                supabase,
                client.id,
                contactId,
                client.ghl_api_key,
                client.ghl_location_id
              );
              if (timelineResult.success) {
                result.timelineSynced++;
              }
            } catch (err) {
              console.error(`Timeline sync error for ${contactId}:`, err);
            }
          })
        );
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Update last_timeline_sync_at for client
      await supabase
        .from('clients')
        .update({ last_timeline_sync_at: new Date().toISOString() })
        .eq('id', client.id);
    }
    
    // HOURLY PIPELINE SYNC: Sync pipeline opportunities to create funded/committed investors
    // Skip this in lightweight lead-only sync mode
    if (!lightweightLeadSync && fundedPipelineId) {
      console.log(`Running incremental pipeline sync for ${client.name}...`);
      const pipelineResult = await syncPipelineOpportunitiesIncremental(
        supabase,
        client,
        fundedPipelineId,
        fundedStageIds,
        committedStageIds
      );
      result.fundedFromPipeline = pipelineResult.funded;
      result.committedFromPipeline = pipelineResult.committed;
      if (pipelineResult.errors.length > 0) {
        result.errors.push(...pipelineResult.errors);
      }
    }
    
    // HOURLY CALENDAR SYNC: Sync appointments from configured calendars
    // Skip this in lightweight lead-only sync mode
    if (!lightweightLeadSync && (trackedCalendarIds.length > 0 || reconnectCalendarIds.length > 0)) {
      console.log(`Running incremental calendar sync for ${client.name}: tracked=${trackedCalendarIds.length}, reconnect=${reconnectCalendarIds.length}`);
      try {
        const callResult = await syncAllCalendarAppointments(
          supabase,
          client,
          trackedCalendarIds,
          reconnectCalendarIds
        );
        result.callsCreated = callResult.created;
        result.callsUpdated = callResult.updated;
        if (callResult.errors.length > 0) {
          result.errors.push(...callResult.errors);
        }
        console.log(`Calendar sync for ${client.name}: ${callResult.created} calls created, ${callResult.updated} updated, ${callResult.reconnects} reconnects`);
      } catch (err) {
        console.error(`Calendar sync error for ${client.name}:`, err);
        result.errors.push(`Calendar sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
    // HOURLY METRICS UPDATE: Recalculate daily_metrics for recent days
    // Skip this in lightweight lead-only sync mode
    if (!lightweightLeadSync) {
      console.log(`Recalculating recent daily_metrics for ${client.name}...`);
      try {
        const metricsResult = await recalculateRecentMetrics(supabase, client.id, 7); // Last 7 days
        console.log(`Metrics update for ${client.name}: ${metricsResult.daysUpdated} days updated`);
        if (metricsResult.errors.length > 0) {
          result.errors.push(...metricsResult.errors.slice(0, 3));
        }
      } catch (err) {
        console.error(`Metrics recalculation error for ${client.name}:`, err);
        result.errors.push(`Metrics recalc failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Sync failed: ${errorMsg}`);
    console.error(`GHL sync error for ${client.name}:`, errorMsg);
  }
  
  // Update sync status on client
  try {
    await supabase
      .from('clients')
      .update({
        last_ghl_sync_at: new Date().toISOString(),
        ghl_sync_status: result.errors.length > 0 ? 'error' : 'healthy',
        ghl_sync_error: result.errors.length > 0 ? result.errors.slice(0, 3).join('; ') : null,
      })
      .eq('id', client.id);
  } catch (err) {
    console.error(`Error updating client sync status:`, err);
  }

  console.log(`GHL sync complete for ${client.name}: created=${result.created}, updated=${result.updated}, skipped=${result.skipped}, fundedFromTags=${result.fundedFromTags}, fundedFromPipeline=${result.fundedFromPipeline}, committedFromPipeline=${result.committedFromPipeline}, callsCreated=${result.callsCreated}, callsUpdated=${result.callsUpdated}, timelineSynced=${result.timelineSynced}`);
  return result;
}

// Fetch a single contact from GHL by ID
async function fetchSingleGHLContact(
  apiKey: string,
  contactId: string
): Promise<GHLContact | null> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    const response = await fetchWithRetry(`${GHL_BASE_URL}/contacts/${contactId}`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      console.error(`GHL single contact fetch error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.contact || null;
  } catch (err) {
    console.error('Error fetching single GHL contact:', err);
    return null;
  }
}

// Fetch notes for a GHL contact
async function fetchGHLNotes(
  apiKey: string,
  contactId: string
): Promise<GHLNote[]> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    const response = await fetchWithRetry(`${GHL_BASE_URL}/contacts/${contactId}/notes`, {
      method: 'GET',
      headers
    });
    
    if (!response.ok) {
      console.error(`GHL notes fetch error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.notes || [];
  } catch (err) {
    console.error('Error fetching GHL notes:', err);
    return [];
  }
}

// Fetch tasks for a GHL contact
async function fetchGHLTasks(
  apiKey: string,
  contactId: string
): Promise<any[]> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    const response = await fetchWithRetry(`${GHL_BASE_URL}/contacts/${contactId}/tasks`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      console.error(`GHL tasks fetch error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.tasks || [];
  } catch (err) {
    console.error('Error fetching GHL tasks:', err);
    return [];
  }
}

// Fetch appointments for a GHL contact
async function fetchGHLAppointments(
  apiKey: string,
  contactId: string
): Promise<any[]> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  try {
    const response = await fetchWithRetry(`${GHL_BASE_URL}/contacts/${contactId}/appointments`, {
      method: 'GET',
      headers
    });
    
    if (!response.ok) {
      console.error(`GHL appointments fetch error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.appointments || data.events || [];
  } catch (err) {
    console.error('Error fetching GHL appointments:', err);
    return [];
  }
}

// Fetch conversation messages for a GHL contact (SMS, Email, Call logs)
async function fetchGHLConversationMessages(
  apiKey: string,
  locationId: string,
  contactId: string
): Promise<any[]> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };

  const messages: any[] = [];

  try {
    // Search for conversations with this contact
    const searchResponse = await fetch(
      `${GHL_BASE_URL}/conversations/search?locationId=${locationId}&contactId=${contactId}`, 
      { method: 'GET', headers }
    );
    
    if (!searchResponse.ok) {
      console.error(`GHL conversations search error: ${searchResponse.status}`);
      return [];
    }

    const searchData = await searchResponse.json();
    const conversations = searchData.conversations || [];

    // For each conversation, get the messages
    for (const conv of conversations.slice(0, 5)) { // Limit to 5 conversations
      try {
        const messagesResponse = await fetch(
          `${GHL_BASE_URL}/conversations/${conv.id}/messages?limit=50`,
          { method: 'GET', headers }
        );

        if (messagesResponse.ok) {
          const messagesData = await messagesResponse.json();
          const convMessages = Array.isArray(messagesData.messages) 
            ? messagesData.messages 
            : Array.isArray(messagesData) ? messagesData : [];
          
          for (const msg of convMessages) {
            messages.push({
              ...msg,
              conversationType: conv.type,
            });
          }
        }
      } catch (err) {
        console.error(`Error fetching messages for conversation ${conv.id}:`, err);
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (err) {
    console.error('Error fetching GHL conversations:', err);
  }

  return messages;
}

// Link orphaned calls to their corresponding leads by matching external_id
// Also copies contact details from the lead to the call for display
async function linkOrphanedCallsToLeads(
  supabase: any,
  clientId: string
): Promise<{ linked: number; errors: string[] }> {
  const result = { linked: 0, errors: [] as string[] };
  
  // Find calls without lead_id
  const { data: orphanedCalls, error: fetchError } = await supabase
    .from('calls')
    .select('id, external_id')
    .eq('client_id', clientId)
    .is('lead_id', null);
  
  if (fetchError || !orphanedCalls) {
    result.errors.push(`Failed to fetch orphaned calls: ${fetchError?.message}`);
    return result;
  }
  
  console.log(`Found ${orphanedCalls.length} orphaned calls for client ${clientId}`);
  
  // Batch fetch all leads for this client to avoid N+1 queries
  const { data: leads } = await supabase
    .from('leads')
    .select('id, external_id, name, email, phone')
    .eq('client_id', clientId)
    .not('external_id', 'is', null);
  
  const leadsByExternalId = new Map<string, { id: string; name: string | null; email: string | null; phone: string | null }>();
  for (const lead of leads || []) {
    if (lead.external_id) {
      leadsByExternalId.set(lead.external_id, {
        id: lead.id,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
      });
    }
  }
  
  for (const call of orphanedCalls) {
    const matchingLead = leadsByExternalId.get(call.external_id);
    
    if (matchingLead) {
      // Update call with lead_id AND copy contact details for display
      const { error: updateError } = await supabase
        .from('calls')
        .update({ 
          lead_id: matchingLead.id,
          contact_name: matchingLead.name,
          contact_email: matchingLead.email,
          contact_phone: matchingLead.phone,
          ghl_synced_at: new Date().toISOString()
        })
        .eq('id', call.id);
      
      if (!updateError) {
        result.linked++;
      } else {
        result.errors.push(`Failed to link call ${call.id}: ${updateError.message}`);
      }
    }
  }
  
  console.log(`Linked ${result.linked} orphaned calls to leads`);
  return result;
}

// Sync GHL appointments as call records with proper lead linkage
async function syncAppointmentsAsCalls(
  supabase: any,
  clientId: string,
  contactId: string,
  leadId: string | null,
  apiKey: string
): Promise<{ created: number; updated: number }> {
  const result = { created: 0, updated: 0 };
  
  // Fetch appointments for this contact
  const appointments = await fetchGHLAppointments(apiKey, contactId);
  
  for (const appt of appointments) {
    const appointmentId = appt.id;
    const calendarId = appt.calendarId;
    const status = (appt.status || appt.appointmentStatus || '').toLowerCase();
    
    // Map GHL appointment status to our call outcome
    let outcome = 'booked';
    let showed = false;
    
    if (status === 'showed' || status === 'completed') {
      outcome = 'showed';
      showed = true;
    } else if (status === 'noshow' || status === 'no-show' || status === 'no_show') {
      outcome = 'no_show';
      showed = false;
    } else if (status === 'cancelled' || status === 'canceled') {
      outcome = 'cancelled';
      showed = false;
    } else if (status === 'confirmed') {
      outcome = 'booked';
      showed = false;
    }
    
    // Use GHL dateAdded as the creation date for proper chronological ordering
    const ghlCreatedAt = appt.dateAdded || appt.createdAt || new Date().toISOString();
    
    const callData = {
      client_id: clientId,
      lead_id: leadId,
      external_id: contactId,
      ghl_appointment_id: appointmentId,
      ghl_calendar_id: calendarId,
      scheduled_at: appt.startTime || appt.dateAdded,
      appointment_status: status,
      showed,
      outcome,
      booked_at: ghlCreatedAt,
      created_at: ghlCreatedAt, // Use GHL creation date, NOT current time
      ghl_synced_at: new Date().toISOString(),
    };
    
    // Check if call already exists by appointment ID
    const { data: existingCall } = await supabase
      .from('calls')
      .select('id')
      .eq('client_id', clientId)
      .eq('ghl_appointment_id', appointmentId)
      .maybeSingle();
    
    if (existingCall) {
      // Update existing call
      const { error: updateError } = await supabase
        .from('calls')
        .update({
          lead_id: leadId,
          scheduled_at: callData.scheduled_at,
          appointment_status: callData.appointment_status,
          showed: callData.showed,
          outcome: callData.outcome,
          ghl_synced_at: new Date().toISOString(),
        })
        .eq('id', existingCall.id);
      
      if (!updateError) result.updated++;
    } else {
      // Create new call record
      const { error: insertError } = await supabase
        .from('calls')
        .insert(callData);
      
      if (!insertError) result.created++;
    }
  }
  
  return result;
}

// Handle single contact sync mode - comprehensive: contact info, fields, pipelines, value, timelines
async function syncSingleContact(
  supabase: any,
  clientId: string,
  contactId: string,
  apiKey: string
): Promise<{ success: boolean; contact?: any; notes?: GHLNote[]; timeline_events?: number; calls_synced?: number; opportunity_synced?: boolean; error?: string }> {
  console.log(`Single contact sync (comprehensive): fetching contact ${contactId} for client ${clientId}`);
  
  // Fetch client settings for pipeline config
  const { data: clientRow } = await supabase
    .from('clients')
    .select('ghl_location_id')
    .eq('id', clientId)
    .maybeSingle();
  
  const locationId = clientRow?.ghl_location_id || '';
  
  const { data: settings } = await supabase
    .from('client_settings')
    .select('funded_pipeline_id, funded_stage_ids, committed_stage_ids')
    .eq('client_id', clientId)
    .maybeSingle();
  
  const fundedPipelineId = settings?.funded_pipeline_id || null;
  const fundedStageIds: string[] = settings?.funded_stage_ids || [];
  const committedStageIds: string[] = settings?.committed_stage_ids || [];
  
  // Fetch contact + notes + appointments + custom field definitions in parallel
  const [contact, notes, appointments, fieldNameMap] = await Promise.all([
    fetchSingleGHLContact(apiKey, contactId),
    fetchGHLNotes(apiKey, contactId),
    fetchGHLAppointments(apiKey, contactId),
    fetchGHLCustomFieldDefinitions(apiKey, locationId),
  ]);
  
  if (!contact) {
    return { success: false, error: 'Contact not found in GHL' };
  }
  
  console.log(`Found GHL contact: ${contact.name || contact.firstName || 'Unknown'}, notes: ${notes.length}, appointments: ${appointments.length}`);
  
  // --- 1. Fetch opportunity data for this contact ---
  let contactOpportunity: GHLOpportunity | undefined;
  let opportunitySynced = false;
  
  try {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    };
    
    // Search opportunities by contact ID
    const oppResponse = await fetch(
      `${GHL_BASE_URL}/opportunities/search?location_id=${locationId}&contact_id=${contactId}&limit=100`,
      { method: 'GET', headers }
    );
    
    if (oppResponse.ok) {
      const oppData = await oppResponse.json();
      const opportunities = oppData.opportunities || [];
      
      if (opportunities.length > 0) {
        // Use the most recent opportunity
        contactOpportunity = opportunities[0];
        opportunitySynced = true;
        console.log(`Found ${opportunities.length} opportunities for contact ${contactId}`);
        
        // Process each opportunity for funded/committed investor creation
        for (const opp of opportunities) {
          const stageId = opp.pipelineStageId;
          const monetaryValue = opp.monetaryValue || opp.monetary_value || 0;
          const externalId = contactId;
          
          // Check funded stages
          if (stageId && fundedStageIds.includes(stageId)) {
            const { data: existing } = await supabase
              .from('funded_investors')
              .select('id')
              .eq('client_id', clientId)
              .eq('external_id', externalId)
              .maybeSingle();
            
            if (!existing) {
              const fundedAt = opp.lastStageChangeAt || opp.dateUpdated || opp.dateAdded || new Date().toISOString();
              const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
              
              await supabase.from('funded_investors').insert({
                client_id: clientId,
                external_id: externalId,
                name,
                funded_amount: monetaryValue,
                funded_at: fundedAt,
                source: 'pipeline_stage',
              });
              console.log(`Created funded investor from single sync: ${name} ($${monetaryValue})`);
            }
          }
          
          // Check committed stages
          if (stageId && committedStageIds.includes(stageId)) {
            const { data: existing } = await supabase
              .from('funded_investors')
              .select('id')
              .eq('client_id', clientId)
              .eq('external_id', externalId)
              .maybeSingle();
            
            if (!existing) {
              const commitAt = opp.lastStageChangeAt || opp.dateUpdated || opp.dateAdded || new Date().toISOString();
              const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown';
              
              await supabase.from('funded_investors').insert({
                client_id: clientId,
                external_id: externalId,
                name,
                commitment_amount: monetaryValue,
                funded_amount: 0,
                funded_at: commitAt,
                source: 'commitment_stage',
              });
              console.log(`Created committed investor from single sync: ${name} ($${monetaryValue})`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Error fetching opportunities for single contact:', err);
  }
  
  // --- 2. Sync contact to database (with opportunity data) ---
  const syncResult = await syncContactToDatabase(supabase, clientId, contact, contactOpportunity, fieldNameMap);
  
  // Update ghl_synced_at timestamp and ghl_notes for lead
  const { data: updatedLead, error: updateError } = await supabase
    .from('leads')
    .update({ 
      ghl_synced_at: new Date().toISOString(),
      ghl_notes: notes.length > 0 ? notes : []
    })
    .eq('client_id', clientId)
    .eq('external_id', contactId)
    .select('id, name, ghl_synced_at, ghl_notes')
    .maybeSingle();
  
  if (updateError) {
    console.error('Error updating lead with sync data:', updateError);
  }
  
  const leadId = updatedLead?.id || syncResult.leadId || null;
  
  // --- 3. Sync appointments as call records ---
  let callsSynced = 0;
  try {
    const callResult = await syncAppointmentsAsCalls(supabase, clientId, contactId, leadId, apiKey);
    callsSynced = callResult.created + callResult.updated;
    console.log(`Synced ${callsSynced} appointments as calls for contact ${contactId}`);
  } catch (err) {
    console.error('Error syncing appointments for single contact:', err);
  }
  
  // Also update any existing calls associated with this contact with contact details
  const contactName = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
  await supabase
    .from('calls')
    .update({ 
      ghl_synced_at: new Date().toISOString(),
      contact_name: contactName || undefined,
      contact_email: contact.email || undefined,
      contact_phone: contact.phone || undefined,
    })
    .eq('client_id', clientId)
    .or(`external_id.eq.${contactId}${leadId ? `,lead_id.eq.${leadId}` : ''}`);
  
  // --- 4. Sync full timeline (notes, tasks, appointments, messages) ---
  let timelineEvents = 0;
  try {
    if (locationId) {
      const timelineResult = await syncContactDeepTimeline(supabase, clientId, contactId, apiKey, locationId);
      timelineEvents = timelineResult.events_count;
      console.log(`Synced ${timelineEvents} timeline events for contact ${contactId}`);
    }
  } catch (err) {
    console.error('Error syncing timeline for single contact:', err);
  }
  
  console.log(`Comprehensive single contact sync complete: ${syncResult.action}, notes: ${notes.length}, calls: ${callsSynced}, timeline: ${timelineEvents}, opportunity: ${opportunitySynced}`);
  
  return { 
    success: true, 
    contact: updatedLead || { 
      id: syncResult.leadId, 
      name: contactName,
      ghl_synced_at: new Date().toISOString(),
      ghl_notes: notes
    },
    notes,
    timeline_events: timelineEvents,
    calls_synced: callsSynced,
    opportunity_synced: opportunitySynced,
  };
}

// Handle deep sync mode - pulls full timeline history for a contact
async function syncContactDeepTimeline(
  supabase: any,
  clientId: string,
  contactId: string,
  apiKey: string,
  locationId: string
): Promise<{ success: boolean; events_count: number; error?: string }> {
  console.log(`Deep timeline sync: fetching full history for contact ${contactId}`);
  
  let eventsCount = 0;
  
  try {
    // Fetch all data in parallel
    const [notes, tasks, appointments, messages] = await Promise.all([
      fetchGHLNotes(apiKey, contactId),
      fetchGHLTasks(apiKey, contactId),
      fetchGHLAppointments(apiKey, contactId),
      fetchGHLConversationMessages(apiKey, locationId, contactId),
    ]);
    
    console.log(`Fetched: ${notes.length} notes, ${tasks.length} tasks, ${appointments.length} appointments, ${messages.length} messages`);
    
    // Get lead_id if exists
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('client_id', clientId)
      .eq('external_id', contactId)
      .maybeSingle();
    
    const leadId = lead?.id || null;
    
    // Clear existing timeline events for this contact
    await supabase
      .from('contact_timeline_events')
      .delete()
      .eq('client_id', clientId)
      .eq('ghl_contact_id', contactId);
    
    const timelineEvents: any[] = [];
    
    // Process notes
    for (const note of notes) {
      timelineEvents.push({
        client_id: clientId,
        lead_id: leadId,
        ghl_contact_id: contactId,
        event_type: 'note',
        event_subtype: null,
        title: null,
        body: note.body,
        event_at: note.dateAdded || new Date().toISOString(),
        metadata: { userId: note.userId, noteId: note.id },
      });
    }
    
    // Process tasks
    for (const task of tasks) {
      timelineEvents.push({
        client_id: clientId,
        lead_id: leadId,
        ghl_contact_id: contactId,
        event_type: 'task',
        event_subtype: task.status || task.completed ? 'completed' : 'pending',
        title: task.title || task.body,
        body: task.description || task.body,
        event_at: task.dueDate || task.dateAdded || new Date().toISOString(),
        metadata: { taskId: task.id, assignedTo: task.assignedTo },
      });
    }
    
    // Process appointments
    for (const appt of appointments) {
      timelineEvents.push({
        client_id: clientId,
        lead_id: leadId,
        ghl_contact_id: contactId,
        event_type: 'appointment',
        event_subtype: appt.status || appt.appointmentStatus,
        title: appt.title || appt.calendarName,
        body: appt.notes || null,
        event_at: appt.startTime || appt.selectedTimezone || appt.dateAdded || new Date().toISOString(),
        metadata: { 
          appointmentId: appt.id, 
          calendarId: appt.calendarId,
          endTime: appt.endTime,
          status: appt.status,
        },
      });
    }
    
    // Process messages (SMS, Email, Calls)
    for (const msg of messages) {
      let eventType = 'sms';
      if (msg.type === 'TYPE_EMAIL' || msg.messageType === 'TYPE_EMAIL') {
        eventType = 'email';
      } else if (msg.type === 'TYPE_CALL' || msg.messageType === 'TYPE_CALL' || msg.conversationType === 'TYPE_CALL') {
        eventType = 'call';
      } else if (msg.type === 'TYPE_SMS' || msg.messageType === 'TYPE_SMS') {
        eventType = 'sms';
      }
      
      timelineEvents.push({
        client_id: clientId,
        lead_id: leadId,
        ghl_contact_id: contactId,
        event_type: eventType,
        event_subtype: msg.direction || (msg.direction === 1 ? 'inbound' : 'outbound'),
        title: msg.subject || null,
        body: msg.body || msg.message,
        event_at: msg.dateAdded || new Date().toISOString(),
        metadata: { 
          messageId: msg.id, 
          conversationId: msg.conversationId,
          status: msg.status,
          direction: msg.direction,
        },
      });
    }
    
    // Insert all events in batches
    if (timelineEvents.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < timelineEvents.length; i += batchSize) {
        const batch = timelineEvents.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('contact_timeline_events')
          .insert(batch);
        
        if (insertError) {
          console.error('Error inserting timeline events batch:', insertError);
        } else {
          eventsCount += batch.length;
        }
      }
    }
    
    console.log(`Deep timeline sync complete: ${eventsCount} events stored`);
    
    return { success: true, events_count: eventsCount };
  } catch (err) {
    console.error('Error in deep timeline sync:', err);
    return { 
      success: false, 
      events_count: eventsCount,
      error: err instanceof Error ? err.message : 'Unknown error' 
    };
  }
}

// Fetch all appointments from a specific GHL calendar (for calendar-based sync)
async function fetchGHLCalendarAppointments(
  apiKey: string,
  locationId: string,
  calendarId: string,
  startDate?: Date
): Promise<any[]> {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
  
  const appointments: any[] = [];
  let hasMore = true;
  let startAfterId: string | undefined;
  const MAX_PAGES = 50;
  let pageCount = 0;
  
  try {
    while (hasMore && pageCount < MAX_PAGES) {
      // Use calendars endpoint to fetch appointments by calendar
      let url = `${GHL_BASE_URL}/calendars/${calendarId}/appointments?locationId=${locationId}&limit=100`;
      if (startAfterId) {
        url += `&startAfterId=${startAfterId}`;
      }
      
      const response = await fetch(url, { method: 'GET', headers });
      
      if (!response.ok) {
        console.error(`GHL calendar appointments fetch error: ${response.status} for calendar ${calendarId}`);
        break;
      }
      
      const data = await response.json();
      const batch = data.appointments || data.events || [];
      
      for (const appt of batch) {
        // Filter by start date if provided
        if (startDate && appt.startTime) {
          const apptDate = new Date(appt.startTime);
          if (apptDate < startDate) continue;
        }
        appointments.push({ ...appt, calendarId });
      }
      
      if (batch.length < 100) {
        hasMore = false;
      } else {
        startAfterId = batch[batch.length - 1].id;
      }
      
      pageCount++;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (err) {
    console.error(`Error fetching appointments for calendar ${calendarId}:`, err);
  }
  
  console.log(`Fetched ${appointments.length} appointments from calendar ${calendarId}`);
  return appointments;
}

// Sync ALL contacts without limit (for master_sync mode)
async function syncAllContactsUnlimited(
  supabase: any,
  client: { id: string; name: string; ghl_api_key: string; ghl_location_id: string },
  fundedStageIds: string[],
  committedStageIds: string[]
): Promise<{ created: number; updated: number; fundedFromTags: number; errors: string[] }> {
  const result = { created: 0, updated: 0, fundedFromTags: 0, errors: [] as string[] };
  
  console.log(`Starting unlimited contact sync for client: ${client.name}`);
  
  // Fetch opportunities for matching
  // Wrapped in try-catch so contact sync continues even if pipeline fetch fails
  const opportunityByContactId = new Map<string, GHLOpportunity>();
  try {
    const opportunities = await fetchGHLOpportunities(client.ghl_api_key, client.ghl_location_id);
    for (const opp of opportunities) {
      if (opp.contactId) {
        opportunityByContactId.set(opp.contactId, opp);
      }
    }
    console.log(`Fetched ${opportunities.length} opportunities for matching`);
  } catch (err) {
    console.error(`Failed to fetch opportunities for ${client.name}, continuing without pipeline data:`, err);
    result.errors.push(`Pipeline fetch failed (non-blocking): ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
  
  // Fetch custom field definitions once for this client
  const fieldNameMap = await fetchGHLCustomFieldDefinitions(client.ghl_api_key, client.ghl_location_id);
  
  let hasMore = true;
  let startAfterId: string | undefined;
  let totalProcessed = 0;
  const MAX_CONTACTS = 50000; // High limit for larger accounts
  
  try {
    while (hasMore && totalProcessed < MAX_CONTACTS) {
      const { contacts, nextPageUrl } = await fetchGHLContacts(
        client.ghl_api_key,
        client.ghl_location_id,
        100,
        startAfterId
      );
      
      console.log(`Fetched batch of ${contacts.length} contacts, total processed: ${totalProcessed}`);
      
      for (const contact of contacts) {
        try {
          const contactOpportunity = opportunityByContactId.get(contact.id);
          const syncResult = await syncContactToDatabase(supabase, client.id, contact, contactOpportunity, fieldNameMap);
          
          if (syncResult.action === 'created') result.created++;
          else if (syncResult.action === 'updated') result.updated++;
          
          // Check for funded investor tag
          if (hasFundedInvestorTag(contact)) {
            const created = await createFundedInvestorFromContact(
              supabase,
              client.id,
              contact,
              syncResult.leadId || null,
              contactOpportunity
            );
            if (created) result.fundedFromTags++;
          }
        } catch (err) {
          result.errors.push(`Contact ${contact.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
        totalProcessed++;
      }
      
      if (nextPageUrl && contacts.length === 100) {
        startAfterId = contacts[contacts.length - 1].id;
      } else {
        hasMore = false;
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push(`Sync failed: ${errorMsg}`);
  }
  
  console.log(`Unlimited contact sync complete: created=${result.created}, updated=${result.updated}, fundedFromTags=${result.fundedFromTags}`);
  return result;
}

// Sync pipeline opportunities and create funded investors from configured stages
async function syncPipelineOpportunitiesAndFunded(
  supabase: any,
  client: { id: string; name: string; ghl_api_key: string; ghl_location_id: string },
  pipelineId: string,
  fundedStageIds: string[],
  committedStageIds: string[]
): Promise<{ opportunities: number; funded: number; errors: string[] }> {
  const result = { opportunities: 0, funded: 0, errors: [] as string[] };
  
  console.log(`Syncing pipeline ${pipelineId} with fundedStages: ${fundedStageIds.length}, committedStages: ${committedStageIds.length}`);
  
  const headers = {
    'Authorization': `Bearer ${client.ghl_api_key}`,
    'Content-Type': 'application/json',
    'Version': '2021-07-28',
  };
  
  // Fetch all opportunities from the pipeline with pagination
  const allOpportunities: any[] = [];
  let hasMore = true;
  let startAfterId: string | null = null;
  
  try {
    while (hasMore) {
      let url = `${GHL_BASE_URL}/opportunities/search?location_id=${client.ghl_location_id}&pipeline_id=${pipelineId}&limit=100`;
      if (startAfterId) {
        url += `&startAfter=${startAfterId}&startAfterId=${startAfterId}`;
      }
      
      const response = await fetch(url, { method: 'GET', headers });
      
      if (!response.ok) {
        console.error(`GHL opportunities fetch error: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      const opportunities = data.opportunities || [];
      allOpportunities.push(...opportunities);
      
      if (opportunities.length < 100) {
        hasMore = false;
      } else {
        startAfterId = opportunities[opportunities.length - 1]?.id;
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`Fetched ${allOpportunities.length} opportunities from pipeline`);
    
    for (const opp of allOpportunities) {
      try {
        const contactId = opp.contactId || opp.contact?.id;
        const stageId = opp.pipelineStageId;
        const monetaryValue = opp.monetaryValue || opp.monetary_value || 0;
        const stageName = opp.pipelineStageName || opp.stageName || '';
        const status = opp.status || 'open';
        
        // Update the lead with opportunity data
        if (contactId) {
          await supabase
            .from('leads')
            .update({
              opportunity_status: status,
              opportunity_stage: stageName,
              opportunity_stage_id: stageId,
              opportunity_value: monetaryValue,
              ghl_synced_at: new Date().toISOString(),
            })
            .eq('client_id', client.id)
            .eq('external_id', contactId);
        }
        
        result.opportunities++;
        
        // Check if this stage is a funded stage
        if (stageId && fundedStageIds.includes(stageId)) {
          console.log(`Found funded opportunity: ${opp.id} in stage ${stageName}`);
          
          // Create funded_investor record
          // Always use contactId for dedup consistency with tag-based path
          const externalId = contactId || opp.id;
          
          // Check if already exists
          const { data: existing } = await supabase
            .from('funded_investors')
            .select('id')
            .eq('client_id', client.id)
            .eq('external_id', externalId)
            .maybeSingle();
          
          if (!existing) {
            // Determine funded date using priority: lastStageChangeAt > dateUpdated > dateAdded
            let fundedAt = opp.lastStageChangeAt || opp.dateUpdated || opp.dateAdded || new Date().toISOString();
            
            // Get lead info
            let leadId: string | null = null;
            let firstContactAt: string | null = null;
            let timeToFundDays: number | null = null;
            let callsToFund = 0;
            
            if (contactId) {
              const { data: lead } = await supabase
                .from('leads')
                .select('id, created_at')
                .eq('client_id', client.id)
                .eq('external_id', contactId)
                .maybeSingle();
              
              if (lead) {
                leadId = lead.id;
                firstContactAt = lead.created_at;
                if (lead.created_at) {
                  timeToFundDays = Math.floor((new Date(fundedAt).getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24));
                }
                
                const { count } = await supabase
                  .from('calls')
                  .select('*', { count: 'exact', head: true })
                  .eq('lead_id', lead.id);
                callsToFund = count || 0;
              }
            }
            
            const name = opp.name || opp.contact?.name || 'Unknown';
            
            const { error: insertError } = await supabase.from('funded_investors').insert({
              client_id: client.id,
              external_id: externalId,
              name,
              lead_id: leadId,
              funded_amount: monetaryValue,
              funded_at: fundedAt,
              first_contact_at: firstContactAt,
              time_to_fund_days: timeToFundDays,
              calls_to_fund: callsToFund,
              source: 'pipeline_stage',
            });
            
            if (!insertError) {
              result.funded++;
              console.log(`Created funded investor from pipeline stage: ${name} ($${monetaryValue})`);
            }
          }
        }
      } catch (err) {
        result.errors.push(`Opportunity ${opp.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  } catch (err) {
    result.errors.push(`Pipeline sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
  
  console.log(`Pipeline sync complete: opportunities=${result.opportunities}, funded=${result.funded}`);
  return result;
}

// Sync all appointments from configured calendars (tracked + reconnect)
async function syncAllCalendarAppointments(
  supabase: any,
  client: { id: string; name: string; ghl_api_key: string; ghl_location_id: string },
  trackedCalendarIds: string[],
  reconnectCalendarIds: string[]
): Promise<{ created: number; updated: number; reconnects: number; errors: string[] }> {
  const result = { created: 0, updated: 0, reconnects: 0, errors: [] as string[] };
  
  console.log(`Syncing calendars: tracked=${trackedCalendarIds.length}, reconnect=${reconnectCalendarIds.length}`);
  
  // Build lead lookup map
  const { data: leads } = await supabase
    .from('leads')
    .select('id, external_id')
    .eq('client_id', client.id)
    .not('external_id', 'is', null);
  
  const leadsByContactId = new Map<string, string>();
  for (const lead of leads || []) {
    if (lead.external_id) {
      leadsByContactId.set(lead.external_id, lead.id);
    }
  }
  console.log(`Built lead lookup map with ${leadsByContactId.size} entries`);
  
  // Process tracked calendars (initial booked calls)
  for (const calendarId of trackedCalendarIds) {
    try {
      const appointments = await fetchGHLCalendarAppointments(
        client.ghl_api_key,
        client.ghl_location_id,
        calendarId
      );
      
      for (const appt of appointments) {
        const syncResult = await syncAppointmentToCall(supabase, client.id, appt, leadsByContactId, false);
        if (syncResult.action === 'created') result.created++;
        else if (syncResult.action === 'updated') result.updated++;
      }
    } catch (err) {
      result.errors.push(`Calendar ${calendarId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
  
  // Process reconnect calendars
  for (const calendarId of reconnectCalendarIds) {
    try {
      const appointments = await fetchGHLCalendarAppointments(
        client.ghl_api_key,
        client.ghl_location_id,
        calendarId
      );
      
      for (const appt of appointments) {
        const syncResult = await syncAppointmentToCall(supabase, client.id, appt, leadsByContactId, true);
        if (syncResult.action === 'created') {
          result.created++;
          result.reconnects++;
        } else if (syncResult.action === 'updated') {
          result.updated++;
        }
      }
    } catch (err) {
      result.errors.push(`Reconnect calendar ${calendarId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }
  
  console.log(`Calendar sync complete: created=${result.created}, updated=${result.updated}, reconnects=${result.reconnects}`);
  return result;
}

// Sync a single appointment to a call record with embedded contact info
async function syncAppointmentToCall(
  supabase: any,
  clientId: string,
  appt: any,
  leadsByContactId: Map<string, string>,
  isReconnect: boolean,
  contactDetailsCache?: Map<string, { name: string; email: string | null; phone: string | null }>
): Promise<{ action: 'created' | 'updated' | 'skipped' }> {
  const appointmentId = appt.id;
  const calendarId = appt.calendarId;
  const contactId = appt.contactId;
  const status = (appt.status || appt.appointmentStatus || '').toLowerCase();
  
  // Map GHL appointment status to our call outcome
  let outcome = 'booked';
  let showed = false;
  
  if (status === 'showed' || status === 'completed') {
    outcome = 'showed';
    showed = true;
  } else if (status === 'noshow' || status === 'no-show' || status === 'no_show') {
    outcome = 'no_show';
    showed = false;
  } else if (status === 'cancelled' || status === 'canceled') {
    outcome = 'cancelled';
    showed = false;
  } else if (status === 'confirmed') {
    outcome = 'booked';
    showed = false;
  }
  
  // Find lead by contact ID
  const leadId = contactId ? leadsByContactId.get(contactId) || null : null;
  
  // Get contact details - from appointment, cache, or database
  let contactName: string | null = null;
  let contactEmail: string | null = null;
  let contactPhone: string | null = null;
  
  // First try to get from appointment data itself
  if (appt.contact) {
    contactName = appt.contact.name || `${appt.contact.firstName || ''} ${appt.contact.lastName || ''}`.trim() || null;
    contactEmail = appt.contact.email || null;
    contactPhone = appt.contact.phone || null;
  }
  
  // If not in appointment, try cache
  if (!contactName && contactDetailsCache && contactId) {
    const cached = contactDetailsCache.get(contactId);
    if (cached) {
      contactName = cached.name;
      contactEmail = cached.email;
      contactPhone = cached.phone;
    }
  }
  
  // If still no name, try to get from leads table
  if (!contactName && leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('name, email, phone')
      .eq('id', leadId)
      .maybeSingle();
    
    if (lead) {
      contactName = lead.name;
      contactEmail = lead.email;
      contactPhone = lead.phone;
    }
  }
  
  // Use GHL dateAdded/createdAt as the original creation date for the call record
  // This ensures historical records appear in the correct chronological order
  const ghlCreatedAt = appt.dateAdded || appt.createdAt || new Date().toISOString();
  
  const callData = {
    client_id: clientId,
    lead_id: leadId,
    external_id: contactId || appointmentId,
    ghl_appointment_id: appointmentId,
    ghl_calendar_id: calendarId,
    scheduled_at: appt.startTime || appt.dateAdded,
    appointment_status: status,
    showed,
    outcome,
    is_reconnect: isReconnect,
    booked_at: ghlCreatedAt,
    created_at: ghlCreatedAt, // Use GHL creation date, NOT current time
    ghl_synced_at: new Date().toISOString(),
    contact_name: contactName,
    contact_email: contactEmail,
    contact_phone: contactPhone,
  };
  
  // Check if call already exists by appointment ID
  const { data: existingCall } = await supabase
    .from('calls')
    .select('id')
    .eq('client_id', clientId)
    .eq('ghl_appointment_id', appointmentId)
    .maybeSingle();
  
  if (existingCall) {
    // Update existing call
    const { error: updateError } = await supabase
      .from('calls')
      .update({
        lead_id: leadId,
        scheduled_at: callData.scheduled_at,
        appointment_status: callData.appointment_status,
        showed: callData.showed,
        outcome: callData.outcome,
        is_reconnect: isReconnect,
        ghl_synced_at: new Date().toISOString(),
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone,
      })
      .eq('id', existingCall.id);
    
    return { action: updateError ? 'skipped' : 'updated' };
  } else {
    // Create new call record
    const { error: insertError } = await supabase
      .from('calls')
      .insert(callData);
    
    return { action: insertError ? 'skipped' : 'created' };
  }
}

// =======================================
// HISTORICAL METRICS RECALCULATION
// =======================================
// PHASE 6: Recalculate Historical Daily Metrics
// Aggregates leads, calls, and funded_investors into daily_metrics
// This function DELETES existing metrics and recalculates from source tables
// =======================================
async function recalculateHistoricalMetrics(
  supabase: any,
  clientId: string
): Promise<{ daysUpdated: number; errors: string[] }> {
  const result = { daysUpdated: 0, errors: [] as string[] };
  
  console.log(`Starting historical metrics recalculation for client ${clientId}`);
  
  try {
    // Find the date range from source tables
    // Get earliest and latest dates from leads, calls, and funded_investors
    const { data: leadRange } = await supabase
      .from('leads')
      .select('created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
      .limit(1);
    
    const { data: callRange } = await supabase
      .from('calls')
      .select('booked_at')
      .eq('client_id', clientId)
      .not('booked_at', 'is', null)
      .order('booked_at', { ascending: true })
      .limit(1);
    
    const { data: fundedRange } = await supabase
      .from('funded_investors')
      .select('funded_at')
      .eq('client_id', clientId)
      .order('funded_at', { ascending: true })
      .limit(1);
    
    // Find the earliest date across all sources
    const dates: Date[] = [];
    if (leadRange?.[0]?.created_at) dates.push(new Date(leadRange[0].created_at));
    if (callRange?.[0]?.booked_at) dates.push(new Date(callRange[0].booked_at));
    if (fundedRange?.[0]?.funded_at) dates.push(new Date(fundedRange[0].funded_at));
    
    if (dates.length === 0) {
      console.log('No data found for metrics recalculation');
      return result;
    }
    
    const earliestDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const today = new Date();
    
    // Iterate through each day from earliest to today
    // Uses UPSERT to preserve ad_spend/impressions/clicks/ctr columns
    const currentDate = new Date(earliestDate);
    currentDate.setUTCHours(0, 0, 0, 0);
    
    // Batch inserts for efficiency
    const metricsToInsert: any[] = [];
    
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Use UTC boundaries to avoid timezone issues
      const dayStart = `${dateStr}T00:00:00.000Z`;
      const dayEnd = `${dateStr}T23:59:59.999Z`;
      
      try {
        // Count leads created on this date (using is_spam for non-spam count later)
        const { count: leadsCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_spam', false)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd);
        
        // Count spam leads created on this date
        const { count: spamCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_spam', true)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd);
        
        // Also count leads where is_spam is null (treat as non-spam)
        const { count: nullSpamCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .is('is_spam', null)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd);
        
        const totalValidLeads = (leadsCount || 0) + (nullSpamCount || 0);
        
        // Count calls BOOKED on this date (not reconnects)
        // Use .neq instead of .or for clarity
        const { count: callsCount } = await supabase
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .neq('is_reconnect', true)
          .gte('booked_at', dayStart)
          .lte('booked_at', dayEnd);
        
        // Count showed calls BOOKED on this date (not reconnects)
        const { count: showedCount } = await supabase
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('showed', true)
          .neq('is_reconnect', true)
          .gte('booked_at', dayStart)
          .lte('booked_at', dayEnd);
        
        // Count reconnect calls BOOKED on this date
        const { count: reconnectCount } = await supabase
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_reconnect', true)
          .gte('booked_at', dayStart)
          .lte('booked_at', dayEnd);
        
        // Count reconnect showed calls BOOKED on this date
        const { count: reconnectShowedCount } = await supabase
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_reconnect', true)
          .eq('showed', true)
          .gte('booked_at', dayStart)
          .lte('booked_at', dayEnd);
        
        // Get funded investors for this date
        const { data: fundedData, count: fundedCount } = await supabase
          .from('funded_investors')
          .select('funded_amount, commitment_amount', { count: 'exact' })
          .eq('client_id', clientId)
          .gte('funded_at', dayStart)
          .lte('funded_at', dayEnd);
        
        const fundedDollars = (fundedData || []).reduce((sum: number, f: any) => {
          const amount = (f.funded_amount && f.funded_amount > 0) ? f.funded_amount : (f.commitment_amount || 0);
          return sum + amount;
        }, 0);
        const commitmentDollars = (fundedData || []).reduce((sum: number, f: any) => sum + (f.commitment_amount || 0), 0);
        const commitmentCount = (fundedData || []).filter((f: any) => f.commitment_amount && f.commitment_amount > 0).length;
        
        // Always upsert CRM columns — never skip days that may have ad_spend data
        metricsToInsert.push({
          client_id: clientId,
          date: dateStr,
          leads: totalValidLeads,
          spam_leads: spamCount || 0,
          calls: callsCount || 0,
          showed_calls: showedCount || 0,
          reconnect_calls: reconnectCount || 0,
          reconnect_showed: reconnectShowedCount || 0,
          funded_investors: fundedCount || 0,
          funded_dollars: fundedDollars,
          commitments: commitmentCount,
          commitment_dollars: commitmentDollars,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        result.errors.push(`Date ${dateStr}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    // Upsert in batches — only CRM columns, preserving ad_spend/impressions/clicks/ctr
    if (metricsToInsert.length > 0) {
      console.log(`Upserting ${metricsToInsert.length} daily_metrics records...`);
      const batchSize = 50;
      for (let i = 0; i < metricsToInsert.length; i += batchSize) {
        const batch = metricsToInsert.slice(i, i + batchSize);
        const { error: upsertError } = await supabase
          .from('daily_metrics')
          .upsert(batch, {
            onConflict: 'client_id,date',
            ignoreDuplicates: false,
          });

        if (upsertError) {
          result.errors.push(`Batch upsert error: ${upsertError.message}`);
          console.error('Batch upsert error:', upsertError);
        } else {
          result.daysUpdated += batch.length;
        }
      }
    }

    console.log(`Historical metrics recalculation complete: ${result.daysUpdated} days upserted`);
  } catch (err) {
    result.errors.push(`Metrics recalculation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    console.error('Error in recalculateHistoricalMetrics:', err);
  }
  
  return result;
}

// =======================================
// RECENT METRICS RECALCULATION (Hourly Sync)
// =======================================
// Lightweight version that only updates the last N days
// Used by hourly sync to keep KPIs current without full historical rebuild
// =======================================
async function recalculateRecentMetrics(
  supabase: any,
  clientId: string,
  daysBack: number = 7
): Promise<{ daysUpdated: number; errors: string[] }> {
  const result = { daysUpdated: 0, errors: [] as string[] };
  
  console.log(`Starting recent metrics recalculation for client ${clientId}, last ${daysBack} days`);
  
  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - daysBack);
    startDate.setUTCHours(0, 0, 0, 0);
    
    // Iterate through each day and UPSERT (preserving ad spend columns)
    const currentDate = new Date(startDate);
    
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayStart = `${dateStr}T00:00:00.000Z`;
      const dayEnd = `${dateStr}T23:59:59.999Z`;
      
      try {
        // Count leads where is_spam = false
        const { count: leadsCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_spam', false)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd);
        
        // Count spam leads
        const { count: spamCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_spam', true)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd);
        
        // Count leads with null is_spam (treat as non-spam)
        const { count: nullSpamCount } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .is('is_spam', null)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd);
        
        const totalValidLeads = (leadsCount || 0) + (nullSpamCount || 0);
        
        // Count calls BOOKED on this date (not reconnects)
        const { count: callsCount } = await supabase
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .neq('is_reconnect', true)
          .gte('booked_at', dayStart)
          .lte('booked_at', dayEnd);
        
        // Count showed calls BOOKED on this date (not reconnects)
        const { count: showedCount } = await supabase
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('showed', true)
          .neq('is_reconnect', true)
          .gte('booked_at', dayStart)
          .lte('booked_at', dayEnd);
        
        // Count reconnect calls BOOKED on this date
        const { count: reconnectCount } = await supabase
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_reconnect', true)
          .gte('booked_at', dayStart)
          .lte('booked_at', dayEnd);
        
        // Count reconnect showed calls BOOKED on this date
        const { count: reconnectShowedCount } = await supabase
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', clientId)
          .eq('is_reconnect', true)
          .eq('showed', true)
          .gte('booked_at', dayStart)
          .lte('booked_at', dayEnd);
        
        // Get funded investors for this date
        const { data: fundedData, count: fundedCount } = await supabase
          .from('funded_investors')
          .select('funded_amount, commitment_amount', { count: 'exact' })
          .eq('client_id', clientId)
          .gte('funded_at', dayStart)
          .lte('funded_at', dayEnd);
        
        const fundedDollars = (fundedData || []).reduce((sum: number, f: any) => {
          const amount = (f.funded_amount && f.funded_amount > 0) ? f.funded_amount : (f.commitment_amount || 0);
          return sum + amount;
        }, 0);
        const commitmentDollars = (fundedData || []).reduce((sum: number, f: any) => sum + (f.commitment_amount || 0), 0);
        const commitmentCount = (fundedData || []).filter((f: any) => f.commitment_amount && f.commitment_amount > 0).length;
        
        // UPSERT — only CRM columns, preserving ad_spend/impressions/clicks/ctr
        const { error: upsertError } = await supabase
          .from('daily_metrics')
          .upsert({
            client_id: clientId,
            date: dateStr,
            leads: totalValidLeads,
            spam_leads: spamCount || 0,
            calls: callsCount || 0,
            showed_calls: showedCount || 0,
            reconnect_calls: reconnectCount || 0,
            reconnect_showed: reconnectShowedCount || 0,
            funded_investors: fundedCount || 0,
            funded_dollars: fundedDollars,
            commitments: commitmentCount,
            commitment_dollars: commitmentDollars,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'client_id,date',
            ignoreDuplicates: false,
          });
        
        if (upsertError) {
          result.errors.push(`Upsert error for ${dateStr}: ${upsertError.message}`);
        } else {
          result.daysUpdated++;
        }
      } catch (err) {
        result.errors.push(`Date ${dateStr}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
    
    console.log(`Recent metrics recalculation complete: ${result.daysUpdated} days updated`);
  } catch (err) {
    result.errors.push(`Metrics recalculation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    console.error('Error in recalculateRecentMetrics:', err);
  }
  
  return result;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    let targetClientId: string | null = null;
    let syncType: 'contacts' | 'calls' | 'all' = 'all';
    let sinceDateDays: number | undefined;
    let singleContactId: string | null = null;
    let mode: string | null = null;
    let syncTimeline: boolean = false;
    
    try {
      const body = await req.json();
      targetClientId = body?.client_id || null;
      syncType = body?.syncType || 'all';
      singleContactId = body?.contactId || null;
      mode = body?.mode || null;
      syncTimeline = body?.syncTimeline === true;

      // Backward compatibility: accept mode as sync selector for orchestrators
      if (!body?.syncType && typeof mode === 'string') {
        if (mode === 'contacts') syncType = 'contacts';
        if (mode === 'calls') syncType = 'calls';
        if (mode === 'all') syncType = 'all';
      }
      
      // Support historical sync with sinceDateDays parameter (default: 7, max: 365)
      if (body?.sinceDateDays) {
        sinceDateDays = Math.min(Math.max(parseInt(body.sinceDateDays) || 7, 1), 365);
      }
      
      // Full sync mode: sync 365 days of history + timeline
      if (mode === 'full_sync') {
        sinceDateDays = 365;
        syncTimeline = true;
        console.log('Full sync mode enabled: 365 days history + timeline sync');
      }
    } catch {
      // No body or invalid JSON - sync all clients
    }
    
    // Handle API connection test mode
    if (mode === 'test_connection' && targetClientId) {
      console.log(`Test connection mode: clientId=${targetClientId}`);
      
      // Fetch client's GHL credentials
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, name, ghl_api_key, ghl_location_id')
        .eq('id', targetClientId)
        .maybeSingle();
      
      if (clientError || !client) {
        return new Response(
          JSON.stringify({ 
            contacts: { success: false, error: 'Client not found' },
            calendars: { success: false, error: 'Client not found' },
            opportunities: { success: false, error: 'Client not found' },
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (!client.ghl_api_key || !client.ghl_location_id) {
        return new Response(
          JSON.stringify({ 
            contacts: { success: false, error: 'No GHL credentials configured' },
            calendars: { success: false, error: 'No GHL credentials configured' },
            opportunities: { success: false, error: 'No GHL credentials configured' },
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const headers = {
        'Authorization': `Bearer ${client.ghl_api_key}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      };
      
      // Test contacts endpoint using POST /contacts/search (v2)
      let contactsResult = { success: false, error: '' };
      try {
        const contactsRes = await fetch(
          `${GHL_BASE_URL}/contacts/search`,
          { 
            method: 'POST', 
            headers,
            body: JSON.stringify({ locationId: client.ghl_location_id, pageLimit: 1, page: 1 })
          }
        );
        if (contactsRes.ok) {
          contactsResult = { success: true, error: '' };
        } else {
          const errorText = await contactsRes.text();
          contactsResult = { success: false, error: `${contactsRes.status}: ${errorText.substring(0, 100)}` };
        }
      } catch (err) {
        contactsResult = { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
      
      // Test calendars endpoint
      let calendarsResult = { success: false, error: '' };
      try {
        const calendarsRes = await fetch(
          `${GHL_BASE_URL}/calendars/?locationId=${client.ghl_location_id}`,
          { method: 'GET', headers }
        );
        if (calendarsRes.ok) {
          calendarsResult = { success: true, error: '' };
        } else {
          const errorText = await calendarsRes.text();
          calendarsResult = { success: false, error: `${calendarsRes.status}: ${errorText.substring(0, 100)}` };
        }
      } catch (err) {
        calendarsResult = { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
      
      // Test opportunities endpoint using the search endpoint (doesn't require pipelineId)
      let opportunitiesResult = { success: false, error: '' };
      try {
        const oppsRes = await fetch(
          `${GHL_BASE_URL}/opportunities/search?location_id=${client.ghl_location_id}&limit=1`,
          { method: 'GET', headers }
        );
        if (oppsRes.ok) {
          opportunitiesResult = { success: true, error: '' };
        } else {
          const errorText = await oppsRes.text();
          opportunitiesResult = { success: false, error: `${oppsRes.status}: ${errorText.substring(0, 100)}` };
        }
      } catch (err) {
        opportunitiesResult = { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
      
      console.log(`API test results: contacts=${contactsResult.success}, calendars=${calendarsResult.success}, opportunities=${opportunitiesResult.success}`);
      
      return new Response(
        JSON.stringify({
          contacts: contactsResult,
          calendars: calendarsResult,
          opportunities: opportunitiesResult,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle single contact sync mode
    if (mode === 'single' && singleContactId && targetClientId) {
      console.log(`Single contact sync mode: contactId=${singleContactId}, clientId=${targetClientId}`);
      
      // Fetch client's GHL credentials
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, name, ghl_api_key, ghl_location_id')
        .eq('id', targetClientId)
        .maybeSingle();
      
      if (clientError || !client) {
        return new Response(
          JSON.stringify({ success: false, error: 'Client not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (!client.ghl_api_key || !client.ghl_location_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Client has no GHL credentials configured' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const result = await syncSingleContact(supabase, targetClientId, singleContactId, client.ghl_api_key);
      
      return new Response(
        JSON.stringify(result),
        { 
          status: result.success ? 200 : 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    // Handle calls enrichment mode - links orphaned calls and syncs appointments
    if (mode === 'calls' && targetClientId) {
      console.log(`Calls sync mode: clientId=${targetClientId}`);
      
      // Fetch client's GHL credentials
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, name, ghl_api_key, ghl_location_id')
        .eq('id', targetClientId)
        .maybeSingle();
      
      if (clientError || !client) {
        return new Response(
          JSON.stringify({ success: false, error: 'Client not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (!client.ghl_api_key || !client.ghl_location_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Client has no GHL credentials configured' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // 1. Link orphaned calls to leads
      const linkResult = await linkOrphanedCallsToLeads(supabase, targetClientId);
      
      // 2. Sync appointments for all leads
      const { data: leads } = await supabase
        .from('leads')
        .select('id, external_id')
        .eq('client_id', targetClientId)
        .not('external_id', 'is', null);
      
      let callsCreated = 0;
      let callsUpdated = 0;
      
      // Process leads in batches to avoid timeout
      const BATCH_SIZE = 20;
      const allLeads = leads || [];
      console.log(`Processing ${allLeads.length} leads for appointment sync`);
      
      for (let i = 0; i < allLeads.length; i += BATCH_SIZE) {
        const batch = allLeads.slice(i, i + BATCH_SIZE);
        
        await Promise.allSettled(
          batch.map(async (lead) => {
            try {
              const apptResult = await syncAppointmentsAsCalls(
                supabase,
                targetClientId,
                lead.external_id,
                lead.id,
                client.ghl_api_key
              );
              callsCreated += apptResult.created;
              callsUpdated += apptResult.updated;
            } catch (err) {
              console.error(`Appointment sync error for lead ${lead.id}:`, err);
            }
          })
        );
        
        // Small delay between batches
        if (i + BATCH_SIZE < allLeads.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      console.log(`Calls sync complete: ${linkResult.linked} linked, ${callsCreated} created, ${callsUpdated} updated`);
      
      return new Response(
        JSON.stringify({
          success: true,
          linked: linkResult.linked,
          calls_created: callsCreated,
          calls_updated: callsUpdated,
          leads_processed: allLeads.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle master_sync mode - comprehensive historical sync of all data types
    // Uses EdgeRuntime.waitUntil for background processing to avoid timeouts
    if (mode === 'master_sync' && targetClientId) {
      console.log(`Master sync mode: clientId=${targetClientId}`);
      
      // Fetch client's GHL credentials and settings
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, name, ghl_api_key, ghl_location_id')
        .eq('id', targetClientId)
        .maybeSingle();
      
      if (clientError || !client) {
        return new Response(
          JSON.stringify({ success: false, error: 'Client not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (!client.ghl_api_key || !client.ghl_location_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Client has no GHL credentials configured' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Fetch client settings for calendar and pipeline configuration
      const { data: settings } = await supabase
        .from('client_settings')
        .select('tracked_calendar_ids, reconnect_calendar_ids, funded_pipeline_id, funded_stage_ids, committed_stage_ids')
        .eq('client_id', targetClientId)
        .maybeSingle();
      
      const trackedCalendarIds: string[] = settings?.tracked_calendar_ids || [];
      const reconnectCalendarIds: string[] = settings?.reconnect_calendar_ids || [];
      const fundedPipelineId: string | null = settings?.funded_pipeline_id || null;
      const fundedStageIds: string[] = settings?.funded_stage_ids || [];
      const committedStageIds: string[] = settings?.committed_stage_ids || [];
      
      // Build warnings for missing configuration
      const configWarnings: string[] = [];
      
      if (trackedCalendarIds.length === 0) {
        configWarnings.push('No tracked calendars configured - booked calls will not be synced. Configure calendars in Settings > Calendar Tracking.');
      }
      
      if (reconnectCalendarIds.length === 0) {
        configWarnings.push('No reconnect calendars configured - reconnect calls will not be synced.');
      }
      
      if (!fundedPipelineId) {
        configWarnings.push('No funded pipeline configured - funded investors and commitments will not be synced from pipeline stages. Configure in Settings > Pipeline Mapping.');
      } else {
        if (fundedStageIds.length === 0) {
          configWarnings.push('Funded pipeline set but no funded stages configured - funded investors will not be tracked from pipeline stages.');
        }
        if (committedStageIds.length === 0) {
          configWarnings.push('Funded pipeline set but no committed stages configured - commitments will not be tracked from pipeline stages.');
        }
      }
      
      console.log(`Client settings loaded: tracked=${trackedCalendarIds.length}, reconnect=${reconnectCalendarIds.length}, fundedPipeline=${fundedPipelineId}, fundedStages=${fundedStageIds.length}`);
      console.log(`Config warnings: ${configWarnings.length > 0 ? configWarnings.join(' | ') : 'None'}`);
      
      // Mark sync as started
      await supabase
        .from('clients')
        .update({
          ghl_sync_status: 'syncing',
          ghl_sync_error: null,
        })
        .eq('id', targetClientId);
      
      // Define the background sync task
      const backgroundSyncTask = async () => {
        const summary: Record<string, any> = {
          contacts_created: 0,
          contacts_updated: 0,
          calls_created: 0,
          calls_updated: 0,
          reconnect_calls: 0,
          funded_investors_created: 0,
          opportunities_synced: 0,
          orphaned_calls_linked: 0,
          discrepancies_cleared: 0,
          metrics_days_updated: 0,
          errors: [] as string[],
        };
        
        try {
          // PHASE 1: Sync ALL contacts (no limit for master_sync)
          console.log('PHASE 1: Syncing all contacts...');
          try {
            const contactResult = await syncAllContactsUnlimited(supabase, client as any, fundedStageIds, committedStageIds);
            summary.contacts_created = contactResult.created;
            summary.contacts_updated = contactResult.updated;
            summary.funded_investors_created += contactResult.fundedFromTags;
            if (contactResult.errors.length > 0) {
              summary.errors.push(...contactResult.errors.slice(0, 5));
            }
          } catch (err) {
            summary.errors.push(`Contact sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
          
          // PHASE 2: Sync pipeline opportunities and create funded investors
          if (fundedPipelineId) {
            console.log('PHASE 2: Syncing pipeline opportunities...');
            try {
              const pipelineResult = await syncPipelineOpportunitiesAndFunded(
                supabase,
                client as any,
                fundedPipelineId,
                fundedStageIds,
                committedStageIds
              );
              summary.opportunities_synced = pipelineResult.opportunities;
              summary.funded_investors_created += pipelineResult.funded;
              if (pipelineResult.errors.length > 0) {
                summary.errors.push(...pipelineResult.errors.slice(0, 5));
              }
            } catch (err) {
              summary.errors.push(`Pipeline sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          }
          
          // PHASE 3: Sync appointments from all configured calendars
          console.log('PHASE 3: Syncing calendar appointments...');
          try {
            const callResult = await syncAllCalendarAppointments(
              supabase,
              client as any,
              trackedCalendarIds,
              reconnectCalendarIds
            );
            summary.calls_created = callResult.created;
            summary.calls_updated = callResult.updated;
            summary.reconnect_calls = callResult.reconnects;
            if (callResult.errors.length > 0) {
              summary.errors.push(...callResult.errors.slice(0, 5));
            }
          } catch (err) {
            summary.errors.push(`Calendar sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
          
          // PHASE 4: Link any remaining orphaned calls to leads
          console.log('PHASE 4: Linking orphaned calls...');
          try {
            const linkResult = await linkOrphanedCallsToLeads(supabase, targetClientId);
            summary.orphaned_calls_linked = linkResult.linked;
            if (linkResult.errors.length > 0) {
              summary.errors.push(...linkResult.errors.slice(0, 3));
            }
          } catch (err) {
            summary.errors.push(`Call linking failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
          
          // PHASE 5: Clear old discrepancies
          console.log('PHASE 5: Clearing old discrepancies...');
          try {
            await supabase
              .from('data_discrepancies')
              .delete()
              .eq('client_id', targetClientId);
            console.log('Cleared discrepancies for client');
            summary.discrepancies_cleared = 1;
          } catch (err) {
            console.error('Error clearing discrepancies:', err);
          }
          
          // PHASE 6: Recalculate historical daily_metrics
          // This ensures all daily metrics are accurate based on booked_at dates
          console.log('PHASE 6: Recalculating historical metrics...');
          try {
            const metricsResult = await recalculateHistoricalMetrics(supabase, targetClientId);
            summary.metrics_days_updated = metricsResult.daysUpdated;
            if (metricsResult.errors.length > 0) {
              summary.errors.push(...metricsResult.errors.slice(0, 3));
            }
          } catch (err) {
            summary.errors.push(`Metrics recalculation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
          
          // Update client sync status with success
          await supabase
            .from('clients')
            .update({
              last_ghl_sync_at: new Date().toISOString(),
              ghl_sync_status: summary.errors.length > 0 ? 'partial' : 'healthy',
              ghl_sync_error: summary.errors.length > 0 ? summary.errors.slice(0, 3).join('; ') : null,
            })
            .eq('id', targetClientId);
          
          // Update settings sync timestamps
          await supabase
            .from('client_settings')
            .update({
              ghl_last_contacts_sync: new Date().toISOString(),
              ghl_last_calls_sync: new Date().toISOString(),
            })
            .eq('client_id', targetClientId);
          
          console.log('Master sync complete:', summary);
          
        } catch (err) {
          console.error('Master sync failed:', err);
          await supabase
            .from('clients')
            .update({
              ghl_sync_status: 'error',
              ghl_sync_error: err instanceof Error ? err.message : 'Unknown error',
            })
            .eq('id', targetClientId);
        }
      };
      
      // Use EdgeRuntime.waitUntil to run the sync in the background
      // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        EdgeRuntime.waitUntil(backgroundSyncTask());
      } else {
        // Fallback: run synchronously but with reduced scope
        console.log('EdgeRuntime.waitUntil not available, running simplified sync');
        await backgroundSyncTask();
      }
      
      // Return immediately to avoid timeout - include config warnings
      return new Response(
        JSON.stringify({
          success: true,
          message: configWarnings.length > 0 
            ? `Master sync started with ${configWarnings.length} configuration warning(s). Some data may not sync.`
            : 'Master sync started in background. Check sync status for progress.',
          started_at: new Date().toISOString(),
          config_warnings: configWarnings,
          settings_summary: {
            tracked_calendars: trackedCalendarIds.length,
            reconnect_calendars: reconnectCalendarIds.length,
            funded_pipeline_configured: !!fundedPipelineId,
            funded_stages: fundedStageIds.length,
            committed_stages: committedStageIds.length,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Handle deep sync mode - pulls full timeline history for a contact
    if (mode === 'deep_sync' && targetClientId) {
      const contactIdForDeepSync = singleContactId;
      // Also accept contact_id parameter
      let deepSyncContactId = contactIdForDeepSync;
      try {
        const body = await req.clone().json();
        deepSyncContactId = body?.contact_id || contactIdForDeepSync;
      } catch {}
      
      if (!deepSyncContactId) {
        return new Response(
          JSON.stringify({ success: false, error: 'contact_id is required for deep_sync mode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log(`Deep sync mode: contactId=${deepSyncContactId}, clientId=${targetClientId}`);
      
      // Fetch client's GHL credentials
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('id, name, ghl_api_key, ghl_location_id')
        .eq('id', targetClientId)
        .maybeSingle();
      
      if (clientError || !client) {
        return new Response(
          JSON.stringify({ success: false, error: 'Client not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (!client.ghl_api_key || !client.ghl_location_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Client has no GHL credentials configured' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      const result = await syncContactDeepTimeline(
        supabase, 
        targetClientId, 
        deepSyncContactId, 
        client.ghl_api_key,
        client.ghl_location_id
      );
      
      return new Response(
        JSON.stringify(result),
        { 
          status: result.success ? 200 : 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    let query = supabase
      .from('clients')
      .select('id, name, ghl_api_key, ghl_location_id')
      .not('ghl_api_key', 'is', null)
      .not('ghl_location_id', 'is', null);

    if (targetClientId) {
      // When targeting a specific client, sync regardless of status
      query = query.eq('id', targetClientId);
    } else {
      // When syncing all, only sync active clients
      query = query.eq('status', 'active');
    }

    const { data: clients, error: clientsError } = await query;

    if (clientsError) {
      throw new Error(`Failed to fetch clients: ${clientsError.message}`);
    }

    if (!clients || clients.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No clients with GHL credentials found', results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting GHL ${syncType} sync for ${clients.length} client(s), sinceDateDays: ${sinceDateDays || 'default'}, syncTimeline: ${syncTimeline}`);

    const results: Array<{
      client_id: string;
      client_name: string;
      contacts?: { created: number; updated: number; skipped: number; fundedFromTags: number; fundedFromPipeline: number; committedFromPipeline: number; callsCreated: number; callsUpdated: number; timelineSynced: number; errors: string[] };
      calls?: { enriched: number; skipped: number; errors: string[] };
    }> = [];

    // Use sinceDateDays for calls if provided, otherwise default to 7 days
    const callsSinceDate = new Date();
    callsSinceDate.setDate(callsSinceDate.getDate() - (sinceDateDays || 7));

    for (const client of clients) {
      const clientResult: typeof results[0] = {
        client_id: client.id,
        client_name: client.name,
      };

      const { data: syncLog } = await supabase
        .from('sync_logs')
        .insert({
          client_id: client.id,
          sync_type: syncType === 'calls' ? 'ghl_calls' : 'ghl_contacts',
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      try {
        if (syncType === 'contacts' || syncType === 'all') {
          const lightweightLeadSync = syncType === 'contacts' && !syncTimeline;
          clientResult.contacts = await syncClientContacts(supabase, client as any, syncLog?.id, sinceDateDays, syncTimeline, lightweightLeadSync);

          await supabase
            .from('client_settings')
            .update({ ghl_last_contacts_sync: new Date().toISOString() })
            .eq('client_id', client.id);
        }

        if (syncType === 'calls' || syncType === 'all') {
          clientResult.calls = await syncClientCallLogs(supabase, client as any, callsSinceDate);

          await supabase
            .from('client_settings')
            .update({ ghl_last_calls_sync: new Date().toISOString() })
            .eq('client_id', client.id);
        }
      } catch (err) {
        const clientError = err instanceof Error ? err.message : 'Unknown sync error';

        if (syncType === 'contacts' || syncType === 'all') {
          clientResult.contacts = clientResult.contacts ?? {
            created: 0,
            updated: 0,
            skipped: 0,
            fundedFromTags: 0,
            fundedFromPipeline: 0,
            committedFromPipeline: 0,
            callsCreated: 0,
            callsUpdated: 0,
            timelineSynced: 0,
            errors: [],
          };
          clientResult.contacts.errors.push(clientError);
        }

        if (syncType === 'calls' || syncType === 'all') {
          clientResult.calls = clientResult.calls ?? {
            enriched: 0,
            skipped: 0,
            errors: [],
          };
          clientResult.calls.errors.push(clientError);
        }

        console.error(`[GHL sync] Client ${client.name} failed: ${clientError}`);
      }

      results.push(clientResult);

      if (syncLog) {
        const hasErrors = (clientResult.contacts?.errors?.length || 0) > 0 ||
                         (clientResult.calls?.errors?.length || 0) > 0;
        const recordsSynced = (clientResult.contacts?.created || 0) +
                             (clientResult.contacts?.updated || 0) +
                             (clientResult.contacts?.fundedFromTags || 0) +
                             (clientResult.contacts?.fundedFromPipeline || 0) +
                             (clientResult.contacts?.committedFromPipeline || 0) +
                             (clientResult.calls?.enriched || 0);

        await supabase
          .from('sync_logs')
          .update({
            status: hasErrors ? 'partial' : 'success',
            records_synced: recordsSynced,
            error_message: hasErrors ?
              [...(clientResult.contacts?.errors || []), ...(clientResult.calls?.errors || [])].join('; ') : null,
            completed_at: new Date().toISOString(),
          })
          .eq('id', syncLog.id);
      }
    }

    const totalContactsCreated = results.reduce((sum, r) => sum + (r.contacts?.created || 0), 0);
    const totalContactsUpdated = results.reduce((sum, r) => sum + (r.contacts?.updated || 0), 0);
    const totalFundedFromTags = results.reduce((sum, r) => sum + (r.contacts?.fundedFromTags || 0), 0);
    const totalFundedFromPipeline = results.reduce((sum, r) => sum + (r.contacts?.fundedFromPipeline || 0), 0);
    const totalCommittedFromPipeline = results.reduce((sum, r) => sum + (r.contacts?.committedFromPipeline || 0), 0);
    const totalCallsEnriched = results.reduce((sum, r) => sum + (r.calls?.enriched || 0), 0);
    const totalCallsCreated = results.reduce((sum, r) => sum + (r.contacts?.callsCreated || 0), 0);
    const totalCallsUpdated = results.reduce((sum, r) => sum + (r.contacts?.callsUpdated || 0), 0);
    const totalTimelineSynced = results.reduce((sum, r) => sum + (r.contacts?.timelineSynced || 0), 0);

    console.log(`GHL sync complete: ${totalContactsCreated} contacts created, ${totalContactsUpdated} updated, ${totalFundedFromTags} funded from tags, ${totalFundedFromPipeline} funded from pipeline, ${totalCommittedFromPipeline} committed from pipeline, ${totalCallsCreated} calls created, ${totalCallsUpdated} calls updated, ${totalCallsEnriched} calls enriched, ${totalTimelineSynced} timelines synced`);

    // Background: Auto-enrich newly created contacts via RetargetIQ
    if (totalContactsCreated > 0 && typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil((async () => {
        try {
          for (const client of clients) {
            // Check if auto-enrich is enabled
            const { data: cs } = await supabase
              .from('client_settings')
              .select('retargetiq_auto_enrich, retargetiq_website_slug')
              .eq('client_id', client.id)
              .single();
            
            if (!cs?.retargetiq_auto_enrich || !cs?.retargetiq_website_slug) continue;
            
            // Proper dedup: fetch already-enriched external_ids, then filter client-side
            const { data: recentLeads } = await supabase
              .from('leads')
              .select('id, external_id, phone, email, name')
              .eq('client_id', client.id)
              .order('created_at', { ascending: false })
              .limit(200);
            
            if (!recentLeads || recentLeads.length === 0) continue;
            
            // Get existing enrichment external_ids for this client
            const externalIds = recentLeads.map(l => l.external_id);
            const { data: existingEnrichments } = await supabase
              .from('lead_enrichment')
              .select('external_id')
              .eq('client_id', client.id)
              .in('external_id', externalIds);
            
            const enrichedSet = new Set((existingEnrichments || []).map(e => e.external_id));
            const unenriched = recentLeads.filter(l => !enrichedSet.has(l.external_id) && (l.phone || l.email));
            
            if (unenriched.length === 0) continue;
            
            // Cap at 25 per sync run to stay within API limits
            const toEnrich = unenriched.slice(0, 25);
            console.log(`[RetargetIQ] Auto-enriching ${toEnrich.length}/${unenriched.length} leads for ${client.name}`);
            
            // Batch of 3 with 2s delay between batches
            const BATCH_SIZE = 3;
            for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
              const batch = toEnrich.slice(i, i + BATCH_SIZE);
              await Promise.allSettled(batch.map(async (lead) => {
                try {
                  // Parse name for better matching
                  const nameParts = (lead.name || '').trim().split(/\s+/);
                  const firstName = nameParts[0] || '';
                  const lastName = nameParts.slice(1).join(' ') || '';
                  
                  await supabase.functions.invoke('enrich-lead-retargetiq', {
                    body: {
                      client_id: client.id,
                      lead_id: lead.id,
                      external_id: lead.external_id,
                      phone: lead.phone,
                      email: lead.email,
                      first_name: firstName,
                      last_name: lastName,
                    },
                  });
                } catch (e) {
                  console.error(`[RetargetIQ] Failed to enrich ${lead.external_id}:`, e);
                }
              }));
              // Rate limit: 2s between batches
              if (i + BATCH_SIZE < toEnrich.length) {
                await new Promise(r => setTimeout(r, 2000));
              }
            }
            console.log(`[RetargetIQ] ✓ Auto-enrich complete for ${client.name}`);
          }
        } catch (e) {
          console.error('[RetargetIQ] Auto-enrich background task failed:', e);
        }
      })());
    }

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          clients_synced: clients.length,
          total_contacts_created: totalContactsCreated,
          total_contacts_updated: totalContactsUpdated,
          total_funded_from_tags: totalFundedFromTags,
          total_funded_from_pipeline: totalFundedFromPipeline,
          total_committed_from_pipeline: totalCommittedFromPipeline,
          total_calls_created: totalCallsCreated,
          total_calls_updated: totalCallsUpdated,
          total_calls_enriched: totalCallsEnriched,
          total_timelines_synced: totalTimelineSynced,
        },
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('GHL sync error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
