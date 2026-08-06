import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const ADMIN_ROLES = ['admin', 'owner'];

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Hash an identifier for safe logging (never log raw location/calendar ids). */
async function h(value: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Service-role key, or a user JWT whose email maps to an agency admin/owner. */
async function isAuthorizedOperator(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (serviceKey && token === serviceKey) return true;
  try {
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await authClient.auth.getClaims(token);
    const claims: any = data?.claims;
    if (error || !claims?.sub) return false;
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!email) return false;
    const { data: member } = await admin
      .from('agency_members')
      .select('role')
      .ilike('email', email)
      .in('role', ADMIN_ROLES)
      .maybeSingle();
    return !!member;
  } catch {
    return false;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Load GHL credentials for a client from the database. Never returned to callers. */
async function loadClientCreds(clientId: string) {
  const { data, error } = await admin
    .from('clients')
    .select('ghl_api_key, ghl_location_id')
    .eq('id', clientId)
    .maybeSingle();
  if (error || !data?.ghl_api_key || !data?.ghl_location_id) return null;
  return { apiKey: data.ghl_api_key as string, locationId: data.ghl_location_id as string };
}

async function ghlGet(path: string, apiKey: string) {
  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const action = typeof payload?.action === 'string' ? payload.action : 'list';

    // ---- Public booking path: free slots for a mapped calendar only ----
    if (action === 'free-slots') {
      const calendarId = String(payload?.calendarId || '');
      const startDate = String(payload?.startDate || '');
      const endDate = String(payload?.endDate || startDate);
      const timezone = typeof payload?.timezone === 'string' ? payload.timezone.slice(0, 64) : 'America/New_York';
      if (!ID_RE.test(calendarId) || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        return json({ error: 'Invalid request', slots: [] }, 400);
      }

      // The calendar must be explicitly mapped; that mapping resolves the client
      // whose server-side credentials we use. No caller-supplied credentials.
      const { data: mapping } = await admin
        .from('calendar_mappings')
        .select('client_id')
        .or(`calendar_id.eq.${calendarId},ghl_calendar_id.eq.${calendarId}`)
        .limit(1)
        .maybeSingle();
      if (!mapping?.client_id) {
        return json({ error: 'Calendar not available', slots: [] }, 404);
      }
      const creds = await loadClientCreds(mapping.client_id);
      if (!creds) return json({ error: 'Calendar not available', slots: [] }, 404);

      const startMs = Date.parse(`${startDate}T00:00:00Z`);
      const endMs = Date.parse(`${endDate}T23:59:59Z`);
      const r = await ghlGet(
        `/calendars/${encodeURIComponent(calendarId)}/free-slots?startDate=${startMs}&endDate=${endMs}&timezone=${encodeURIComponent(timezone)}`,
        creds.apiKey,
      );
      if (!r.ok) {
        console.error(`GHL free-slots error ${r.status} cal=${await h(calendarId)}`);
        return json({ error: 'Unable to load availability', slots: [] }, 502);
      }
      return json({ success: true, ...(r.body ?? {}) });
    }

    // ---- Operator path: list calendars for a client ----
    if (!(await isAuthorizedOperator(req))) {
      return json({ error: 'Forbidden: agency admin access required', calendars: [] }, 403);
    }

    const clientId = String(payload?.clientId || '');
    if (!UUID_RE.test(clientId)) {
      return json({ error: 'clientId (uuid) is required', calendars: [] }, 400);
    }

    const creds = await loadClientCreds(clientId);
    if (!creds) {
      return json({ error: 'GHL is not configured for this client', calendars: [] }, 400);
    }

    const r = await ghlGet(`/calendars/?locationId=${encodeURIComponent(creds.locationId)}`, creds.apiKey);
    if (!r.ok) {
      console.error(`GHL calendars error ${r.status} loc=${await h(creds.locationId)}`);
      return json({ error: `GHL API error: ${r.status}`, calendars: [] }, r.status === 401 || r.status === 403 ? 502 : 502);
    }

    const raw: any[] = Array.isArray(r.body?.calendars) ? r.body.calendars : [];
    // Validate every calendar against the server-side location for this client.
    const calendars = raw
      .filter((c) => !c?.locationId || String(c.locationId) === creds.locationId)
      .map((c) => ({
        id: String(c?.id ?? ''),
        name: String(c?.name ?? 'Untitled calendar'),
        description: c?.description ? String(c.description) : undefined,
        isActive: c?.isActive !== false,
      }))
      .filter((c) => c.id);

    if (raw.length !== calendars.length) {
      console.warn(`Dropped ${raw.length - calendars.length} calendars failing location validation`);
    }
    console.log(`Fetched ${calendars.length} calendars for loc=${await h(creds.locationId)}`);

    return json({ success: true, calendars });
  } catch (err) {
    console.error('fetch-ghl-calendars failure:', err instanceof Error ? err.message : 'unknown');
    return json({ error: 'Unexpected error', calendars: [] }, 500);
  }
});
