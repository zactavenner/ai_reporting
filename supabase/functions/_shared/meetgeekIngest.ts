// Shared, dependency-injected MeetGeek ingestion core.
// Pure logic lives here so it can be unit-tested outside the Deno runtime.

export interface MeetgeekParticipant {
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface NormalizedMeeting {
  meetingExternalId: string;
  eventId: string | null;
  title: string | null;
  status: string | null;
  isCompleted: boolean;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  language: string | null;
  hostEmail: string | null;
  participants: MeetgeekParticipant[];
  summary: string | null;
  actionItems: string[];
  transcriptUrl: string | null;
  recordingUrl: string | null;
  sourceUrl: string | null;
}

export interface LeadRow {
  id: string;
  client_id: string | null;
  email: string | null;
  name?: string | null;
  external_id?: string | null;
}

export interface LeadMatch {
  lead: LeadRow | null;
  matchedEmail: string | null;
  matchMethod: 'email_exact' | 'email_domain' | 'none';
  confidence: number;
}

export interface IngestDeps {
  /**
   * Optional per-client calendar gate. When provided it is the sole authority for
   * which client a meeting belongs to and whether it may be ingested at all.
   * It also records the client-scoped call-activity lifecycle.
   */
  calendarGate?(meeting: NormalizedMeeting): Promise<{
    ok: boolean;
    status: number;
    rejected?: string;
    clientId?: string | null;
    matched?: boolean;
    crmSyncStatus?: string;
    activityId?: string;
    duplicate?: boolean;
    /** No per-client MeetGeek config exists — fall back to legacy resolution. */
    bypass?: boolean;
  }>;
  /** Returns true when an event with this dedupe key was already processed. */
  findProcessedEvent(dedupeKey: string): Promise<{ id: string; status: string } | null>;
  recordEvent(input: {
    dedupeKey: string;
    eventId: string | null;
    meetingExternalId: string | null;
    clientId: string | null;
    signatureValid: boolean;
    status: string;
    errorMessage?: string | null;
    payload: unknown;
  }): Promise<{ id: string }>;
  updateEvent(id: string, patch: { status?: string; errorMessage?: string | null; clientId?: string | null }): Promise<void>;
  /** Server-side only client resolution. Never accepts caller-supplied tenant ids. */
  resolveClientId(meeting: NormalizedMeeting): Promise<string | null>;
  upsertMeetingRecord(meeting: NormalizedMeeting, clientId: string | null): Promise<{ id: string }>;
  findLeadsByEmails(clientId: string | null, emails: string[]): Promise<LeadRow[]>;
  upsertLeadContext(input: {
    meetingRecordId: string;
    leadId: string | null;
    clientId: string | null;
    matchedEmail: string | null;
    matchMethod: string;
    matchConfidence: number;
    ghlContactId: string | null;
    ghlNoteStatus: string;
    ghlNoteError?: string | null;
  }): Promise<void>;
  /** Writes a concise note to the matched HighLevel contact. Returns status. */
  writeGhlNote(input: {
    clientId: string;
    lead: LeadRow;
    note: string;
  }): Promise<{ status: 'written' | 'skipped' | 'error'; contactId: string | null; error?: string }>;
}

export interface IngestResult {
  ok: boolean;
  status: number;
  duplicate?: boolean;
  reason?: string;
  meetingRecordId?: string;
  matched?: boolean;
  matchConfidence?: number;
  ghlNoteStatus?: string;
  activityId?: string;
  clientId?: string | null;
}

export const MEETGEEK_SIGNATURE_HEADER = 'x-mg-signature';

export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = String(email).trim().toLowerCase();
  if (!trimmed.includes('@')) return null;
  return trimmed;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies an HMAC-SHA256 signature over the exact raw request body.
 * Accepts hex or base64 digests, with or without a `sha256=` prefix.
 */
export async function verifyMeetgeekSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!secret) return false;
  if (!signatureHeader) return false;
  const provided = signatureHeader.trim().replace(/^sha256=/i, '');
  if (!provided) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const hex = toHex(sig);
    const b64 = toBase64(sig);
    return timingSafeEqual(provided.toLowerCase(), hex) || timingSafeEqual(provided, b64);
  } catch {
    return false;
  }
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeActionItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const text = typeof item === 'string'
      ? item
      : firstString((item as any)?.text, (item as any)?.title, (item as any)?.highlightText);
    if (!text) continue;
    const clean = text.trim();
    if (clean.length < 3) continue;
    if (!out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out.slice(0, 25);
}

