/**
 * Linq group conversation -> HPA GHL internal comment bridge (pure helpers).
 *
 * Scope is deliberately hard-coded and narrow:
 *  - ONLY GHL location ZcPPQTHBxBWlnM1WyjvU (HPA) may ever be written to.
 *  - ONLY Linq organization 22365 and the two owned lines below are in scope.
 *  - ONLY group chats are processed; 1:1 chats are skipped, always.
 *  - The bridge only ever appends `InternalComment` notes. It never sends SMS
 *    or email, and never creates a contact.
 *
 * Nothing here logs message text, participant PII or credentials.
 *
 * Verified references (2026-09-05):
 *  - Linq webhooks (Standard Webhooks): https://docs.linqapp.com/channel/imessage/guides/webhooks/
 *  - Linq chat fetch:    GET https://api.linqapp.com/api/partner/v3/chats/{chatId}
 *    (ChatHandle carries handle in E.164, joined_at, left_at, status, is_me)
 *  - Linq message fetch: GET https://api.linqapp.com/api/partner/v3/messages/{messageId}
 *    (id, chat_id, created_at, is_from_me, from_handle, parts[])
 *  - GHL advanced contact search: POST /contacts/search with
 *    { locationId, page, pageLimit, filters:[{field,operator,value}], searchAfter }
 *  - GHL send message: https://marketplace.gohighlevel.com/docs/2021-04-15/ghl/conversations/send-a-new-message/
 */

export const HPA_GHL_LOCATION_ID = 'ZcPPQTHBxBWlnM1WyjvU';
export const LINQ_ORG_ID = '22365';
export const OWNED_LINES = ['+14154980385', '+14156040157'];

export const LINQ_API_BASE = 'https://api.linqapp.com/api/partner/v3';
export const LINQ_WEBHOOK_VERSION = '2026-02-03';
export const LINQ_TOKEN_ENV = 'LINQ_API_TOKEN';
export const LINQ_WEBHOOK_SECRET_ENV = 'LINQ_WEBHOOK_SECRET';

export const LINQ_API_TOKEN_HEADER_NOTE =
  'Linq REST calls authenticate with Authorization: Bearer <LINQ_API_TOKEN>';

export const SUPPORTED_EVENTS = ['message.sent', 'message.received'] as const;

/** Replay window mandated by the Standard Webhooks spec Linq implements. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** How long a single delivery attempt may hold its claim before it goes stale. */
export const DELIVERY_LEASE_SECONDS = 120;
/** Longer lease for operator-driven reconciliation, which does more I/O per row. */
export const RECONCILE_LEASE_SECONDS = 300;

/** Bounded pagination for contact lookups — a phone must never scan a location. */
export const CONTACT_SEARCH_PAGE_LIMIT = 20;
export const CONTACT_SEARCH_MAX_PAGES = 5;

export type SkipCode =
  | 'not_group'
  | 'unsupported_event'
  | 'unsupported_version'
  | 'malformed_payload'
  | 'no_matched_participants';

export type SignatureFailure =
  | 'secret_missing'
  | 'headers_missing'
  | 'timestamp_invalid'
  | 'timestamp_out_of_tolerance'
  | 'signature_mismatch';

/* ------------------------------------------------------------------ phones */

/** Digits-only tail, used exclusively for masked logging. */
export function last10(raw?: string | null): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Strict E.164 normalization. A bare 10-digit number is treated as US (+1);
 * everything else must already carry its country code. Comparison downstream is
 * always full-E.164 equality, so a US and a foreign number that happen to share
 * their last ten digits are never conflated.
 */
export function toE164(raw?: string | null): string | null {
  const value = String(raw ?? '').trim();
  if (!value || value.includes('@')) return null; // email handles are out of scope
  const hadPlus = value.startsWith('+');
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  if (!hadPlus) {
    if (digits.length === 10) return `+1${digits}`; // US default, plain 10 digits only
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
    return null;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Back-compatible alias: every handle is normalized to strict E.164. */
export const normalizeHandle = toE164;

export function isOwnedLine(handle?: string | null): boolean {
  const e164 = toE164(handle);
  if (!e164) return false;
  return OWNED_LINES.some((line) => toE164(line) === e164);
}

/* -------------------------------------------------- signature verification */

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Standard Webhooks verification exactly as Linq documents it:
 * signed content is `{webhook-id}.{webhook-timestamp}.{raw body}`, HMAC-SHA256
 * with the base64 key that follows the `whsec_` prefix, base64 digest compared
 * against each `v1,<sig>` entry of the space-separated `webhook-signature`.
 */
export async function verifyLinqSignature(input: {
  secret: string | null | undefined;
  webhookId: string | null | undefined;
  timestamp: string | null | undefined;
  signatureHeader: string | null | undefined;
  rawBody: string;
  nowMs?: number;
}): Promise<{ ok: true } | { ok: false; code: SignatureFailure }> {
  const secret = (input.secret ?? '').trim();
  if (!secret) return { ok: false, code: 'secret_missing' };
  const id = (input.webhookId ?? '').trim();
  const ts = (input.timestamp ?? '').trim();
  const header = (input.signatureHeader ?? '').trim();
  if (!id || !ts || !header) return { ok: false, code: 'headers_missing' };

  if (!/^\d+$/.test(ts)) return { ok: false, code: 'timestamp_invalid' };
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(ts)) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, code: 'timestamp_out_of_tolerance' };
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  } catch {
    return { ok: false, code: 'secret_missing' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = `${id}.${ts}.${input.rawBody}`;
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed)),
  );
  const expected = bytesToBase64(digest);

  const presented = header
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3));
  if (presented.length === 0) return { ok: false, code: 'headers_missing' };

  const matched = presented.some((candidate) => constantTimeEqual(candidate, expected));
  return matched ? { ok: true } : { ok: false, code: 'signature_mismatch' };
}

