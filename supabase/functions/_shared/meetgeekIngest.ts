// Shared, dependency-injected MeetGeek ingestion core.
// Pure logic lives here so it can be unit-tested outside the Deno runtime.

import {
  parseMeetgeekInsights,
  type MeetgeekMeetingInsights,
  type QaScorecard,
} from './meetgeekQuality.ts';

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
  /**
   * Provider KPI insights (`GET /v1/meetings/{id}/insights`). This is the ONLY
   * input allowed to drive the quality score. Null until the authenticated
   * provider fetch has run for a calendar-validated meeting.
   */
  insights?: MeetgeekMeetingInsights | null;
  /** Full transcript text fetched from the provider (never used for scoring). */
  transcriptText?: string | null;
  /**
   * True when the webhook told us analysis FAILED. Such payloads are recorded
   * as ignored and never reach the calendar gate or any CRM write.
   */
  analysisFailed?: boolean;
  /**
   * True when the webhook carried no authoritative timing (e.g. MeetGeek's
   * `{ message: "File analyzed successfully", meeting_id }` payload). The
   * provider must be fetched before the calendar gate can run.
   */
  hydrationRequired?: boolean;
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
   * Authenticated `GET /v1/meetings/{meeting_id}` hydration using the private
   * agency-level MeetGeek credentials. Runs AFTER signature verification and
   * BEFORE the calendar gate. Returning null fails closed for payloads that
   * carried no authoritative meeting data.
   */
  hydrateFromProvider?(meeting: NormalizedMeeting): Promise<HydrationAttempt>;
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
  }>;
  /**
   * Returns the existing ingest event for this dedupe key (any status), so the
   * caller can distinguish a terminal success (exactly-once) from a recoverable
   * failure that must be retried.
   */
  findProcessedEvent(dedupeKey: string): Promise<{ id: string; status: string } | null>;
  /** Re-opens a non-terminal event for another attempt (idempotent). */
  reopenEvent?(id: string, payload: unknown): Promise<void>;
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
  const raw = payload.participants || payload.attendees || payload.participant_emails
    || payload.attendee_emails || payload.meeting?.participants || [];
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

/**
 * Classifies MeetGeek's post-processing `message` field. The documented
 * successful-analysis payload can be nothing more than
 * `{ message: "File analyzed successfully", meeting_id: "..." }`.
 */
export function classifyMeetgeekMessage(message: unknown): 'analyzed' | 'failed' | null {
  if (typeof message !== 'string') return null;
  const text = message.trim().toLowerCase();
  if (!text) return null;
  if (/(fail|error|unsuccessful|could not|cannot|unable)/.test(text)) return 'failed';
  if (/analy[sz]\w*/.test(text) && /(success|complete|done|finish)/.test(text)) return 'analyzed';
  if (/^file analyzed successfully$/.test(text)) return 'analyzed';
  return null;
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

  const messageKind = classifyMeetgeekMessage(payload?.message ?? meeting?.message);
  const status = firstString(
    payload?.status, meeting?.status, payload?.event, payload?.event_type,
    messageKind === 'analyzed' ? 'analysis_completed' : messageKind === 'failed' ? 'analysis_failed' : null,
  );
  const analysisFailed = messageKind === 'failed';
  const isCompleted = !analysisFailed
    && (!!endedAt || messageKind === 'analyzed' || /complete|analyz|finish|end/i.test(status || ''));

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
    // Webhook payloads may or may not embed insights. When they don't, the
    // authenticated provider fetch fills this in after the calendar gate.
    insights: parseMeetgeekInsights(payload?.insights ?? payload?.kpis ?? null),
    transcriptText: null,
    analysisFailed,
    // Message-only / timing-free payloads carry no authority: the provider must
    // be fetched before the calendar gate can evaluate anything.
    hydrationRequired: !startedAt || !endedAt,
  };
}

/**
 * Merges an authenticated `GET /v1/meetings/{id}` response onto the canonical
 * meeting. The provider response is the ONLY authority for timing, title,
 * host, calendar event id, join link and participants — webhook-supplied
 * values for those fields are discarded.
 */
