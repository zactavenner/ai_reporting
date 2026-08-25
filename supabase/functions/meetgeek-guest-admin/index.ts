// Operator-gated admin bridge for the guest-only calendar orchestration.
// Returns ONLY redacted connection metadata — never tokens.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { authorizeOperator } from '../_shared/operatorAuth.ts';
import { normalizeEmail, redactConnection } from '../_shared/calendarGuest.ts';
import { verifyConnection } from '../_shared/googleCalendarClient.ts';
import {
  ghlAppointmentWebhookSecretConfigured,
  revealStoredGhlAppointmentWebhookSecret,
} from '../_shared/webhookSecret.ts';
import { SHARED_SECRET_HEADER } from '../_shared/calendarGuest.ts';
import { getMappedGhl } from '../_shared/ghlMapping.ts';
import { runGuestInvitePolling } from '../_shared/guestPoller.ts';
import { resolveInviteSender } from '../_shared/shadowInviteSender.ts';
import { rollupAttendance, syncGhlAttendance } from '../_shared/ghlAttendance.ts';
import { reconcileCoverage, summarizeCoverage } from '../_shared/notetakerCoverage.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-token',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const DEFAULT_BOT_GUEST_EMAIL = 'theainotetaker@gmail.com';
const NEEDS_CALENDAR_SELECTION = 'needs calendar selection';
const BOOKING_HINTS = /(discovery|investor|intro|booking|consult|strategy|qualif|call)/i;

/** Server-only CRM calendar read. Never returns credentials. */
async function listGhlCalendars(apiKey: string, locationId: string) {
  const attempts = [
    { url: `https://services.leadconnectorhq.com/calendars/?locationId=${encodeURIComponent(locationId)}`, version: true },
    { url: 'https://rest.gohighlevel.com/v1/calendars/services', version: false },
  ];
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(attempt.version ? { Version: '2021-07-28' } : {}),
        },
      });
      if (!res.ok) continue;
      const body: any = await res.json().catch(() => null);
      const raw = body?.calendars || body?.services || [];
      const cals = (Array.isArray(raw) ? raw : [])
        .map((c: any) => ({ id: String(c?.id || ''), name: String(c?.name || ''), active: c?.isActive !== false }))
        .filter((c: any) => c.id);
      if (cals.length) return cals;
    } catch {
      // try the next transport
    }
  }
  return [] as { id: string; name: string; active: boolean }[];
}

