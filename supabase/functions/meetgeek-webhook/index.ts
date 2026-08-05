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
  processCalendarMeeting,
  type CalendarAppointment,
  type LifecycleDeps,
  type MeetgeekClientConfig,
} from '../_shared/meetgeekCalendarGate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mg-signature',
};

interface ActionItem {
  text: string;
  source?: string;
  assignee?: string;
  speaker?: string;
}

// Extract action items from summary text
function extractActionItemsFromSummary(summary: string): ActionItem[] {
  if (!summary) return [];
  const actionItems: ActionItem[] = [];
  const patterns = [
    /action items?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
    /next steps?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
    /tasks?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
    /to-?do:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
    /follow[- ]?ups?:?\s*\n([\s\S]*?)(?=\n\n|\n[A-Z]|$)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(summary)) !== null) {
      if (match[1]) {
        const lines = match[1].split('\n')
          .map(line => line.replace(/^[-•*\d.)\]]+\s*/, '').trim())
          .filter(line => line.length > 5 && !line.match(/^(action|next|task|to-?do|follow)/i));
        lines.forEach(line => {
          if (!actionItems.some(item => item.text.toLowerCase() === line.toLowerCase())) {
            actionItems.push({ text: line, source: 'summary_parse' });
          }
        });
      }
    }
  }
  return actionItems;
}

// Deduplicate action items
function deduplicateActionItems(items: ActionItem[]): ActionItem[] {
  const unique: ActionItem[] = [];
  for (const item of items) {
    const normalizedText = item.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const isDuplicate = unique.some(existing => {
      const existingNormalized = existing.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      return existingNormalized === normalizedText ||
             existingNormalized.includes(normalizedText) ||
             normalizedText.includes(existingNormalized);
    });
    if (!isDuplicate && normalizedText.length > 5) {
      unique.push(item);
    }
  }
  return unique;
}

// Verify HMAC SHA-256 signature
async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hexSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hexSig === signature;
  } catch (e) {
    console.error('Signature verification failed:', e);
    return false;
  }
}

function getBaseUrl(region: string): string {
  return region === 'eu' ? 'https://api-eu.meetgeek.ai' : 'https://api-us.meetgeek.ai';
}

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

