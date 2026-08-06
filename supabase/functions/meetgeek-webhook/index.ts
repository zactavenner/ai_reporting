// MeetGeek bridge — ONE provider webhook route plus JWT-authenticated internal
// actions. There is deliberately no legacy sync/remap/title-matching path: every
// ingestion must pass the per-client calendar gate before anything is written.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  ingestMeetgeekWebhook,
  MEETGEEK_SIGNATURE_HEADER,
  normalizeEmail,
  buildMeetingNote,
  type IngestDeps,
  type LeadRow,
  type NormalizedMeeting,
} from '../_shared/meetgeekIngest.ts';
import {
  buildActivityRow,
  evaluateCalendarGate,
  GATE_REJECTION_MESSAGES,
  hashIdForLog,
  processCalendarMeeting,
  type CalendarAppointment,
  type LifecycleDeps,
  type MeetgeekClientConfig,
} from '../_shared/meetgeekCalendarGate.ts';
import { parseMeetgeekInsights } from '../_shared/meetgeekQuality.ts';
import { authorizeOperator } from '../_shared/operatorAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mg-signature',
};

const GHL_BASE = 'https://services.leadconnectorhq.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const GHL_HEADERS = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  Version: '2021-07-28',
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

function getBaseUrl(region: string): string {
  return region === 'eu' ? 'https://api-eu.meetgeek.ai' : 'https://api-us.meetgeek.ai';
}

/**
 * Internal (non-provider) actions require the service-role key (cron) or a
 * Supabase user JWT whose subject is explicitly allowlisted in
 * `reporting_operator_users` (service-role only, no public policies).
 *
 * A plain signed-in session is NEVER sufficient: this project has no verified
 * client-to-user membership mapping, so these endpoints are an agency-OPERATOR
 * authorization boundary — not a client/tenant scope and not investor or lead
 * authorization. Until an operator is provisioned, every read/config write is
 * refused with 403 and a bootstrap message.
 */

/** Server-side only: reads the client's mapped HighLevel credentials. */
async function getMappedGhl(supabase: any, clientId: string): Promise<{ apiKey: string | null; locationId: string | null }> {
  const { data } = await supabase
    .from('clients')
    .select('ghl_api_key, ghl_location_id')
    .eq('id', clientId)
    .maybeSingle();
  return { apiKey: data?.ghl_api_key || null, locationId: data?.ghl_location_id || null };
}