/** Pick the single primary booking calendar, or null when it is ambiguous. */
function pickPrimaryCalendar(cals: { id: string; name: string; active: boolean }[]) {
  const active = cals.filter((c) => c.active);
  const pool = active.length ? active : cals;
  if (pool.length === 1) return pool[0];
  const hinted = pool.filter((c) => BOOKING_HINTS.test(c.name));
  if (hinted.length === 1) return hinted[0];
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON body required' }, 400);
  }

  // Trusted internal caller (cron / operator tooling) uses the project's
  // internal password in the body; everyone else must pass the operator check.
  const internal = body?.password === 'HPA1234$';
  if (!internal) {
    const auth = await authorizeOperator(req, supabase, createClient, body);
    if (!auth.ok) return json({ error: auth.error, code: auth.code }, auth.status);
  }

  const action = String(body?.action || '');
  const clientId = body?.client_id ? String(body.client_id) : null;

  try {
    switch (action) {
      // Operator-only: the exact values needed to wire each GHL location's
      // "Customer Booked Appointment" workflow webhook action.
      case 'gc_webhook_setup': {
        const secret = await revealStoredGhlAppointmentWebhookSecret(supabase);
        const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ghl-appointment-webhook`;
        const { data: locations } = await supabase
          .from('clients')
          .select('id, name, status, ghl_location_id')
          .not('ghl_location_id', 'is', null)
          .order('name');
        return json({
          webhook_url: webhookUrl,
          secret_header: SHARED_SECRET_HEADER,
          secret,
          secret_configured: await ghlAppointmentWebhookSecretConfigured(supabase),
          optional: true,
          optional_note:
            'Optional real-time boost. Bookings are already detected by the 10-minute poller, so the workflow only makes invites instant.',
          instructions: [
            'In the client’s GHL location, open Automation → Workflows → Create Workflow (Start from Scratch).',
            'Add trigger: "Customer Booked Appointment" (optionally filter to the booking calendar).',
            'Add action: "Webhook" → Method POST → URL = the webhook URL below.',
            `Under Headers add: ${SHARED_SECRET_HEADER} = the shared secret below.`,
            'Leave the body as the default appointment payload, then Save and Publish the workflow.',
          ],
          locations: (locations || []).map((c: any) => ({
            client_id: c.id,
            client_name: c.name,
            client_status: c.status,
            ghl_location_id: c.ghl_location_id,
          })),
        });
      }

      // Operator-triggered run of the polling ingest (same code path as cron).
      case 'gc_run_poll': {
        const result = await runGuestInvitePolling({
          supabase,
          clientId,
          horizonDays: Number(body?.horizon_days) > 0 ? Number(body.horizon_days) : 14,
          scanGoogle: body?.scan_google !== false,
          force: !!body?.force,
        });
        return json({ ok: true, ...result });
      }

      // ---- Durable coverage ledger (booking → transcript) ----
      // Read-only rollup + open exceptions for the operator UI.
      case 'coverage_overview': {
        const lookbackDays = Math.min(Math.max(Number(body?.lookback_days) || 14, 1), 90);
        const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
        let q = supabase
          .from('notetaker_coverage')
          .select(
            'id, client_id, ghl_appointment_id, ghl_calendar_name, contact_name, contact_email, assigned_user_name, scheduled_start, scheduled_end, meeting_url, expected_provider, appointment_state, coverage_state, outcome, invite_state, transcript_source, transcript_chars, exception_code, exception_message, overdue_at, last_checked_at',
          )
          .gte('scheduled_start', since)
          .order('scheduled_start', { ascending: false })
          .limit(2000);
        if (clientId) q = q.eq('client_id', clientId);
        const { data: rows, error } = await q;
        if (error) return json({ error: error.message }, 500);

        const { data: clientRows } = await supabase.from('clients').select('id, name');
        const clientNames = new Map((clientRows || []).map((c: any) => [c.id, c.name]));
        const all = rows || [];
        const byClient = new Map<string, any[]>();
        for (const r of all) {
          const list = byClient.get(r.client_id) || [];
          list.push(r);
          byClient.set(r.client_id, list);
        }
        const lastPoll = all.reduce<string | null>(
          (acc, r: any) => (r.last_checked_at && (!acc || r.last_checked_at > acc) ? r.last_checked_at : acc),
          null,
        );
        return json({
          generated_at: new Date().toISOString(),
          window_days: lookbackDays,
          last_reconciled_at: lastPoll,
          summary: summarizeCoverage(all),
          by_client: Array.from(byClient.entries())
            .map(([cid, list]) => ({
              client_id: cid,
              client_name: clientNames.get(cid) || 'Unassigned',
              ...summarizeCoverage(list),
            }))
            .sort((a, b) => b.exceptions - a.exceptions || b.total - a.total),
          exceptions: all
            .filter((r: any) => r.coverage_state === 'exception')
            .slice(0, 200)
            .map((r: any) => ({ ...r, client_name: clientNames.get(r.client_id) || 'Unassigned' })),
        });
      }

      // On-demand watchdog run (same code path as the 10-minute cron).
      case 'coverage_reconcile': {
        const result = await reconcileCoverage({
          supabase,
          clientId,
          lookbackDays: Number(body?.lookback_days) > 0 ? Number(body.lookback_days) : 30,
        });
        return json({ ok: true, ...result });
      }

      // Operator replay for MeetGeek ingest events that failed non-terminally.
      // Terminal (processed / ignored) events are never touched, so replay can
      // never duplicate an already-ingested meeting.
      case 'coverage_replay_ingest': {
        let q = supabase
          .from('meeting_ingest_events')
          .select('id, status, meeting_external_id, client_id, error_message, created_at')
          .eq('provider', 'meetgeek')
          .in('status', ['rejected', 'failed', 'processing'])
          .order('created_at', { ascending: false })
          .limit(200);
        if (clientId) q = q.eq('client_id', clientId);
        const { data: stuck, error } = await q;
        if (error) return json({ error: error.message }, 500);
        const ids = (stuck || []).map((r: any) => r.id);
        if (body?.apply && ids.length) {
          await supabase
            .from('meeting_ingest_events')
            .update({ status: 'received', error_message: null })
            .in('id', ids);
        }
        return json({
          applied: !!body?.apply,
          retryable: ids.length,
          events: (stuck || []).map((r: any) => ({
            id: r.id,
            status: r.status,
            meeting_external_id: r.meeting_external_id,
            error_message: r.error_message,
            created_at: r.created_at,
          })),
          note:
            'Re-opened events are reprocessed on the next MeetGeek delivery for that meeting; already-processed events are never replayed.',
        });
      }


      case 'gc_list_connections': {
        // (see ai_meetings_overview below for the read-only analytics feed)
        const { data } = await supabase
          .from('google_calendar_connections')
          .select('id, organizer_email, display_name, status, scope, refresh_token, access_token_expires_at, last_verified_at, last_error, created_at')
          .order('created_at', { ascending: false });
        return json({ connections: (data || []).map(redactConnection) });
      }

      // Read-only feed for the "AI Meetings" analytics tab: upcoming invites,
      // recorded meetings with QA + CRM sync status, and pipeline health.
      case 'ai_meetings_overview': {
        const now = new Date();
        const nowIso = now.toISOString();
        const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
        const pastLimit = Math.min(Math.max(Number(body?.past_limit) || 100, 1), 300);

        // Optional date-range filter (YYYY-MM-DD, inclusive). When absent the
        // feed keeps its previous behaviour: all upcoming + last 45 days.
        const parseDay = (v: unknown, endOfDay = false) => {
          const s = String(v || '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
          return `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
        };
        const rangeFrom = parseDay(body?.start_date);
        const rangeTo = parseDay(body?.end_date, true);
        const hasRange = !!(rangeFrom && rangeTo);

        const { data: clientRows } = await supabase.from('clients').select('id, name, status');
        const clientMap = new Map((clientRows || []).map((c: any) => [c.id, c]));

        let upcomingQ = supabase
          .from('meetgeek_guest_invite_jobs')
          .select('id, client_id, status, error_code, error_message, scheduled_start, scheduled_end, meeting_url, invite_summary, ghl_calendar_name, contact_name, contact_email, assigned_user_name, invite_provider, invite_last_sent_at, invite_send_count, meeting_record_id, ghl_appointment_status, attendance_status, attendance_checked_at')
          .gte('scheduled_start', nowIso)
          .neq('status', 'cancelled')
          .order('scheduled_start', { ascending: true })
          .limit(300);
        if (clientId) upcomingQ = upcomingQ.eq('client_id', clientId);
        if (hasRange) upcomingQ = upcomingQ.gte('scheduled_start', rangeFrom!).lte('scheduled_start', rangeTo!);
        const { data: upcomingJobs } = await upcomingQ;

        let pastQ = supabase
          .from('meeting_records')
          .select('id, client_id, title, status, started_at, ended_at, duration_minutes, summary, recording_url, source_url, contact_name, contact_email, ghl_contact_id, sales_agent_name, attribution_method, ghl_calendar_name')
          .lte('started_at', nowIso)
          .order('started_at', { ascending: false })
          .limit(pastLimit);
        if (clientId) pastQ = pastQ.eq('client_id', clientId);
        if (hasRange) pastQ = pastQ.gte('started_at', rangeFrom!).lte('started_at', rangeTo!);
        const { data: pastMeetings } = await pastQ;

        // Legacy MeetGeek-synced meetings that predate meeting_records. These are
        // always merged in so notes/summaries are never hidden.
        let legacyPast: any[] = [];
        {
          let legacyQ = supabase
            .from('agency_meetings')
            .select('id, client_id, title, meeting_date, duration_minutes, summary, action_items, recording_url, meetgeek_url')
            .order('meeting_date', { ascending: false })
            .limit(pastLimit);
          if (clientId) legacyQ = legacyQ.eq('client_id', clientId);
          if (hasRange) legacyQ = legacyQ.gte('meeting_date', rangeFrom!).lte('meeting_date', rangeTo!);
          const { data } = await legacyQ;
          legacyPast = (data || []).map((m: any) => ({
            id: m.id,
            client_id: m.client_id,
            title: m.title,
            started_at: m.meeting_date,
            duration_minutes: m.duration_minutes,
            summary: m.summary,
            action_items: Array.isArray(m.action_items) ? m.action_items : [],
            recording_url: m.recording_url || m.meetgeek_url,
            contact_name: null,
            sales_agent_name: null,
            ghl_calendar_name: null,
            source: 'meetgeek_sync',
          }));
        }

        const recordIds = (pastMeetings || []).map((m: any) => m.id);
        const activityByRecord = new Map<string, any>();
        if (recordIds.length) {
          const { data: activity } = await supabase
            .from('meeting_call_activity')
            .select('meeting_record_id, qa_total, qa_gate_status, qa_pipeline_outcome, crm_sync_status, crm_sync_error, crm_synced_at, lead_id, summary')
            .in('meeting_record_id', recordIds);
          for (const a of activity || []) activityByRecord.set(a.meeting_record_id, a);
        }

        // Pipeline health: invite job status + failure-reason rollup.
        const { data: allJobs } = await supabase
          .from('meetgeek_guest_invite_jobs')
          .select('status, error_code, invite_provider, invite_last_sent_at')
          .limit(5000);
        const statusCounts: Record<string, number> = {};
        const reasonCounts: Record<string, number> = {};
        let lastInviteSentAt: string | null = null;
        for (const j of allJobs || []) {
          statusCounts[j.status] = (statusCounts[j.status] || 0) + 1;
          if (j.status === 'pending' && j.error_code) reasonCounts[j.error_code] = (reasonCounts[j.error_code] || 0) + 1;
          if (j.invite_last_sent_at && (!lastInviteSentAt || j.invite_last_sent_at > lastInviteSentAt)) {
            lastInviteSentAt = j.invite_last_sent_at;
          }
        }

        // Past appointments that never produced a recording/transcript.
        let missedQ = supabase
          .from('meetgeek_guest_invite_jobs')
          .select('id, client_id, status, error_code, error_message, scheduled_start, scheduled_end, meeting_url, ghl_calendar_name, contact_name, contact_email, assigned_user_name, invite_provider, invite_last_sent_at, meeting_record_id, ghl_appointment_status, attendance_status, attendance_checked_at')
          .lt('scheduled_start', nowIso)
          .gte('scheduled_start', new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString())
          .is('meeting_record_id', null)
          .neq('status', 'cancelled')
          .order('scheduled_start', { ascending: false })
          .limit(pastLimit);
        if (clientId) missedQ = missedQ.eq('client_id', clientId);
        if (hasRange) missedQ = missedQ.gte('scheduled_start', rangeFrom!).lte('scheduled_start', rangeTo!);
        const { data: missedJobs } = await missedQ;

        // Attendance (show / no-show) for every booked slot in scope. The CRM
        // owns the outcome; jobs carry the synced value.
        const attFrom = hasRange ? rangeFrom! : dayStart.toISOString();
        const attTo = hasRange ? rangeTo! : dayEnd.toISOString();
        let attQ = supabase
          .from('meetgeek_guest_invite_jobs')
          .select('id, client_id, scheduled_start, attendance_status, attendance_checked_at, error_code, meeting_record_id')
          .gte('scheduled_start', attFrom)
          .lte('scheduled_start', attTo)
          .limit(3000);
        if (clientId) attQ = attQ.eq('client_id', clientId);
        const { data: attendanceRows } = await attQ;
        const attendance = rollupAttendance(attendanceRows || []);
        const attendanceByClient = new Map<string, any[]>();
        for (const r of attendanceRows || []) {
          const list = attendanceByClient.get(r.client_id) || [];
          list.push(r);
          attendanceByClient.set(r.client_id, list);
        }
        const lastAttendanceCheck = (attendanceRows || []).reduce<string | null>(
          (acc, r: any) => (r.attendance_checked_at && (!acc || r.attendance_checked_at > acc) ? r.attendance_checked_at : acc),
          null,
        );

        const sender = await resolveInviteSender(supabase);
        const { count: enabledConfigs } = await supabase
          .from('client_meetgeek_guest_configs')
          .select('id', { count: 'exact', head: true })
          .eq('enabled', true);

        const decorate = (row: any) => ({
          ...row,
          client_name: clientMap.get(row.client_id)?.name || 'Unassigned',
        });

        const todayCount = (upcomingJobs || []).filter(
          (j: any) => j.scheduled_start >= dayStart.toISOString() && j.scheduled_start < dayEnd.toISOString(),
        ).length;

        return json({
          generated_at: nowIso,
          range: hasRange ? { start_date: body?.start_date, end_date: body?.end_date } : null,
          kpis: {
            past_completed: (pastMeetings || []).length + legacyPast.length,
            not_captured: (missedJobs || []).length,
            today: todayCount,
            upcoming: (upcomingJobs || []).length,
            invited: statusCounts.invited || 0,
            pending: statusCounts.pending || 0,
            no_meeting_link: reasonCounts.no_meeting_link || 0,
            showed: attendance.showed,
            noshow: attendance.noshow,
            show_rate: attendance.show_rate,
          },
          attendance: {
            ...attendance,
            window: { from: attFrom, to: attTo },
            last_checked_at: lastAttendanceCheck,
            by_client: Array.from(attendanceByClient.entries())
              .map(([cid, rows]) => ({
                client_id: cid,
                client_name: clientMap.get(cid)?.name || 'Unassigned',
                ...rollupAttendance(rows),
              }))
              .sort((a, b) => b.total - a.total),
          },
          upcoming: (upcomingJobs || []).map(decorate),
          missed: (missedJobs || []).map((j: any) => ({
            ...decorate(j),
            capture_reason:
              j.status === 'invited'
                ? 'Notetaker was invited but no recording/transcript came back — the bot likely never got admitted to the room.'
                : j.error_code === 'no_meeting_link'
                  ? 'No join URL on the CRM appointment (phone or in-person), so nothing could be recorded.'
                  : j.error_message || 'Invite never completed, so the call was not captured.',
          })),
          past: [
            ...(pastMeetings || []),
            ...legacyPast,
          ].map((m: any) => {
            const a = activityByRecord.get(m.id) || {};
            return {
              ...decorate(m),
              summary: m.summary || a.summary || null,
              action_items: Array.isArray(m.action_items) ? m.action_items : [],
              source: m.source || 'notetaker',
              qa_total: a.qa_total ?? null,
              qa_gate_status: a.qa_gate_status ?? null,
              qa_pipeline_outcome: a.qa_pipeline_outcome ?? null,
              crm_sync_status: a.crm_sync_status ?? (m.ghl_contact_id ? 'linked' : 'unmatched'),
              crm_sync_error: a.crm_sync_error ?? null,
              crm_synced_at: a.crm_synced_at ?? null,
              lead_id: a.lead_id ?? null,
            };
          }),
          health: {
            job_status: statusCounts,
            pending_reasons: reasonCounts,
            enabled_clients: enabledConfigs || 0,
            last_invite_sent_at: lastInviteSentAt,
            sender: { configured: sender.configured, provider: (sender as any).provider ?? null, from_email: sender.from_email ?? null, detail: sender.detail ?? null },
          },
        });
      }

      case 'gc_verify_connection': {
        const id = String(body?.connection_id || '');
        if (!id) return json({ error: 'connection_id required' }, 400);
        const result = await verifyConnection(supabase, id);
        return json(result);
      }

      // Refresh show / no-show outcomes from the CRM for a date window.
      case 'ai_meetings_attendance_sync': {
        const day = (v: unknown, endOfDay = false) => {
          const s = String(v || '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
          return `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
        };
        const todayIso = new Date().toISOString().slice(0, 10);
        const startIso = day(body?.start_date) || `${todayIso}T00:00:00.000Z`;
        const endIso = day(body?.end_date, true) || `${todayIso}T23:59:59.999Z`;
        const result = await syncGhlAttendance({ supabase, clientId, startIso, endIso });
        return json({ ok: true, ...result });
      }

      case 'gc_verify_connection_legacy': {
        const id = String(body?.connection_id || '');
        if (!id) return json({ error: 'connection_id required' }, 400);
        const result = await verifyConnection(supabase, id);
        return json(result);
      }

      case 'gc_disconnect': {
        const id = String(body?.connection_id || '');
        if (!id) return json({ error: 'connection_id required' }, 400);
        // Disabling every dependent client config is part of disconnecting.
        await supabase
          .from('client_meetgeek_guest_configs')
          .update({ enabled: false, validation_status: 'connection_removed' })
          .eq('calendar_connection_id', id);
        await supabase.from('google_calendar_connections').delete().eq('id', id);
        return json({ success: true });
      }

      case 'gc_get_guest_config': {
        if (!clientId) return json({ error: 'client_id required' }, 400);
        const { data: config } = await supabase
          .from('client_meetgeek_guest_configs')
          .select('*')
          .eq('client_id', clientId)
          .maybeSingle();
        const mapping = await getMappedGhl(supabase, clientId);
        const { data: jobs } = await supabase
          .from('meetgeek_guest_invite_jobs')
          .select('id, ghl_appointment_id, google_event_id, status, attempts, rejection_reason, error_message, scheduled_start, created_at, completed_at')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(20);
        return json({
          config: config
            ? {
                id: config.id,
                client_id: config.client_id,
                ghl_location_id: config.ghl_location_id,
                ghl_calendar_id: config.ghl_calendar_id,
                calendar_connection_id: config.calendar_connection_id,
                organizer_calendar_id: config.organizer_calendar_id,
                bot_guest_email: config.bot_guest_email,
                enabled: config.enabled,
                validation_status: config.validation_status,
                validation_error: config.validation_error,
                last_validated_at: config.last_validated_at,
                last_invite_at: config.last_invite_at,
                last_error: config.last_error,
              }
            : null,
          location_mapped: !!mapping.locationId,
          crm_key_present: !!mapping.apiKey,
          webhook_secret_configured: await ghlAppointmentWebhookSecretConfigured(supabase),
          jobs: jobs || [],
        });
      }

      case 'gc_save_guest_config': {
        if (!clientId) return json({ error: 'client_id required' }, 400);
        const mapping = await getMappedGhl(supabase, clientId);
        const locationId = mapping.locationId;

        const connectionId = body?.calendar_connection_id ? String(body.calendar_connection_id) : null;
        const botEmail = normalizeEmail(body?.bot_guest_email);
        const ghlCalendarId = body?.ghl_calendar_id ? String(body.ghl_calendar_id) : null;
        const organizerCalendarId = body?.organizer_calendar_id ? String(body.organizer_calendar_id) : 'primary';
        const wantEnabled = !!body?.enabled;

        let connectionOk = false;
        if (connectionId) {
          const result = await verifyConnection(supabase, connectionId);
          connectionOk = result.ok;
        }

        // Fail-closed: enabling requires a full, verified mapping.
        const blockers: string[] = [];
        if (!locationId) blockers.push('no CRM location mapped');
        if (!mapping.apiKey) blockers.push('no CRM API key stored for this client');
        if (!ghlCalendarId) blockers.push('no CRM calendar selected');
        if (!connectionId) blockers.push('no organizer calendar connection');
        else if (!connectionOk) blockers.push('organizer calendar connection failed verification');
        if (!botEmail) blockers.push('no notetaker guest email');
        // The GHL workflow webhook is optional (real-time boost only) — the
        // 10-minute poller detects bookings without it, so a missing shared
        // secret never blocks activation.

        const enabled = wantEnabled && blockers.length === 0;
        const { error } = await supabase.from('client_meetgeek_guest_configs').upsert(
          {
            client_id: clientId,
            ghl_location_id: locationId,
            ghl_calendar_id: ghlCalendarId,
            calendar_connection_id: connectionId,
            organizer_calendar_id: organizerCalendarId,
            bot_guest_email: botEmail,
            enabled,
            validation_status: blockers.length === 0 ? 'validated' : 'blocked',
            validation_error: blockers.length ? blockers.join('; ') : null,
            last_validated_at: new Date().toISOString(),
          },
          { onConflict: 'client_id' },
        );
        if (error) return json({ error: error.message }, 500);
        return json({
          success: true,
          enabled,
          blockers,
          note: wantEnabled && !enabled ? 'Saved but kept disabled until every blocker is cleared.' : undefined,
        });
      }

      // ---- Agency-wide notetaker rollout ----
      case 'gc_rollout_status':
      case 'gc_bulk_rollout': {
        const apply = action === 'gc_bulk_rollout';
        const botEmail = normalizeEmail(body?.bot_guest_email) || DEFAULT_BOT_GUEST_EMAIL;
        const secretOk = await ghlAppointmentWebhookSecretConfigured(supabase);
        const senderInfo = await resolveInviteSender(supabase);

        const { data: connections } = await supabase
          .from('google_calendar_connections')
          .select('id, organizer_email, status, refresh_token')
          .order('created_at', { ascending: false });
        const usable = (connections || []).filter((c: any) => !!c.refresh_token);
        const requestedConnection = body?.calendar_connection_id ? String(body.calendar_connection_id) : null;
        const defaultConnection =
          requestedConnection || (usable.length === 1 ? String(usable[0].id) : null);
        let connectionOk = false;
        if (apply && defaultConnection) {
          const result = await verifyConnection(supabase, defaultConnection);
          connectionOk = result.ok;
        }

        // Coverage = EVERY client with a CRM location + API key. Missing
        // settings rows are seeded so no eligible client is skipped.
        const { data: eligibleClients } = await supabase
          .from('clients')
          .select('id')
          .not('ghl_location_id', 'is', null)
          .not('ghl_api_key', 'is', null);
        if (apply && (eligibleClients || []).length) {
          const { data: presentRows } = await supabase
            .from('client_meetgeek_settings')
            .select('client_id');
          const present = new Set((presentRows || []).map((r: any) => r.client_id));
          const missing = (eligibleClients || []).filter((c: any) => !present.has(c.id));
          if (missing.length) {
            await supabase
              .from('client_meetgeek_settings')
              .insert(missing.map((c: any) => ({ client_id: c.id, enabled: false })));
          }
        }

        const { data: settingsRows } = await supabase
          .from('client_meetgeek_settings')
          .select('client_id, ghl_calendar_id, ghl_calendar_name, mapping_error, bot_join_policy, enabled, booking_calendars');
        const clientIds = (settingsRows || []).map((r: any) => r.client_id);
        const { data: clientRows } = await supabase
          .from('clients')
          .select('id, name, status, ghl_api_key, ghl_location_id')
          .in('id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000']);
        const { data: guestRows } = await supabase
          .from('client_meetgeek_guest_configs')
          .select('client_id, enabled, bot_guest_email, ghl_calendar_id, calendar_connection_id, validation_status, validation_error');

        const clientById = new Map((clientRows || []).map((c: any) => [c.id, c]));
        const guestByClient = new Map((guestRows || []).map((g: any) => [g.client_id, g]));

        const results: any[] = [];
        for (const row of settingsRows || []) {
          const client = clientById.get(row.client_id);
          const name = client?.name || 'Unknown client';
          let calendarId: string | null = row.ghl_calendar_id || null;
          let calendarName: string | null = row.ghl_calendar_name || null;
          let detection: 'existing' | 'auto_mapped' | 'ambiguous' | 'unavailable' | 'skipped' =
            calendarId ? 'existing' : 'skipped';

          // ALL active booking calendars are covered by the poller. The single
          // "primary" is still recorded for display and legacy compatibility.
          let bookingCalendars: { id: string; name: string; active: boolean }[] =
            Array.isArray(row.booking_calendars) ? (row.booking_calendars as any[]) : [];
          if (apply && client?.ghl_api_key && client?.ghl_location_id) {
            const cals = await listGhlCalendars(client.ghl_api_key, client.ghl_location_id);
            if (cals.length) bookingCalendars = cals.filter((c) => c.active);
            if (!calendarId) {
              if (!cals.length) detection = 'unavailable';
              else {
                const primary = pickPrimaryCalendar(cals);
                if (primary) {
                  calendarId = primary.id;
                  calendarName = primary.name;
                  detection = 'auto_mapped';
                } else {
                  // Ambiguity no longer blocks: every active calendar is polled.
                  calendarId = bookingCalendars[0]?.id || null;
                  calendarName = bookingCalendars[0]?.name || null;
                  detection = 'auto_mapped';
                }
              }
            }
          }

          const blockers: string[] = [];
          if (!client?.ghl_location_id) blockers.push('no CRM location mapped');
          if (!client?.ghl_api_key) blockers.push('no CRM API key stored');
          if (!calendarId && !bookingCalendars.length) blockers.push(NEEDS_CALENDAR_SELECTION);
          if (!botEmail) blockers.push('no notetaker guest email');
          // Google Calendar OAuth is NOT a prerequisite any more: invites are
          // emailed as .ics shadow invites to the notetaker mailbox.
          // Sender config is a GLOBAL prerequisite, not a per-client blocker:
          // jobs park as pending and send as soon as a sender exists.
          // Webhook secret intentionally NOT a blocker: polling is the primary
          // detection path.

          const enabled = blockers.length === 0;

          if (apply) {
            await supabase
              .from('client_meetgeek_settings')
              .update({
                bot_join_policy: 'all_video_on_calendar',
                ghl_calendar_id: calendarId,
                ghl_calendar_name: calendarName,
                ingest_mode: 'all_active_calendars',
                booking_calendars: bookingCalendars as any,
                mapping_error: calendarId ? null : NEEDS_CALENDAR_SELECTION,
                enabled: enabled ? true : row.enabled,
              })
              .eq('client_id', row.client_id);

            await supabase.from('client_meetgeek_guest_configs').upsert(
              {
                client_id: row.client_id,
                ghl_location_id: client?.ghl_location_id || null,
                ghl_calendar_id: calendarId,
                calendar_connection_id: defaultConnection,
                organizer_calendar_id: 'primary',
                bot_guest_email: botEmail,
                enabled,
                validation_status: enabled ? 'validated' : 'blocked',
                validation_error: blockers.length ? blockers.join('; ') : null,
                last_validated_at: new Date().toISOString(),
              },
              { onConflict: 'client_id' },
            );
          }

          const existing = guestByClient.get(row.client_id);
          results.push({
            client_id: row.client_id,
            client_name: name,
            client_status: client?.status || null,
            calendar_mapped: !!calendarId,
            calendar_name: calendarName,
            booking_calendars: bookingCalendars.map((c) => ({ id: c.id, name: c.name })),
            calendars_covered: bookingCalendars.length,
            detection,
            bot_guest_email: apply ? botEmail : existing?.bot_guest_email || null,
            enabled: apply ? enabled : !!existing?.enabled,
            blockers,
          });
        }

        const active = results.filter((r) => r.enabled).length;
        return json({
          applied: apply,
          bot_guest_email: botEmail,
          prerequisites: {
            invite_mode: 'shadow_email',
            email_sender_configured: senderInfo.configured,
            email_sender_provider: senderInfo.provider,
            email_sender_from: senderInfo.from_email,
            email_sender_detail: senderInfo.detail,
            gmail_setting_note:
              'One-time manual step in the notetaker mailbox: Gmail → Settings → General → Event settings → "Add invitations to my calendar" → From everyone.',
            google_calendar_required: false,
            calendar_connection: !!defaultConnection,
            calendar_connection_verified: apply ? connectionOk : null,
            webhook_secret_configured: secretOk,
            webhook_optional: true,
            polling_enabled: true,
            connections: (connections || []).map(redactConnection),
          },
          summary: {
            total: results.length,
            active,
            needs_attention: results.length - active,
            needs_calendar_selection: results.filter((r) => !r.calendar_mapped).length,
          },
          clients: results.sort((a, b) => Number(a.enabled) - Number(b.enabled) || a.client_name.localeCompare(b.client_name)),
        });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error('meetgeek-guest-admin failure', String((e as Error).message).slice(0, 200));
    return json({ error: 'Request failed' }, 500);
  }
});