/** Builds the calendar-gated lifecycle dependencies (all IO, service role). */
function buildLifecycleDeps(supabase: any): LifecycleDeps {
  return {
    async getConfigForMeeting(meeting) {
      // Client authority: an attendee that already exists as a lead of a client
      // whose MeetGeek integration is configured. Never from the request URL.
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
      // Deliberately NO title-based fallback here: a meeting title is
      // attacker-controllable text and must never assign a tenant.
      // Only clients with an enabled MeetGeek config qualify; ambiguity is refused.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const rawBody = await req.text();

    // ---------------------------------------------------------------
    // Signed provider webhook path (meeting intelligence bridge).
    // The raw body is verified BEFORE it is parsed. Unsigned provider
    // payloads are rejected. Internal UI calls use `action` instead.
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
      return new Response(JSON.stringify(result), {
        status: result.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = JSON.parse(rawBody);
    console.log('Received webhook/request:', JSON.stringify(body).slice(0, 500));

    // Determine client_id from body or query
    const clientId = body.client_id || new URL(req.url).searchParams.get('client_id');

    // -----------------------------------------------------------------
    // Per-client MeetGeek configuration + health (server-derived only).
    // The browser may name a client, but location/calendar authority is
    // always re-derived here from the client's mapped GHL credentials.
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
        const requestedCalendarId = body.ghl_calendar_id ? String(body.ghl_calendar_id) : null;

        let mappingValid = false;
        let mappingError: string | null = null;
        let calendarName: string | null = null;

        if (!apiKey || !locationId) {
          mappingError = 'No mapped HighLevel location/API key for this client.';
        } else if (!requestedCalendarId) {
          mappingError = 'Select a HighLevel calendar for MeetGeek to operate on.';
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

    // Fetch per-client MeetGeek settings from client_settings
    let meetgeekApiKey = '';
    let meetgeekWebhookSecret = '';
    let meetgeekRegion = 'us';

    if (clientId) {
      const { data: cs } = await supabase
        .from('client_settings')
        .select('meetgeek_api_key, meetgeek_webhook_secret, meetgeek_region, meetgeek_enabled')
        .eq('client_id', clientId)
        .maybeSingle();
      
      if (cs?.meetgeek_enabled && cs?.meetgeek_api_key) {
        meetgeekApiKey = cs.meetgeek_api_key;
        meetgeekWebhookSecret = cs.meetgeek_webhook_secret || '';
        meetgeekRegion = cs.meetgeek_region || 'us';
      }
    }

    // Fallback to agency-level settings or env secret
    if (!meetgeekApiKey) {
      const { data: settings } = await supabase
        .from('agency_settings')
        .select('meetgeek_api_key, meetgeek_webhook_secret')
        .limit(1)
        .maybeSingle();

      if (settings?.meetgeek_api_key) {
        meetgeekApiKey = settings.meetgeek_api_key;
        meetgeekWebhookSecret = settings.meetgeek_webhook_secret || '';
      } else {
        meetgeekApiKey = Deno.env.get('MEETGEEK_API_KEY') || '';
      }
      // Auto-detect region from key prefix
      if (meetgeekApiKey.startsWith('eu-')) {
        meetgeekRegion = 'eu';
      }
    }

    if (!meetgeekApiKey) {
      return new Response(JSON.stringify({ error: 'MeetGeek API key not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const baseUrl = getBaseUrl(meetgeekRegion);

    // Handle manual sync request
    if (body.action === 'sync') {
      const since = body.since || undefined;
      const result = await syncRecentMeetings(supabase, meetgeekApiKey, baseUrl, clientId, since);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle daily cron sync for all clients with MeetGeek enabled
    if (body.action === 'sync_all') {
      const { data: allSettings } = await supabase
        .from('client_settings')
        .select('client_id, meetgeek_api_key, meetgeek_region')
        .eq('meetgeek_enabled', true);

      const results: any[] = [];
      // Also sync with agency-level key (unassigned meetings)
      const agencySince = body.since || new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const agencyResult = await syncRecentMeetings(supabase, meetgeekApiKey, baseUrl, undefined, agencySince);
      results.push({ client: 'agency', ...agencyResult });

      // Sync per-client if they have their own key
      if (allSettings?.length) {
        for (const cs of allSettings) {
          if (cs.meetgeek_api_key) {
            const cBaseUrl = getBaseUrl(cs.meetgeek_region || 'us');
            const cResult = await syncRecentMeetings(supabase, cs.meetgeek_api_key, cBaseUrl, cs.client_id, agencySince);
            results.push({ client: cs.client_id, ...cResult });
          }
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle manual single-call transcript sync
    if (body.action === 'sync_call_transcript') {
      const result = await syncCallTranscript(supabase, meetgeekApiKey, baseUrl, body.call_id, body.meeting_id);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Re-run client-by-title matching across stored meetings (default: only unmatched).
    if (body.action === 'remap_clients') {
      const onlyUnmatched = body.only_unmatched !== false;
      let query = supabase.from('agency_meetings').select('id, title, client_id');
      if (onlyUnmatched) query = query.is('client_id', null);
      const { data: meetings, error } = await query;
      if (error) throw error;
      let updated = 0;
      let scanned = 0;
      const changes: any[] = [];
      for (const m of meetings || []) {
        scanned++;
        const matched = await matchClientByTitle(supabase, m.title || '');
        if (matched && matched !== m.client_id) {
          await supabase.from('agency_meetings').update({ client_id: matched }).eq('id', m.id);
          updated++;
          changes.push({ title: m.title, from: m.client_id, to: matched });
        }
      }
      return new Response(JSON.stringify({ success: true, scanned, updated, changes: changes.slice(0, 50) }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ message: 'No action taken' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Error processing webhook:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

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
        noteBuilder: (m) => buildMeetingNote(m),
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
    async resolveClientId(meeting: NormalizedMeeting) {
      // 1. Server-side mapping via an attendee that already exists as a lead.
      const emails = meeting.participants
        .map((p) => normalizeEmail(p.email))
        .filter((e): e is string => !!e);
      if (emails.length) {
        const { data } = await supabase
          .from('leads')
          .select('client_id')
          .in('email', emails)
          .not('client_id', 'is', null)
          .limit(1);
        if (data?.[0]?.client_id) return data[0].client_id as string;
      }
      // 2. Fall back to the existing canonical title-matching heuristic.
      return await matchClientByTitle(supabase, meeting.title || '');
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
    async writeGhlNote({ clientId, lead, note }) {
      const contactId = lead.external_id || null;
      if (!contactId) return { status: 'skipped', contactId: null, error: 'no_ghl_contact_id' };
      const { data: client } = await supabase
        .from('clients')
        .select('ghl_api_key, ghl_location_id')
        .eq('id', clientId)
        .maybeSingle();
      const apiKey = client?.ghl_api_key;
      if (!apiKey || !client?.ghl_location_id) {
        return { status: 'skipped', contactId, error: 'ghl_credentials_missing' };
      }
      try {
        const res = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ body: note }),
        });
        if (!res.ok) {
          const text = await res.text();
          return { status: 'error', contactId, error: `GHL ${res.status}: ${text.slice(0, 300)}` };
        }
        return { status: 'written', contactId };
      } catch (e) {
        return { status: 'error', contactId, error: e instanceof Error ? e.message : 'ghl_request_failed' };
      }
    },
  };
}

async function syncCallTranscript(
  supabase: any, apiKey: string, baseUrl: string,
  callId: string, meetingId?: string
) {
  try {
    // If we have a meetingId, fetch transcript directly
    if (meetingId) {
      const transcript = await fetchTranscript(apiKey, baseUrl, meetingId);
      const summary = await fetchSummary(apiKey, baseUrl, meetingId);

      const { error } = await supabase
        .from('calls')
        .update({
          transcript: transcript || null,
          summary: summary || null,
        })
        .eq('id', callId);

      if (error) throw error;
      return { success: true, callId, hasTranscript: !!transcript, hasSummary: !!summary };
    }

    // Otherwise, try to match by searching recent meetings
    const response = await fetch(`${baseUrl}/v1/meetings?limit=50`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`MeetGeek API error: ${response.status}`);
    
    const data = await response.json();
    const meetings = data.meetings || data.data || [];

    // Get the call to match
    const { data: call } = await supabase
      .from('calls')
      .select('*')
      .eq('id', callId)
      .single();

    if (!call) throw new Error('Call not found');

    // Try to match by external_id or timestamp
    let matched = meetings.find((m: any) => m.id === call.external_id);
    
    if (!matched && call.scheduled_at) {
      const callTime = new Date(call.scheduled_at).getTime();
      matched = meetings.find((m: any) => {
        const meetingTime = new Date(m.start_time).getTime();
        return Math.abs(meetingTime - callTime) < 30 * 60 * 1000; // 30 min window
      });
    }

    if (!matched) {
      return { success: false, error: 'No matching MeetGeek meeting found' };
    }

    const transcript = await fetchTranscript(apiKey, baseUrl, matched.id);
    const summary = await fetchSummary(apiKey, baseUrl, matched.id);

    const { error } = await supabase
      .from('calls')
      .update({
        transcript: transcript || null,
        summary: summary || null,
        external_id: matched.id,
      })
      .eq('id', callId);

    if (error) throw error;
    return { success: true, callId, meetingId: matched.id, hasTranscript: !!transcript, hasSummary: !!summary };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

async function fetchTranscript(apiKey: string, baseUrl: string, meetingId: string): Promise<string> {
  try {
    const response = await fetch(`${baseUrl}/v1/meetings/${meetingId}/transcript`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (response.ok) {
      const data = await response.json();
      return data.transcript || '';
    }
  } catch (e) {
    console.log('Could not fetch transcript:', e);
  }
  return '';
}

async function fetchSummary(apiKey: string, baseUrl: string, meetingId: string): Promise<string> {
  try {
    const response = await fetch(`${baseUrl}/v1/meetings/${meetingId}/summary`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (response.ok) {
      const data = await response.json();
      return data.summary || '';
    }
  } catch (e) {
    console.log('Could not fetch summary:', e);
  }
  return '';
}

async function syncRecentMeetings(supabase: any, apiKey: string, baseUrl: string, clientId?: string, since?: string) {
  try {
    let allMeetings: any[] = [];
    let page = 1;
    const perPage = 50;
    const sinceDate = since ? new Date(since) : null;

    // Paginate through meetings
    while (true) {
      const url = `${baseUrl}/v1/meetings?limit=${perPage}&page=${page}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error(`MeetGeek API error: ${response.status} - ${errText}`);
        throw new Error(`MeetGeek API error: ${response.status}`);
      }

      const data = await response.json();
      const meetings = data.meetings || data.data || data.results || [];
      if (meetings.length === 0) break;

      // Normalize field names (API may use meeting_id/timestamp_start_utc or id/start_time)
      const normalized = meetings.map((m: any) => ({
        ...m,
        id: m.id || m.meeting_id,
        start_time: m.start_time || m.timestamp_start_utc,
        end_time: m.end_time || m.timestamp_end_utc,
      }));

      // Filter by since date if provided
      let reachedOlder = false;
      for (const m of normalized) {
        const mDate = new Date(m.start_time || m.created_at || 0);
        if (sinceDate && mDate < sinceDate) {
          reachedOlder = true;
          break;
        }
        allMeetings.push(m);
      }

      if (reachedOlder || meetings.length < perPage) break;
      page++;
      // Safety cap at 10 pages (500 meetings)
      if (page > 10) break;
    }

    console.log(`Found ${allMeetings.length} meetings to sync (since: ${since || 'all'})`);

    let synced = 0;
    let skipped = 0;
    let callsUpdated = 0;

    for (const meeting of allMeetings) {
      const { data: existing } = await supabase
        .from('agency_meetings')
        .select('id')
        .eq('meeting_id', meeting.id)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const result = await processMeeting(supabase, apiKey, baseUrl, meeting.id, clientId);
      if (result.success) synced++;
      if (result.callUpdated) callsUpdated++;
    }

    // Update last sync timestamp if we have a clientId
    if (clientId) {
      await supabase
        .from('client_settings')
        .update({ meetgeek_last_sync: new Date().toISOString() })
        .eq('client_id', clientId);
    }

    return { success: true, synced, skipped, callsUpdated, total: allMeetings.length };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

async function matchClientByTitle(supabase: any, title: string): Promise<string | null> {
  try {
    const { data: clients } = await supabase.from('clients').select('id, name');
    if (!clients?.length) return null;

    const STOP = new Set(['the','and','inc','llc','corp','group','capital','investments','investment','management','fund','company','co','partners','holdings','hpa']);
    const titleLower = ` ${title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;

    // Score each client by distinctive-word matches; longest distinctive word wins ties.
    let best: { id: string; score: number; longest: number } | null = null;
    for (const client of clients) {
      const cleanName = client.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

      // 1. Exact full-name substring match — strongest signal.
      if (cleanName.length >= 4 && titleLower.includes(` ${cleanName} `)) {
        return client.id;
      }

      // 2. Score on distinctive (non-stop) words present as whole words in the title.
      const words = cleanName.split(/\s+/).filter((w: string) => w.length > 2 && !STOP.has(w));
      if (!words.length) continue;
      let score = 0;
      let longest = 0;
      for (const w of words) {
        if (titleLower.includes(` ${w} `)) {
          score++;
          if (w.length > longest) longest = w.length;
        }
      }
      if (score === 0) continue;
      if (!best || score > best.score || (score === best.score && longest > best.longest)) {
        best = { id: client.id, score, longest };
      }
    }
    return best?.id || null;
  } catch { return null; }
}

async function processMeeting(supabase: any, apiKey: string, baseUrl: string, meetingId: string, forClientId?: string) {
  try {
    const meetingResponse = await fetch(`${baseUrl}/v1/meetings/${meetingId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!meetingResponse.ok) throw new Error(`Failed to fetch meeting: ${meetingResponse.status}`);

    const meeting = await meetingResponse.json();
    const transcript = await fetchTranscript(apiKey, baseUrl, meetingId);
    const summary = await fetchSummary(apiKey, baseUrl, meetingId);

    // Fetch action items from insights
    let allActionItems: ActionItem[] = [];
    try {
      const insightsResponse = await fetch(`${baseUrl}/v1/meetings/${meetingId}/insights`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (insightsResponse.ok) {
        const data = await insightsResponse.json();
        allActionItems.push(...(data.action_items || []).map((i: any) => ({
          text: i.text, assignee: i.assignee, source: 'insights'
        })));
      }
    } catch {}

    // Fetch highlights
    let meetingHighlights: any[] = [];
    try {
      const hlResponse = await fetch(`${baseUrl}/v1/meetings/${meetingId}/highlights`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (hlResponse.ok) {
        const data = await hlResponse.json();
        meetingHighlights = (data.highlights || data || []);
        // Also extract action items from highlights
        const tasks = meetingHighlights
          .filter((h: any) => h.label === 'Task' || h.label === 'Action Item')
          .map((h: any) => ({ text: h.highlightText || h.text, source: 'highlights', speaker: h.speaker }));
        allActionItems.push(...tasks);
      }
    } catch {}

    // Parse summary
    allActionItems.push(...extractActionItemsFromSummary(summary));
    const uniqueActionItems = deduplicateActionItems(allActionItems);

    let durationMinutes = meeting.duration;
    const startTime = meeting.start_time || meeting.timestamp_start_utc;
    const endTime = meeting.end_time || meeting.timestamp_end_utc;
    if (startTime && endTime) {
      durationMinutes = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
    }

    const meetingDate = startTime || new Date().toISOString();
    const matchedClientId = forClientId || await matchClientByTitle(supabase, meeting.title || '');

    // Store in agency_meetings
    const { data: insertedMeeting, error: insertError } = await supabase
      .from('agency_meetings')
      .upsert({
        meeting_id: meetingId,
        title: meeting.title || 'Untitled Meeting',
        meeting_date: meetingDate,
        duration_minutes: durationMinutes,
        participants: meeting.participants || [],
        summary,
        transcript,
        action_items: uniqueActionItems,
        recording_url: meeting.recording_url,
        meetgeek_url: meeting.meetgeek_url || `https://app.meetgeek.ai/meetings/${meetingId}`,
        client_id: matchedClientId,
        highlights: meetingHighlights.length > 0 ? meetingHighlights : (meeting.highlights || []),
      }, { onConflict: 'meeting_id' })
      .select()
      .single();

    if (insertError) throw insertError;

    // Try to match and update a call record with transcript/summary
    let callUpdated = false;
    if (matchedClientId && meeting.start_time) {
      const meetingTime = new Date(meeting.start_time).getTime();
      const { data: calls } = await supabase
        .from('calls')
        .select('id, scheduled_at, external_id')
        .eq('client_id', matchedClientId)
        .gte('scheduled_at', new Date(meetingTime - 60 * 60 * 1000).toISOString())
        .lte('scheduled_at', new Date(meetingTime + 60 * 60 * 1000).toISOString())
        .limit(5);

      if (calls?.length) {
        // Find closest call
        let closest = calls[0];
        let minDiff = Infinity;
        for (const c of calls) {
          if (c.scheduled_at) {
            const diff = Math.abs(new Date(c.scheduled_at).getTime() - meetingTime);
            if (diff < minDiff) { minDiff = diff; closest = c; }
          }
        }
        
        const { error: updateErr } = await supabase
          .from('calls')
          .update({
            transcript: transcript || null,
            summary: summary || null,
          })
          .eq('id', closest.id);
        
        if (!updateErr) {
          callUpdated = true;
          console.log(`Updated call ${closest.id} with transcript from meeting ${meetingId}`);
        }
      }
    }

    // Create pending tasks (works for ALL clients, including unmatched — they appear in
    // the global pending queue so an admin can re-assign the meeting client_id later).
    if (uniqueActionItems.length > 0) {
      const pendingTasks = uniqueActionItems.map((item: ActionItem) => ({
        meeting_id: insertedMeeting.id,
        client_id: matchedClientId,
        title: item.text.slice(0, 200),
        description: item.assignee ? `Assigned to: ${item.assignee}` : '',
        priority: 'medium',
        status: 'pending',
      }));
      const { error: pendErr } = await supabase.from('pending_meeting_tasks').insert(pendingTasks);
      if (pendErr) {
        console.error('[MeetGeek] pending_meeting_tasks insert failed:', pendErr);
      } else {
        console.log(`[MeetGeek] Created ${pendingTasks.length} pending tasks (client=${matchedClientId || 'UNMATCHED'})`);
      }
    }

    return { success: true, meetingId: insertedMeeting.id, actionItems: uniqueActionItems.length, callUpdated };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message, callUpdated: false };
  }
}

// ---------------------------------------------------------------------------
// Safe, self-contained test event.
// Proves database ingestion + client isolation using ONLY our own gate and
// tables. It registers no external webhook, calls no MeetGeek endpoint and
// invents no provider payload/header format.
// ---------------------------------------------------------------------------
async function runMeetgeekTestEvent(
  supabase: any,
  clientId: string,
  mode: 'match' | 'wrong_calendar' | 'wrong_client',
): Promise<Record<string, unknown>> {
  const config = await loadMeetgeekConfig(supabase, clientId);
  if (!config) {
    return { ok: false, error: 'MeetGeek is not configured for this client yet. Save the configuration first.' };
  }
  if (!config.mappingValid || !config.ghlCalendarId) {
    return { ok: false, error: config.ghlCalendarId ? 'Mapping is invalid — re-save the configuration.' : 'Select a calendar first.' };
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
  };

  // The appointment is synthetic but the gate is the real one.
  const appointment: CalendarAppointment = {
    eventId: `selftest-evt-${now.getTime()}`,
    calendarId: mode === 'wrong_calendar' ? `${config.ghlCalendarId}-not-selected` : config.ghlCalendarId,
    locationId: mode === 'wrong_client' ? `${config.ghlLocationId}-other` : config.ghlLocationId,
    contactId: null,
    attendeeEmail: null,
    title: 'MeetGeek configuration self-test',
    startTime: stamp,
    endTime: stamp,
    isVideo: true,
  };

  const decision = evaluateCalendarGate({ config, appointments: [appointment] });
  const rejected = decision.allowed ? null : decision.reason;

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
    mode,
    gate: rejected ? 'rejected' : 'allowed',
    reason: rejected ? GATE_REJECTION_MESSAGES[rejected] : null,
    activity: data,
    isolation_ok: (count ?? 0) === 0,
  };
}