/* --------------------------------------------------------------- envelope */

export interface LinqAttachmentRef {
  type: string;
  reference: string | null;
}

export interface LinqChatHandle {
  handle?: string | null;
  is_me?: boolean;
  joined_at?: string | null;
  left_at?: string | null;
  status?: string | null;
}

export interface LinqGroupMessage {
  eventId: string;
  eventType: 'message.sent' | 'message.received';
  webhookVersion: string;
  chatId: string;
  messageId: string;
  direction: 'inbound' | 'outbound';
  senderHandle: string | null;
  senderIsMe: boolean;
  sentAt: string;
  text: string;
  attachments: LinqAttachmentRef[];
  participantHandles: string[];
  handles: LinqChatHandle[];
}

function partsOf(payload: any): { text: string; attachments: LinqAttachmentRef[] } {
  const parts = Array.isArray(payload?.parts) ? payload.parts : [];
  const textPieces: string[] = [];
  const attachments: LinqAttachmentRef[] = [];
  for (const part of parts) {
    const type = String(part?.type ?? '').toLowerCase();
    if (type === 'text') {
      if (part?.value) textPieces.push(String(part.value));
    } else {
      attachments.push({
        type: type || 'attachment',
        reference: part?.url ?? part?.value ?? part?.filename ?? part?.id ?? null,
      });
    }
  }
  return { text: textPieces.join('\n').trim(), attachments };
}

/**
 * Parse a v2026-02-03 `message.sent` / `message.received` envelope.
 * Strictly rejects unsupported versions/events and every non-group chat.
 */
export function parseLinqEvent(
  envelope: any,
): { ok: true; event: LinqGroupMessage } | { ok: false; code: SkipCode } {
  if (!envelope || typeof envelope !== 'object') return { ok: false, code: 'malformed_payload' };

  const eventType = String(envelope.event_type ?? '');
  if (!SUPPORTED_EVENTS.includes(eventType as any)) return { ok: false, code: 'unsupported_event' };

  const version = String(envelope.webhook_version ?? '');
  if (version !== LINQ_WEBHOOK_VERSION) return { ok: false, code: 'unsupported_version' };

  const data = envelope.data;
  const chat = data?.chat;
  const eventId = String(envelope.event_id ?? '').trim();
  const chatId = String(chat?.id ?? data?.chat_id ?? '').trim();
  const messageId = String(data?.id ?? '').trim();
  if (!eventId || !chatId || !messageId) return { ok: false, code: 'malformed_payload' };

  // Hard 1:1 exclusion — anything that is not explicitly a group is skipped.
  if (chat?.is_group !== true) return { ok: false, code: 'not_group' };

  const direction = String(data?.direction ?? '') === 'outbound' || data?.is_from_me === true
    ? 'outbound'
    : 'inbound';
  const { text, attachments } = partsOf(data);

  const handles: LinqChatHandle[] = Array.isArray(chat?.handles) ? chat.handles : [];
  const participantHandles = handles
    .map((h) => toE164(h?.handle))
    .filter((h): h is string => !!h);

  const senderRaw = data?.sender_handle ?? data?.from_handle;

  return {
    ok: true,
    event: {
      eventId,
      eventType: eventType as LinqGroupMessage['eventType'],
      webhookVersion: version,
      chatId,
      messageId,
      direction,
      senderHandle: toE164(senderRaw?.handle),
      senderIsMe: senderRaw?.is_me === true || data?.is_from_me === true,
      sentAt: String(data?.sent_at ?? data?.created_at ?? envelope.created_at ?? ''),
      text,
      attachments,
      participantHandles,
      handles,
    },
  };
}