export function hydrateMeetingFromProvider(
  meeting: NormalizedMeeting,
  provider: Record<string, any> | null | undefined,
): NormalizedMeeting | null {
  if (!provider || typeof provider !== 'object') return null;
  const body = (provider.meeting && typeof provider.meeting === 'object') ? provider.meeting : provider;

  const startedAt = toIso(firstString(body?.timestamp_start_utc, body?.start_time, body?.started_at));
  const endedAt = toIso(firstString(body?.timestamp_end_utc, body?.end_time, body?.ended_at));
  if (!startedAt) return null;

  let durationMinutes: number | null = null;
  if (startedAt && endedAt) {
    durationMinutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  } else if (typeof body?.duration === 'number') {
    durationMinutes = Math.round(body.duration);
  }

  const participants = normalizeParticipants(body);
  const joinUrl = firstString(
    body?.join_link,
    body?.meeting_link,
    body?.conference_url,
    body?.meeting_url,
    body?.join_url,
    body?.source_url,
    body?.meetgeek_url,
  );

  return {
    ...meeting,
    // identity stays pinned to the verified webhook meeting id
    meetingExternalId: meeting.meetingExternalId,
    eventId: firstString(body?.event_id, body?.calendar_event_id, body?.external_event_id) ?? meeting.eventId,
    title: firstString(body?.title, body?.name),
    startedAt,
    endedAt,
    durationMinutes,
    language: firstString(body?.language),
    hostEmail: normalizeEmail(firstString(body?.host_email, body?.host?.email)),
    participants,
    sourceUrl: joinUrl || `https://app.meetgeek.ai/meetings/${meeting.meetingExternalId}`,
    recordingUrl: firstString(body?.recording_url, body?.video_url) ?? meeting.recordingUrl,
    transcriptUrl: firstString(body?.transcript_url) ?? meeting.transcriptUrl,
    transcriptText: extractTranscriptText(body?.transcript ?? body?.sentences ?? null) ?? meeting.transcriptText ?? null,
    isCompleted: true,
    hydrationRequired: false,
  };
}

/**
 * Ingest-event statuses that are FINAL. Anything else is recoverable and may be
 * retried by a later webhook delivery or an operator replay.
 */
export const TERMINAL_INGEST_STATUSES = new Set(['processed', 'ignored']);
export const RETRYABLE_INGEST_STATUSES = new Set(['received', 'processing', 'rejected', 'failed']);

export function isTerminalIngestStatus(status: string | null | undefined): boolean {
  return TERMINAL_INGEST_STATUSES.has(String(status || '').toLowerCase());
}

/**
 * Safe, PII-free and key-free diagnostic codes for a failed authoritative
 * `GET /v1/meetings/{id}` hydration. These are persisted on the ingest event and
 * returned to operators so a hydration outage is diagnosable without exposing
 * credentials, regions secrets or meeting content.
 */
export type HydrationDiagnosticCode =
  | 'missing_api_key'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'server_error'
  | 'http_error'
  | 'parse_error'
  | 'network_error'
  | 'empty_response'
  | 'incomplete_response';

export interface HydrationDiagnostic {
  code: HydrationDiagnosticCode;
  /** Short, non-sensitive hint (never a key, token, email or transcript). */
  detail?: string | null;
}

/** Result shape a hydration dependency may return. */
export type HydrationAttempt =
  | NormalizedMeeting
  | null
  | { meeting: NormalizedMeeting | null; diagnostic?: HydrationDiagnostic | null };

export function classifyHydrationFailure(input: {
  apiKeyPresent?: boolean;
  httpStatus?: number | null;
  errorKind?: 'network' | 'parse' | null;
}): HydrationDiagnostic {
  if (input.apiKeyPresent === false) {
    return { code: 'missing_api_key', detail: 'No agency MeetGeek API key is configured' };
  }
  if (input.errorKind === 'network') {
    return { code: 'network_error', detail: 'Provider request could not be completed' };
  }
  if (input.errorKind === 'parse') {
    return { code: 'parse_error', detail: 'Provider response was not valid JSON' };
  }
  const s = Number(input.httpStatus || 0);
  if (s === 401 || s === 403) {
    return { code: 'unauthorized', detail: `Provider rejected the credential (HTTP ${s}) — wrong key or region` };
  }
  if (s === 404) return { code: 'not_found', detail: 'Meeting not found for this workspace' };
  if (s === 429) return { code: 'rate_limited', detail: 'Provider rate limit hit (HTTP 429)' };
  if (s >= 500) return { code: 'server_error', detail: `Provider error (HTTP ${s})` };
  if (s >= 400) return { code: 'http_error', detail: `Provider error (HTTP ${s})` };
  return { code: 'empty_response', detail: 'Provider returned no meeting body' };
}