function normalizeParticipants(payload: Record<string, any>): MeetgeekParticipant[] {
  const raw = payload.participants || payload.attendees || payload.meeting?.participants || [];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MeetgeekParticipant[] = [];
  for (const p of raw) {
    const email = normalizeEmail(typeof p === 'string' ? p : p?.email);
    const name = typeof p === 'string' ? null : firstString(p?.name, p?.full_name, p?.display_name);
    const key = email || (name ? `name:${name.toLowerCase()}` : '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email, role: typeof p === 'string' ? null : firstString(p?.role) });
  }
  return out;
}

/** Normalizes a MeetGeek webhook payload into our canonical meeting shape. */
export function normalizeMeetgeekPayload(payload: Record<string, any>): NormalizedMeeting | null {
  const meeting = (payload?.meeting && typeof payload.meeting === 'object') ? payload.meeting : payload;
  const meetingExternalId = firstString(
    meeting?.meeting_id, meeting?.id, payload?.meeting_id, payload?.id,
  );
  if (!meetingExternalId) return null;

  const startedAt = toIso(firstString(meeting?.timestamp_start_utc, meeting?.start_time, meeting?.started_at));
  const endedAt = toIso(firstString(meeting?.timestamp_end_utc, meeting?.end_time, meeting?.ended_at));
  let durationMinutes: number | null = null;
  if (startedAt && endedAt) {
    durationMinutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  } else if (typeof meeting?.duration === 'number') {
    durationMinutes = Math.round(meeting.duration);
  }

  const status = firstString(payload?.status, meeting?.status, payload?.event, payload?.event_type);
  const isCompleted = !!endedAt || /complete|analyz|finish|end/i.test(status || '');

  const summaryRaw = firstString(
    payload?.summary, meeting?.summary, payload?.summary_text, meeting?.summary_text,
  );

  return {
    meetingExternalId,
    eventId: firstString(payload?.event_id, payload?.id, meeting?.event_id),
    title: firstString(meeting?.title, meeting?.name, payload?.title),
    status,
    isCompleted,
    startedAt,
    endedAt,
    durationMinutes,
    language: firstString(meeting?.language),
    hostEmail: normalizeEmail(firstString(meeting?.host_email, meeting?.host?.email, payload?.host_email)),
    participants: normalizeParticipants(payload),
    summary: summaryRaw ? summaryRaw.slice(0, 8000) : null,
    actionItems: normalizeActionItems(payload?.action_items ?? meeting?.action_items ?? payload?.tasks),
    transcriptUrl: firstString(payload?.transcript_url, meeting?.transcript_url),
    recordingUrl: firstString(payload?.recording_url, meeting?.recording_url, meeting?.video_url),
    sourceUrl: firstString(payload?.meetgeek_url, meeting?.meetgeek_url)
      || `https://app.meetgeek.ai/meetings/${meetingExternalId}`,
  };
}

/** Stable idempotency key: prefer provider event id, otherwise meeting id + status. */
export function computeDedupeKey(meeting: NormalizedMeeting): string {
  if (meeting.eventId) return `event:${meeting.eventId}`;
  return `meeting:${meeting.meetingExternalId}:${(meeting.status || 'completed').toLowerCase()}`;
}

/** Matches attendees to existing client leads by normalized email. */
export function matchLeadByEmail(participants: MeetgeekParticipant[], leads: LeadRow[]): LeadMatch {
  const emails = participants.map((p) => normalizeEmail(p.email)).filter((e): e is string => !!e);
  for (const email of emails) {
    const hit = leads.find((l) => normalizeEmail(l.email) === email);
    if (hit) return { lead: hit, matchedEmail: email, matchMethod: 'email_exact', confidence: 1 };
  }
  return { lead: null, matchedEmail: emails[0] || null, matchMethod: 'none', confidence: 0 };
}

export function buildMeetingNote(meeting: NormalizedMeeting): string {
  const lines: string[] = ['Meeting Intelligence (MeetGeek)'];
  if (meeting.title) lines.push(`Title: ${meeting.title}`);
  if (meeting.startedAt) lines.push(`When: ${meeting.startedAt}`);
  if (meeting.durationMinutes != null) lines.push(`Duration: ${meeting.durationMinutes} min`);
  const attendees = meeting.participants.map((p) => p.email || p.name).filter(Boolean);
  if (attendees.length) lines.push(`Attendees: ${attendees.join(', ')}`);
  if (meeting.summary) lines.push('', 'Summary:', meeting.summary.slice(0, 1500));
  if (meeting.actionItems.length) {
    lines.push('', 'Action items:');
    meeting.actionItems.slice(0, 10).forEach((a) => lines.push(`- ${a}`));
  }
  if (meeting.recordingUrl) lines.push('', `Recording: ${meeting.recordingUrl}`);
  if (meeting.transcriptUrl) lines.push(`Transcript: ${meeting.transcriptUrl}`);
  else if (meeting.sourceUrl) lines.push(`Transcript: ${meeting.sourceUrl}`);
  return lines.join('\n').slice(0, 8000);
}

/**
 * Full webhook ingestion: signature -> parse -> idempotency -> normalize ->
 * persist -> lead match -> CRM note. All IO is injected via `deps`.
 */
export async function ingestMeetgeekWebhook(args: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
  deps: IngestDeps;
}): Promise<IngestResult> {
  const { rawBody, signatureHeader, secret, deps } = args;

  if (!secret) {
    return { ok: false, status: 500, reason: 'webhook_secret_not_configured' };
  }
  // Verify the raw body BEFORE parsing anything.
  const valid = await verifyMeetgeekSignature(rawBody, signatureHeader, secret);
  if (!valid) {
    return { ok: false, status: 401, reason: signatureHeader ? 'invalid_signature' : 'missing_signature' };
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, reason: 'invalid_json' };
  }

  const meeting = normalizeMeetgeekPayload(payload);
  if (!meeting) {
    return { ok: false, status: 400, reason: 'missing_meeting_id' };
  }

  const dedupeKey = computeDedupeKey(meeting);
  const existing = await deps.findProcessedEvent(dedupeKey);
  if (existing) {
    return { ok: true, status: 200, duplicate: true, reason: 'duplicate_event' };
  }

  const event = await deps.recordEvent({
    dedupeKey,
    eventId: meeting.eventId,
    meetingExternalId: meeting.meetingExternalId,
    clientId: null,
    signatureValid: true,
    status: 'processing',
    payload,
  });

  try {
    if (!meeting.isCompleted) {
      await deps.updateEvent(event.id, { status: 'ignored', errorMessage: 'meeting_not_completed' });
      return { ok: true, status: 202, reason: 'meeting_not_completed' };
    }

    // Per-client calendar gate (production path). Rejects unconfigured,
    // wrong-calendar, cross-client and ambiguous bookings before any CRM write.
    let gatedClientId: string | null | undefined;
    let activityId: string | undefined;
    let gateOwnsCrm = false;
    if (deps.calendarGate) {
      const gate = await deps.calendarGate(meeting);
      activityId = gate.activityId;
      if (!gate.ok && !gate.bypass) {
        await deps.updateEvent(event.id, {
          status: 'rejected',
          errorMessage: gate.rejected || 'calendar_gate_rejected',
          clientId: gate.clientId ?? null,
        });
        return {
          ok: false,
          status: gate.status || 403,
          reason: gate.rejected || 'calendar_gate_rejected',
          activityId,
          clientId: gate.clientId ?? null,
        };
      }
      if (gate.duplicate) {
        await deps.updateEvent(event.id, { status: 'processed', clientId: gate.clientId ?? null });
        return {
          ok: true,
          status: 200,
          duplicate: true,
          reason: 'duplicate_event',
          activityId,
          clientId: gate.clientId ?? null,
          matched: gate.matched,
          ghlNoteStatus: gate.crmSyncStatus,
        };
      }
      if (!gate.bypass) {
        gatedClientId = gate.clientId ?? null;
        gateOwnsCrm = true;
      }
    }

    const clientId = gatedClientId !== undefined
      ? gatedClientId
      : await deps.resolveClientId(meeting);
    const record = await deps.upsertMeetingRecord(meeting, clientId);

    const emails = meeting.participants
      .map((p) => normalizeEmail(p.email))
      .filter((e): e is string => !!e);
    const leads = emails.length ? await deps.findLeadsByEmails(clientId, emails) : [];
    const match = matchLeadByEmail(meeting.participants, leads);

    let ghlNoteStatus = 'skipped';
    let ghlNoteError: string | null = null;
    let ghlContactId: string | null = null;

    // When the calendar gate is active it already performed the single, mapped
    // CRM write-back — never write the note twice.
    if (match.lead && clientId && !gateOwnsCrm) {
      const res = await deps.writeGhlNote({ clientId, lead: match.lead, note: buildMeetingNote(meeting) });
      ghlNoteStatus = res.status;
      ghlContactId = res.contactId;
      ghlNoteError = res.error || null;
    } else if (match.lead && clientId) {
      ghlContactId = match.lead.external_id || null;
      ghlNoteStatus = 'delegated_to_calendar_gate';
    }

    await deps.upsertLeadContext({
      meetingRecordId: record.id,
      leadId: match.lead?.id || null,
      clientId,
      matchedEmail: match.matchedEmail,
      matchMethod: match.matchMethod,
      matchConfidence: match.confidence,
      ghlContactId,
      ghlNoteStatus,
      ghlNoteError,
    });

    await deps.updateEvent(event.id, { status: 'processed', clientId, errorMessage: null });

    return {
      ok: true,
      status: 200,
      meetingRecordId: record.id,
      matched: !!match.lead,
      matchConfidence: match.confidence,
      ghlNoteStatus,
      activityId,
      clientId,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown_error';
    await deps.updateEvent(event.id, { status: 'failed', errorMessage: message });
    return { ok: false, status: 500, reason: message };
  }
}