/**
 * Rebuild the same LinqGroupMessage shape from the authenticated REST resources
 * (`GET /messages/{id}` + `GET /chats/{id}`) so a reconciled note carries the
 * full original text, sender, participants and timestamp — never a stub.
 */
export function buildEventFromResources(input: {
  message: any;
  chat: any;
  eventId: string;
  eventType?: string;
}): { ok: true; event: LinqGroupMessage } | { ok: false; code: SkipCode } {
  const message = input.message;
  const chat = input.chat;
  const messageId = String(message?.id ?? '').trim();
  const chatId = String(chat?.id ?? message?.chat_id ?? '').trim();
  if (!messageId || !chatId) return { ok: false, code: 'malformed_payload' };
  if (chat?.is_group !== true) return { ok: false, code: 'not_group' };

  const { text, attachments } = partsOf(message);
  const handles: LinqChatHandle[] = Array.isArray(chat?.handles) ? chat.handles : [];
  const isFromMe = message?.is_from_me === true || message?.from_handle?.is_me === true;

  return {
    ok: true,
    event: {
      eventId: input.eventId,
      eventType: (input.eventType === 'message.sent' || isFromMe
        ? 'message.sent'
        : 'message.received') as LinqGroupMessage['eventType'],
      webhookVersion: LINQ_WEBHOOK_VERSION,
      chatId,
      messageId,
      direction: isFromMe ? 'outbound' : 'inbound',
      senderHandle: toE164(message?.from_handle?.handle ?? message?.from),
      senderIsMe: isFromMe,
      sentAt: String(message?.sent_at ?? message?.created_at ?? ''),
      text,
      attachments,
      participantHandles: handles.map((h) => toE164(h?.handle)).filter((h): h is string => !!h),
      handles,
    },
  };
}

/* -------------------------------------------------------------- membership */

/**
 * Was this handle a member of the chat at the moment the message was sent?
 * Fails closed: a participant that cannot be proven to have been present is
 * excluded, so someone who joined later never sees an earlier message.
 */
export function participantWasMemberAt(entry: LinqChatHandle, atIso: string): boolean {
  const at = Date.parse(String(atIso ?? ''));
  const joined = Date.parse(String(entry?.joined_at ?? ''));
  const left = Date.parse(String(entry?.left_at ?? ''));
  const status = String(entry?.status ?? '').toLowerCase();
  const departed = status === 'left' || status === 'removed';

  if (!Number.isFinite(at)) {
    // Unknown message time: only a currently-active member with no departure.
    return !departed && !Number.isFinite(left);
  }
  if (Number.isFinite(joined) && joined > at) return false;
  if (Number.isFinite(left) && left <= at) return false;
  if (departed && !Number.isFinite(left)) return false; // departure time unknown
  return true;
}

/**
 * Participants to write to: everyone except our own lines and `is_me`, limited
 * to handles that were members of the chat at `atIso`.
 */