/** Normalizes any hydration dependency return value. */
export function normalizeHydrationAttempt(
  attempt: HydrationAttempt,
): { meeting: NormalizedMeeting | null; diagnostic: HydrationDiagnostic | null } {
  if (!attempt) return { meeting: null, diagnostic: null };
  if ('meeting' in (attempt as any) && !('meetingExternalId' in (attempt as any))) {
    const a = attempt as { meeting: NormalizedMeeting | null; diagnostic?: HydrationDiagnostic | null };
    return { meeting: a.meeting ?? null, diagnostic: a.diagnostic ?? null };
  }
  return { meeting: attempt as NormalizedMeeting, diagnostic: null };
}

/**
 * Extracts transcript text from any MeetGeek transcript shape:
 * a plain string, `sentences[].transcript` (current API), `sentences[].text`,
 * or `segments[].text`. Sentences may be paginated; callers concatenate pages.
 */
export function extractTranscriptText(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === 'string') return body.trim() || null;
  const b = body as Record<string, any>;
  if (typeof b.transcript === 'string' && b.transcript.trim()) return b.transcript.trim();
  const list = Array.isArray(b.sentences)
    ? b.sentences
    : Array.isArray(b.segments)
      ? b.segments
      : Array.isArray(b.data)
        ? b.data
        : null;
  if (!list) return null;
  const lines = list
    .map((s: any) => {
      if (typeof s === 'string') return s.trim();
      const text = firstString(s?.transcript, s?.text, s?.sentence, s?.content);
      if (!text) return '';
      const speaker = firstString(s?.speaker, s?.speaker_name, s?.participant_name);
      return speaker ? `${speaker}: ${text}` : text;
    })
    .filter((l: string) => !!l);
  return lines.length ? lines.join('\n') : null;
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

/** Hard upper bound for a CRM note body. */
export const GHL_NOTE_MAX_CHARS = 4000;

/**
 * Bounded CRM note. Priority when the budget is tight:
 *   1. header + links + action items + action-owner coverage  (never dropped)
 *   2. composite + two lowest quality categories               (kept)
 *   3. meeting summary                                         (trimmed first)
 *   4. quality summary prose                                   (trimmed last)
 */
export function buildMeetingNote(
  meeting: NormalizedMeeting,
  quality?: QaScorecard | null,
): string {
  const head: string[] = ['Meeting Intelligence (MeetGeek)'];
  if (meeting.title) head.push(`Title: ${meeting.title}`);
  if (meeting.startedAt) head.push(`When: ${meeting.startedAt}`);
  if (meeting.durationMinutes != null) head.push(`Duration: ${meeting.durationMinutes} min`);
  const attendees = meeting.participants.map((p) => p.email || p.name).filter(Boolean);
  if (attendees.length) head.push(`Attendees: ${attendees.slice(0, 15).join(', ')}`);

  const actions: string[] = [];
  if (meeting.actionItems.length) {
    actions.push('', 'Action items:');
    meeting.actionItems.slice(0, 10).forEach((a) => actions.push(`- ${a.slice(0, 200)}`));
  }

  const ownerCoverage: string[] = [];
  const total = meeting.insights?.actionItemsTotal;
  if (typeof total === 'number' && total > 0) {
    const owned = Math.min(Math.max(meeting.insights?.actionItemsWithOwner ?? 0, 0), total);
    ownerCoverage.push('', `Action owners: ${owned}/${total} action items have an owner.`);
  }

  const qualityHead: string[] = [];
  const qualityTail: string[] = [];
  if (quality) {
    qualityHead.push(
      '',
      `Operational QA: ${quality.total}/100 — ${quality.gateStatus.replace('_', ' ')}.`,
      'Sales-execution QA only. Not investor suitability, accreditation or compliance approval.',
    );
    const lowest = quality.categories
      .filter((c) => !c.na && c.points < c.max)
      .sort((a, b) => (a.points / a.max) - (b.points / b.max))
      .slice(0, 3)
      .map((c) => `${c.label} ${c.points}/${c.max}`);
    if (lowest.length) qualityHead.push(`Lowest categories: ${lowest.join(', ')}.`);
    const hard = quality.redFlags.filter((f) => f.hardFail).map((f) => f.code);
    if (hard.length) qualityHead.push(`Hard fail: ${hard.join(', ')}.`);
    const soft = quality.redFlags.filter((f) => !f.hardFail).map((f) => f.code);
    if (soft.length) qualityHead.push(`Review flags: ${soft.join(', ')}.`);
    if (quality.nextStep) {
      qualityHead.push(quality.nextStep.committed
        ? `Next step: ${String(quality.nextStep.detail || '').slice(0, 160)}`
        : 'Next step: none committed.');
    }
    if (quality.evidenceTags.length) qualityHead.push(`Evidence: ${quality.evidenceTags.join(', ')}.`);
    if (quality.narrative) qualityTail.push('', quality.narrative);
  }

  const links: string[] = [];
  if (meeting.recordingUrl) links.push('', `Recording: ${meeting.recordingUrl}`);
  if (meeting.transcriptUrl) links.push(`Transcript: ${meeting.transcriptUrl}`);
  else if (meeting.sourceUrl) links.push(`Transcript: ${meeting.sourceUrl}`);

  const fixed = [...head, ...qualityHead, ...actions, ...ownerCoverage, ...links];
  let budget = GHL_NOTE_MAX_CHARS - (fixed.join('\n').length + 1);

  // Trim the meeting summary first.
  const summaryBlock: string[] = [];
  if (meeting.summary && budget > 120) {
    const room = Math.min(1500, budget - 60);
    summaryBlock.push('', 'Summary:', truncate(meeting.summary, room));
    budget -= summaryBlock.join('\n').length;
  }

  // Quality prose is trimmed last, only with whatever budget remains.
  const tail: string[] = [];
  if (qualityTail.length && budget > 40) {
    tail.push('', truncate(qualityTail.join('\n').trim(), budget - 2));
  }

  const note = [...head, ...qualityHead, ...summaryBlock, ...actions, ...ownerCoverage, ...links, ...tail]
    .join('\n');
  return note.slice(0, GHL_NOTE_MAX_CHARS);
}