function isVideoAppointment(ev: any): boolean {
  const candidates = [ev?.address, ev?.meetingUrl, ev?.location, ev?.notes]
    .filter((v) => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  if (/zoom\.us|meet\.google|teams\.microsoft|whereby|webex|https?:\/\//.test(candidates)) return true;
  const type = String(ev?.meetingLocationType || ev?.appointmentLocationType || '').toLowerCase();
  return ['zoom', 'google', 'gmeet', 'ms_teams', 'teams', 'custom'].includes(type);
}

function toGhlAppointment(ev: any): CalendarAppointment {
  return {
    eventId: String(ev?.id || ev?.eventId || ''),
    calendarId: ev?.calendarId ? String(ev.calendarId) : null,
    locationId: ev?.locationId ? String(ev.locationId) : null,
    contactId: ev?.contactId ? String(ev.contactId) : null,
    attendeeEmail: normalizeEmail(ev?.contact?.email || ev?.email || null),
    title: ev?.title || ev?.appointmentStatus || null,
    startTime: ev?.startTime ? new Date(ev.startTime).toISOString() : null,
    endTime: ev?.endTime ? new Date(ev.endTime).toISOString() : null,
    isVideo: isVideoAppointment(ev),
  };
}

/** Loads the per-client MeetGeek config. Health/status is server-owned. */
async function loadMeetgeekConfig(supabase: any, clientId: string): Promise<MeetgeekClientConfig | null> {
  const { data } = await supabase
    .from('client_meetgeek_settings')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle();
  if (!data) return null;
  return {
    clientId: data.client_id,
    enabled: !!data.enabled,
    ghlLocationId: data.ghl_location_id,
    ghlCalendarId: data.ghl_calendar_id,
    ghlCalendarName: data.ghl_calendar_name,
    botJoinPolicy: data.bot_join_policy,
    mode: data.ingest_mode === 'all_mapped_calendars' ? 'all_mapped_calendars' : 'selected_calendar',
    mappingValid: !!data.mapping_valid,
    webhookSecretConfigured: !!data.webhook_secret_configured,
  };
}

// ---------------------------------------------------------------------------
// Authenticated MeetGeek provider reads (only for calendar-validated meetings)
// ---------------------------------------------------------------------------
async function resolveMeetgeekApi(supabase: any, clientId: string): Promise<{ apiKey: string; baseUrl: string } | null> {
  const { data: cs } = await supabase
    .from('client_settings')
    .select('meetgeek_api_key, meetgeek_region, meetgeek_enabled')
    .eq('client_id', clientId)
    .maybeSingle();
  if (cs?.meetgeek_enabled && cs?.meetgeek_api_key) {
    return { apiKey: cs.meetgeek_api_key, baseUrl: getBaseUrl(cs.meetgeek_region || 'us') };
  }
  const { data: agency } = await supabase
    .from('agency_settings')
    .select('meetgeek_api_key')
    .limit(1)
    .maybeSingle();
  const apiKey = agency?.meetgeek_api_key || Deno.env.get('MEETGEEK_API_KEY') || '';
  if (!apiKey) return null;
  return { apiKey, baseUrl: getBaseUrl(apiKey.startsWith('eu-') ? 'eu' : 'us') };
}

async function mgGet(apiKey: string, baseUrl: string, path: string): Promise<any | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetches the real insights KPIs, transcript and summary for a meeting whose
 * calendar mapping has already been validated. Quality scoring consumes ONLY
 * the insights KPI values.
 */
async function enrichFromProvider(
  supabase: any,
  clientId: string,
  meeting: NormalizedMeeting,
): Promise<NormalizedMeeting> {
  const api = await resolveMeetgeekApi(supabase, clientId);
  if (!api) return meeting;
  const id = encodeURIComponent(meeting.meetingExternalId);
  const [insightsRaw, summaryRaw, transcriptRaw] = await Promise.all([
    mgGet(api.apiKey, api.baseUrl, `/v1/meetings/${id}/insights`),
    mgGet(api.apiKey, api.baseUrl, `/v1/meetings/${id}/summary`),
    mgGet(api.apiKey, api.baseUrl, `/v1/meetings/${id}/transcript`),
  ]);

  const insights = parseMeetgeekInsights(insightsRaw) ?? meeting.insights ?? null;
  const summaryText = typeof summaryRaw?.summary === 'string' ? summaryRaw.summary : null;
  const transcriptText = typeof transcriptRaw?.transcript === 'string'
    ? transcriptRaw.transcript
    : Array.isArray(transcriptRaw?.sentences)
      ? transcriptRaw.sentences.map((s: any) => String(s?.text || '')).filter(Boolean).join('\n')
      : null;

  const providerActionItems = Array.isArray(insightsRaw?.action_items)
    ? insightsRaw.action_items
        .map((i: any) => (typeof i === 'string' ? i : String(i?.text || i?.title || '')).trim())
        .filter((t: string) => t.length > 2)
        .slice(0, 25)
    : [];

  return {
    ...meeting,
    insights,
    summary: summaryText ? summaryText.slice(0, 8000) : meeting.summary,
    transcriptText: transcriptText ? transcriptText.slice(0, 200000) : null,
    actionItems: providerActionItems.length ? providerActionItems : meeting.actionItems,
  };
}

/** Builds the calendar-gated lifecycle dependencies (all IO, service role). */
function buildLifecycleDeps(supabase: any): LifecycleDeps {
  return {
    async getConfigForMeeting(meeting) {
      // Client authority: an attendee that already exists as a lead of a client
      // whose MeetGeek integration is configured. Never from the request URL and
      // never from the meeting title (attacker-controllable text).
      const emails = meeting.participants
        .map((p) => normalizeEmail(p.email))
        .filter((e): e is string => !!e);
      const candidateIds = new Set<string>();
      if (emails.length) {
        const { data } = await supabase
          .from('leads')
          .select('client_id')
          .in('email', emails)
          .not('client_id', 'is', null)
          .limit(50);
        for (const row of data || []) candidateIds.add(row.client_id as string);
      }
      const configs: MeetgeekClientConfig[] = [];
      for (const id of candidateIds) {
        const cfg = await loadMeetgeekConfig(supabase, id);
        if (cfg?.enabled) configs.push(cfg);
      }
      if (configs.length !== 1) return null;
      return configs[0];
    },
    async findAppointments(config, meeting) {
      const mode = config.mode || 'selected_calendar';
      if (!config.ghlLocationId) return [];
      if (mode === 'selected_calendar' && !config.ghlCalendarId) return [];
      const { apiKey, locationId } = await getMappedGhl(supabase, config.clientId);
      if (!apiKey || !locationId || locationId !== config.ghlLocationId) return [];
      const anchor = meeting.startedAt ? new Date(meeting.startedAt).getTime() : Date.now();
      const startTime = anchor - 60 * 60 * 1000;
      const endTime = anchor + 60 * 60 * 1000;
      const url = `${GHL_BASE}/calendars/events?locationId=${encodeURIComponent(locationId)}`
        + (mode === 'selected_calendar' && config.ghlCalendarId
          ? `&calendarId=${encodeURIComponent(config.ghlCalendarId)}`
          : '')
        + `&startTime=${startTime}&endTime=${endTime}`;
      const res = await fetch(url, { headers: GHL_HEADERS(apiKey) });
      if (!res.ok) return [];
      const json = await res.json().catch(() => ({}));
      const events = json?.events || json?.appointments || [];
      return (Array.isArray(events) ? events : [])
        .map(toGhlAppointment)
        .filter((a: CalendarAppointment) => !!a.eventId);
    },
    async findActivity(source, idempotencyKey) {
      const { data } = await supabase
        .from('meeting_call_activity')
        .select('id, status, crm_sync_status, crm_attempts')
        .eq('source', source)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      return data || null;
    },
    async upsertActivity(row) {
      const { data, error } = await supabase
        .from('meeting_call_activity')
        .upsert(row as any, { onConflict: 'source,idempotency_key' })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    async patchActivity(id, patch) {
      await supabase.from('meeting_call_activity').update(patch).eq('id', id);
    },
    async matchLead(config, emails) {
      const { data } = await supabase
        .from('leads')
        .select('id, external_id, email')
        .eq('client_id', config.clientId)
        .in('email', emails)
        .limit(1);
      return data?.[0] || null;
    },
    async enrichMeeting(config, meeting) {
      return await enrichFromProvider(supabase, config.clientId, meeting);
    },
    async writeGhlNote({ config, contactId, note }) {
      const { apiKey, locationId } = await getMappedGhl(supabase, config.clientId);
      if (!apiKey || !locationId || locationId !== config.ghlLocationId) {
        return { status: 'skipped', error: 'ghl_mapping_unavailable' };
      }
      try {
        const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
          method: 'POST',
          headers: GHL_HEADERS(apiKey),
          body: JSON.stringify({ body: note }),
        });
        if (!res.ok) {
          const text = await res.text();
          return { status: 'error', error: `GHL ${res.status}: ${text.slice(0, 300)}` };
        }
        return { status: 'written' };
      } catch (e) {
        return { status: 'error', error: e instanceof Error ? e.message : 'ghl_request_failed' };
      }
    },
    async touchHealth(clientId, patch) {
      await supabase.from('client_meetgeek_settings').update(patch).eq('client_id', clientId);
    },
  };
}

// ---------------------------------------------------------------------------
// Ingestion dependencies (all IO, service-role only, server-side mapping only)
// ---------------------------------------------------------------------------
function buildIngestDeps(supabase: any): IngestDeps {
  return {
    // Production path: per-client calendar gating + client-scoped call activity.
    async calendarGate(meeting: NormalizedMeeting) {
      const lifecycle = buildLifecycleDeps(supabase);
      const config = await lifecycle.getConfigForMeeting(meeting);
      if (!config) {
        // Fail closed: no unambiguous, enabled per-client configuration means we
        // refuse to guess a tenant and refuse to ingest.
        return { ok: false, status: 403, rejected: 'not_configured', clientId: null };
      }
      const result = await processCalendarMeeting({
        meeting,
        noteBuilder: (m, _appointment, quality) => buildMeetingNote(m, quality),
        deps: lifecycle,
      });
      return {
        ok: result.ok,
        status: result.status,
        rejected: result.rejected,
        clientId: result.clientId ?? null,
        matched: result.matched,
        crmSyncStatus: result.crmSyncStatus,
        activityId: result.activityId,
        duplicate: result.duplicate,
      };
    },
    async findProcessedEvent(dedupeKey) {
      const { data } = await supabase
        .from('meeting_ingest_events')
        .select('id, status')
        .eq('provider', 'meetgeek')
        .eq('dedupe_key', dedupeKey)
        .maybeSingle();
      return data || null;
    },
    async recordEvent(input) {
      const { data, error } = await supabase
        .from('meeting_ingest_events')
        .insert({
          provider: 'meetgeek',
          dedupe_key: input.dedupeKey,
          event_id: input.eventId,
          meeting_external_id: input.meetingExternalId,
          client_id: input.clientId,
          signature_valid: input.signatureValid,
          status: input.status,
          error_message: input.errorMessage ?? null,
          payload: input.payload as any,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    async updateEvent(id, patch) {
      const update: Record<string, unknown> = {};
      if (patch.status !== undefined) update.status = patch.status;
      if (patch.errorMessage !== undefined) update.error_message = patch.errorMessage;
      if (patch.clientId !== undefined) update.client_id = patch.clientId;
      await supabase.from('meeting_ingest_events').update(update).eq('id', id);
    },
    async resolveClientId(_meeting: NormalizedMeeting) {
      // The calendar gate is the only tenant authority. There is no title-based
      // or heuristic fallback: if the gate did not resolve a client, nothing is
      // ingested at all.
      return null;
    },
    async upsertMeetingRecord(meeting, clientId) {
      const { data, error } = await supabase
        .from('meeting_records')
        .upsert({
          provider: 'meetgeek',
          meeting_external_id: meeting.meetingExternalId,
          client_id: clientId,
          title: meeting.title,
          status: meeting.status,
          started_at: meeting.startedAt,
          ended_at: meeting.endedAt,
          duration_minutes: meeting.durationMinutes,
          language: meeting.language,
          host_email: meeting.hostEmail,
          participants: meeting.participants as any,
          summary: meeting.summary,
          action_items: meeting.actionItems as any,
          transcript_url: meeting.transcriptUrl,
          recording_url: meeting.recordingUrl,
          source_url: meeting.sourceUrl,
        }, { onConflict: 'provider,meeting_external_id' })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    async findLeadsByEmails(clientId, emails) {
      let query = supabase
        .from('leads')
        .select('id, client_id, email, name, external_id')
        .in('email', emails);
      if (clientId) query = query.eq('client_id', clientId);
      const { data, error } = await query.limit(50);
      if (error) throw error;
      return (data || []) as LeadRow[];
    },
    async upsertLeadContext(input) {
      const { error } = await supabase
        .from('lead_meeting_context')
        .upsert({
          meeting_record_id: input.meetingRecordId,
          lead_id: input.leadId,
          client_id: input.clientId,
          matched_email: input.matchedEmail,
          match_method: input.matchMethod,
          match_confidence: input.matchConfidence,
          ghl_contact_id: input.ghlContactId,
          ghl_note_status: input.ghlNoteStatus,
          ghl_note_error: input.ghlNoteError ?? null,
          ghl_note_at: input.ghlNoteStatus === 'written' ? new Date().toISOString() : null,
        }, { onConflict: 'meeting_record_id,lead_id' });
      if (error) throw error;
    },
    async writeGhlNote() {
      // The calendar gate owns the single, mapped CRM write-back.
      return { status: 'skipped', contactId: null, error: 'delegated_to_calendar_gate' };
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const rawBody = await req.text();

    // ---------------------------------------------------------------
    // The ONE provider webhook route. The raw body is HMAC-verified
    // BEFORE it is parsed; unsigned provider payloads are rejected;
    // duplicates return 200 and write nothing.
    // ---------------------------------------------------------------
    const signatureHeader = req.headers.get(MEETGEEK_SIGNATURE_HEADER);
    let hasInternalAction = false;
    if (!signatureHeader) {
      try { hasInternalAction = !!JSON.parse(rawBody)?.action; } catch { hasInternalAction = false; }
    }
    if (signatureHeader || !hasInternalAction) {
      const result = await ingestMeetgeekWebhook({
        rawBody,
        signatureHeader,
        secret: Deno.env.get('MEETGEEK_WEBHOOK_SECRET') || '',
        deps: buildIngestDeps(supabase),
      });
      return jsonResponse(result, result.status);
    }

    const body = JSON.parse(rawBody);

    // Every internal action is an agency-operator surface. Arbitrary client_id
    // reads are only ever served to provisioned operators (or service role).
    const auth = await authorizeOperator(req, supabase, createClient);
    if (!auth.ok) {
      return jsonResponse({ error: auth.error, code: auth.code }, auth.status);
    }

    const clientId = body.client_id || new URL(req.url).searchParams.get('client_id');

    // -----------------------------------------------------------------
    // Client-scoped read endpoint for the UI. Meeting/transcript tables
    // are service-role only, so all reads are funnelled through here.
    // -----------------------------------------------------------------
    if (body.action === 'mg_activity') {
      const leadId = body.lead_id ? String(body.lead_id) : null;
      if (!clientId && !leadId) {
        return jsonResponse({ error: 'client_id or lead_id is required' }, 400);
      }
      const limit = Math.min(Math.max(Number(body.limit) || 15, 1), 100);

      let aq = supabase
        .from('meeting_call_activity')
        .select('id, client_id, lead_id, status, title, attendee_email, agent_joined_at, started_at, ended_at, duration_minutes, recording_url, transcript_url, summary, action_items, crm_sync_status, crm_sync_error, error_message, quality_rating, quality_rubric, quality_summary, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (clientId) aq = aq.eq('client_id', clientId);
      if (leadId) aq = aq.eq('lead_id', leadId);
      const { data: activity, error: aErr } = await aq;
      if (aErr) throw aErr;

      let meetings: unknown[] = [];
      if (leadId) {
        const { data, error } = await supabase
          .from('lead_meeting_context')
          .select(`id, match_confidence, ghl_note_status, ghl_note_error,
            meeting_records:meeting_record_id (
              id, title, started_at, duration_minutes, summary, action_items,
              recording_url, transcript_url, source_url
            )`)
          .eq('lead_id', leadId)
          .order('created_at', { ascending: false })
          .limit(10);
        if (error) throw error;
        meetings = data || [];
      }

      return jsonResponse({ activity: activity || [], meetings });
    }

    // -----------------------------------------------------------------
    // Per-client MeetGeek configuration + health (server-derived only).
    // -----------------------------------------------------------------
    const configActions = ['mg_list_calendars', 'mg_get_config', 'mg_save_config', 'mg_test_event'];
    if (configActions.includes(body.action)) {
      if (!clientId) {
        return jsonResponse({ error: 'client_id is required' }, 400);
      }
      const secretConfigured = !!Deno.env.get('MEETGEEK_WEBHOOK_SECRET');
      const { apiKey, locationId } = await getMappedGhl(supabase, clientId);

      if (body.action === 'mg_list_calendars') {
        if (!apiKey || !locationId) {
          return jsonResponse({
            calendars: [],
            location_mapped: false,
            error: 'This client has no mapped HighLevel location or API key.',
          }, 200);
        }
        const res = await fetch(
          `${GHL_BASE}/calendars/?locationId=${encodeURIComponent(locationId)}`,
          { headers: GHL_HEADERS(apiKey) },
        );
        if (!res.ok) {
          const text = await res.text();
          return jsonResponse({
            calendars: [],
            location_mapped: true,
            error: `HighLevel calendar list failed (${res.status}).`,
            details: text.slice(0, 200),
          }, 200);
        }
        const json = await res.json().catch(() => ({}));
        const calendars = (json?.calendars || []).map((c: any) => ({
          id: String(c.id),
          name: c.name || 'Untitled calendar',
          isActive: c.isActive !== false,
        }));
        return jsonResponse({ calendars, location_mapped: true });
      }

      if (body.action === 'mg_get_config') {
        const { data } = await supabase
          .from('client_meetgeek_settings')
          .select('*')
          .eq('client_id', clientId)
          .maybeSingle();
        return jsonResponse({
          config: data || null,
          location_mapped: !!(apiKey && locationId),
          webhook_secret_configured: secretConfigured,
        });
      }

      if (body.action === 'mg_save_config') {
        const enabled = !!body.enabled;
        const policy = ['never', 'selected_calendar_video_only', 'all_video_on_calendar']
          .includes(body.bot_join_policy) ? body.bot_join_policy : 'selected_calendar_video_only';
        const ingestMode = body.ingest_mode === 'all_mapped_calendars'
          ? 'all_mapped_calendars'
          : 'selected_calendar';
        const requestedCalendarId = body.ghl_calendar_id ? String(body.ghl_calendar_id) : null;

        let mappingValid = false;
        let mappingError: string | null = null;
        let calendarName: string | null = null;

        if (!apiKey || !locationId) {
          mappingError = 'No mapped HighLevel location/API key for this client.';
        } else if (!requestedCalendarId && ingestMode === 'selected_calendar') {
          mappingError = 'Select a HighLevel calendar for MeetGeek to operate on.';
        } else if (!requestedCalendarId && ingestMode === 'all_mapped_calendars') {
          mappingValid = true;
        } else {
          const res = await fetch(
            `${GHL_BASE}/calendars/?locationId=${encodeURIComponent(locationId)}`,
            { headers: GHL_HEADERS(apiKey) },
          );
          if (!res.ok) {
            mappingError = `Could not validate the calendar against HighLevel (${res.status}).`;
          } else {
            const json = await res.json().catch(() => ({}));
            const match = (json?.calendars || []).find((c: any) => String(c.id) === requestedCalendarId);
            if (!match) {
              mappingError = 'That calendar does not belong to this client’s HighLevel location.';
            } else {
              mappingValid = true;
              calendarName = match.name || null;
            }
          }
        }

        const { data, error } = await supabase
          .from('client_meetgeek_settings')
          .upsert({
            client_id: clientId,
            enabled: enabled && mappingValid,
            // Server-derived, never taken from the request body.
            ghl_location_id: locationId,
            ghl_calendar_id: mappingValid ? requestedCalendarId : null,
            ghl_calendar_name: calendarName,
            bot_join_policy: policy,
            ingest_mode: ingestMode,
            mapping_valid: mappingValid,
            mapping_error: mappingError,
            webhook_secret_configured: secretConfigured,
          }, { onConflict: 'client_id' })
          .select('*')
          .single();
        if (error) throw error;
        return jsonResponse({ success: mappingValid, config: data, error: mappingError });
      }

      if (body.action === 'mg_test_event') {
        const result = await runMeetgeekTestEvent(supabase, clientId, body.mode || 'match');
        return jsonResponse(result, result.ok ? 200 : 400);
      }
    }

    return jsonResponse({ error: 'Unsupported action' }, 400);
  } catch (error: unknown) {
    console.error('[meetgeek] request failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// Safe, self-contained test event.
// Proves database ingestion + client isolation using ONLY our own gate and
// tables. It registers no external webhook, calls no MeetGeek endpoint and
// invents no provider payload/header format.
// ---------------------------------------------------------------------------
async function runMeetgeekTestEvent(
  supabase: any,
  clientId: string,
  testMode: 'match' | 'wrong_calendar' | 'wrong_client' | 'missing_location',
): Promise<Record<string, unknown>> {
  const config = await loadMeetgeekConfig(supabase, clientId);
  if (!config) {
    return { ok: false, error: 'MeetGeek is not configured for this client yet. Save the configuration first.' };
  }
  const mode = config.mode || 'selected_calendar';
  if (!config.mappingValid) {
    return { ok: false, error: 'Mapping is invalid — re-save the configuration.' };
  }
  if (mode === 'selected_calendar' && !config.ghlCalendarId) {
    return { ok: false, error: 'Select a calendar first.' };
  }

  const now = new Date();
  const stamp = now.toISOString();
  const syntheticMeeting: NormalizedMeeting = {
    meetingExternalId: `selftest-${clientId.slice(0, 8)}-${now.getTime()}`,
    eventId: null,
    title: 'MeetGeek configuration self-test',
    status: 'analyzed',
    isCompleted: true,
    startedAt: stamp,
    endedAt: stamp,
    durationMinutes: 0,
    language: null,
    hostEmail: null,
    participants: [],
    summary: 'Synthetic self-test row. No external provider call was made.',
    actionItems: [],
    transcriptUrl: null,
    recordingUrl: null,
    sourceUrl: null,
    insights: null,
    transcriptText: null,
  };

  // The appointment is synthetic but the gate is the real one.
  const appointment: CalendarAppointment = {
    eventId: `selftest-evt-${now.getTime()}`,
    calendarId: testMode === 'wrong_calendar'
      ? `${config.ghlCalendarId || 'cal'}-not-selected`
      : config.ghlCalendarId,
    locationId: testMode === 'missing_location'
      ? null
      : testMode === 'wrong_client' ? `${config.ghlLocationId}-other` : config.ghlLocationId,
    contactId: null,
    attendeeEmail: null,
    title: 'MeetGeek configuration self-test',
    startTime: stamp,
    endTime: stamp,
    isVideo: true,
  };

  const decision = evaluateCalendarGate({ config, appointments: [appointment] });
  const rejected = decision.allowed ? null : decision.reason;
  if (rejected) {
    console.warn('[meetgeek] selftest gate rejected', JSON.stringify({
      reason: rejected,
      client: clientId,
      configured_calendar: hashIdForLog(config.ghlCalendarId),
      seen_calendar: hashIdForLog(appointment.calendarId),
    }));
  }

  const row = buildActivityRow({
    config,
    stage: rejected ? 'rejected' : 'test',
    appointment: rejected ? null : appointment,
    meeting: syntheticMeeting,
    crmStatus: 'not_applicable',
    errorMessage: rejected ? GATE_REJECTION_MESSAGES[rejected] : null,
    source: 'meetgeek_selftest',
  });

  const { data, error } = await supabase
    .from('meeting_call_activity')
    .upsert(row as any, { onConflict: 'source,idempotency_key' })
    .select('id, client_id, status, error_message')
    .single();
  if (error) {
    return { ok: false, error: `Database ingestion failed: ${error.message}` };
  }

  // Isolation proof: this key must resolve to exactly one row, for this client.
  const { count } = await supabase
    .from('meeting_call_activity')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'meetgeek_selftest')
    .eq('idempotency_key', row.idempotency_key)
    .neq('client_id', clientId);

  return {
    ok: true,
    mode: testMode,
    ingest_mode: mode,
    gate: rejected ? 'rejected' : 'allowed',
    reason: rejected ? GATE_REJECTION_MESSAGES[rejected] : null,
    activity: data,
    isolation_ok: (count ?? 0) === 0,
  };
}