export function selectExternalParticipants(
  handles: LinqChatHandle[],
  atIso = '',
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of handles ?? []) {
    if (entry?.is_me === true) continue;
    const normalized = toE164(entry?.handle);
    if (!normalized || isOwnedLine(normalized)) continue;
    if (!participantWasMemberAt(entry, atIso)) continue;
    if (seen.has(normalized)) continue; // exact E.164 de-duplication
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/* -------------------------------------------------------- comment building */

export function maskHandle(handle?: string | null): string {
  const tail = last10(handle);
  return tail ? `•••${tail.slice(-4)}` : 'unknown';
}

/**
 * Stable, greppable marker embedded in every note. It lets a retry read the
 * contact's thread and discover a comment that was posted just before a
 * database write failed, instead of duplicating it.
 */
export function commentMarker(messageId: string, contactId: string): string {
  return `[linq-bridge:${messageId}:${contactId}]`;
}

export function buildInternalComment(input: {
  event: LinqGroupMessage;
  groupName: string | null;
  participants: string[];
  contactId: string;
  reconciled?: boolean;
}): string {
  const { event } = input;
  const lines: string[] = [];
  lines.push(
    `[Linq group text — logged automatically${input.reconciled ? ', reconciled' : ''}]`,
  );
  lines.push(`Group: ${input.groupName || 'Unnamed group'} (chat ${event.chatId})`);
  lines.push(`Direction: ${event.direction === 'outbound' ? 'Outbound (from us)' : 'Inbound'}`);
  lines.push(`Sender: ${event.senderIsMe ? 'HPA line' : ''} ${event.senderHandle || 'unknown'}`.trim());
  lines.push(`Sent at: ${event.sentAt || 'unknown'}`);
  lines.push(`Participants: ${input.participants.join(', ') || 'unknown'}`);
  lines.push('');
  lines.push(event.text || '(no text)');
  if (event.attachments.length) {
    lines.push('');
    lines.push('Attachments:');
    for (const att of event.attachments) {
      lines.push(`- ${att.type}: ${att.reference || 'reference unavailable'}`);
    }
  }
  lines.push('');
  lines.push(`Linq message ${event.messageId}`);
  lines.push(commentMarker(event.messageId, input.contactId));
  return lines.join('\n');
}

/** Durable idempotency scope: one internal comment per message per contact. */
export function deliveryKey(messageId: string, contactId: string): string {
  return `${messageId}::${contactId}`;
}

/* ------------------------------------------------------- GHL contact search */

/**
 * Documented advanced-search body: phone is matched through the `filters`
 * array (top-level `phone` is not part of the documented contract) and results
 * are paginated with `page`/`pageLimit`, optionally continued with `searchAfter`.
 */
export function buildContactSearchBody(input: {
  handle: string;
  locationId: string;
  page?: number;
  pageLimit?: number;
  searchAfter?: unknown[] | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    locationId: input.locationId,
    page: input.page ?? 1,
    pageLimit: input.pageLimit ?? CONTACT_SEARCH_PAGE_LIMIT,
    filters: [{ field: 'phone', operator: 'eq', value: input.handle }],
  };
  if (input.searchAfter && input.searchAfter.length) body.searchAfter = input.searchAfter;
  return body;
}

/** Documented free-text fallback (`query` searches name, email and phone). */
export function buildContactQueryBody(input: {
  handle: string;
  locationId: string;
  page?: number;
  pageLimit?: number;
}): Record<string, unknown> {
  return {
    locationId: input.locationId,
    page: input.page ?? 1,
    pageLimit: input.pageLimit ?? CONTACT_SEARCH_PAGE_LIMIT,
    query: input.handle,
  };
}

export function contactPhoneMatches(contact: any, handle: string): boolean {
  const target = toE164(handle);
  if (!target) return false;
  const candidates = [contact?.phone, contact?.phoneNumber, ...(Array.isArray(contact?.additionalPhones) ? contact.additionalPhones : [])];
  return candidates.some((c: any) => toE164(typeof c === 'string' ? c : c?.phone) === target);
}

export type LocationStatus = 'match' | 'mismatch' | 'unknown';

/** A contact is only writable when its own locationId is the HPA location. */
export function contactLocationStatus(contact: any, locationId: string): LocationStatus {
  const raw = contact?.locationId ?? contact?.location_id ?? contact?.location?.id ?? null;
  if (raw === null || raw === undefined || String(raw).trim() === '') return 'unknown';
  return String(raw) === String(locationId) ? 'match' : 'mismatch';
}

export type ContactMatch =
  | { status: 'matched'; contactId: string }
  | { status: 'unmatched' | 'ambiguous' }
  | { status: 'location_unverified'; contactIds: string[] };

/**
 * Which contact match results are safe to write.
 * Exact E.164 phone equality plus a verified location; anything ambiguous,
 * foreign to the location, or of unknown location is not written blindly.
 */
export function classifyContactMatch(
  contacts: Array<Record<string, any>>,
  handle: string,
  locationId: string = HPA_GHL_LOCATION_ID,
): ContactMatch {
  if (!toE164(handle)) return { status: 'unmatched' };
  const confirmed = new Set<string>();
  const unknown = new Set<string>();
  for (const contact of contacts ?? []) {
    if (!contact?.id) continue;
    if (!contactPhoneMatches(contact, handle)) continue;
    const loc = contactLocationStatus(contact, locationId);
    if (loc === 'match') confirmed.add(String(contact.id));
    else if (loc === 'unknown') unknown.add(String(contact.id));
    // 'mismatch' contacts are dropped outright — never written to.
  }
  if (confirmed.size > 1) return { status: 'ambiguous' };
  if (confirmed.size === 1 && unknown.size === 0) {
    return { status: 'matched', contactId: [...confirmed][0] };
  }
  if (confirmed.size + unknown.size > 1) return { status: 'ambiguous' };
  if (unknown.size === 1) return { status: 'location_unverified', contactIds: [...unknown] };
  if (confirmed.size === 1) return { status: 'matched', contactId: [...confirmed][0] };
  return { status: 'unmatched' };
}

/** Does a thread message carry our marker? Used to reconcile uncertain writes. */
export function findMarkedMessageId(
  messages: Array<Record<string, any>>,
  marker: string,
): string | null {
  for (const m of messages ?? []) {
    const body = String(m?.body ?? m?.message ?? m?.messageBody ?? '');
    if (body.includes(marker)) return m?.id ? String(m.id) : 'unknown';
  }
  return null;
}