function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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

  let meeting = normalizeMeetgeekPayload(payload);
  if (!meeting) {
    return { ok: false, status: 400, reason: 'missing_meeting_id' };
  }

  const dedupeKey = computeDedupeKey(meeting);
  const existing = await deps.findProcessedEvent(dedupeKey);
  // Exactly-once for terminal outcomes; recoverable failures (a provider
  // hydration blip, a transient CRM error, an interrupted run) are retried so a
  // meeting is never permanently lost to a transient error.
  if (existing && isTerminalIngestStatus(existing.status)) {
    return { ok: true, status: 200, duplicate: true, reason: 'duplicate_event' };
  }

  let event: { id: string };
  if (existing) {
    if (deps.reopenEvent) await deps.reopenEvent(existing.id, payload);
    else await deps.updateEvent(existing.id, { status: 'processing', errorMessage: null });
    event = { id: existing.id };
  } else {
    event = await deps.recordEvent({
      dedupeKey,
      eventId: meeting.eventId,
      meetingExternalId: meeting.meetingExternalId,
      clientId: null,
      signatureValid: true,
      status: 'processing',
      payload,
    });
  }

  try {
    if (meeting.analysisFailed) {
      await deps.updateEvent(event.id, { status: 'ignored', errorMessage: 'analysis_failed' });
      return { ok: true, status: 202, reason: 'analysis_failed' };
    }
    if (!meeting.isCompleted) {
      await deps.updateEvent(event.id, { status: 'ignored', errorMessage: 'meeting_not_completed' });
      return { ok: true, status: 202, reason: 'meeting_not_completed' };
    }

    // Authoritative provider hydration BEFORE any client/calendar matching.
    // The webhook is never trusted for tenant, calendar, timing or title.
    if (deps.hydrateFromProvider) {
      const hydrated = await deps.hydrateFromProvider(meeting);
      if (hydrated) {
        meeting = hydrated;
      } else if (meeting.hydrationRequired) {
        // Fail closed: nothing authoritative to gate on.
        await deps.updateEvent(event.id, { status: 'rejected', errorMessage: 'provider_hydration_failed' });
        return { ok: false, status: 422, reason: 'provider_hydration_failed' };
      }
    } else if (meeting.hydrationRequired) {
      await deps.updateEvent(event.id, { status: 'rejected', errorMessage: 'provider_hydration_unavailable' });
      return { ok: false, status: 422, reason: 'provider_hydration_unavailable' };
    }

    // Per-client calendar gate (production path). Rejects unconfigured,
    // wrong-calendar, cross-client and ambiguous bookings before any CRM write.
    // The calendar gate is the ONLY tenant authority. If it is wired in, an
    // unconfigured / rejected meeting is never ingested (fail closed).
    let gatedClientId: string | null | undefined;
    let activityId: string | undefined;
    let gateOwnsCrm = false;
    if (deps.calendarGate) {
      const gate = await deps.calendarGate(meeting);
      activityId = gate.activityId;
      if (!gate.ok) {
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
      gatedClientId = gate.clientId ?? null;
      gateOwnsCrm = true;
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