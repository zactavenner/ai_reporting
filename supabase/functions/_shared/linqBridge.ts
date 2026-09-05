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
 *  - Linq chat fetch: GET https://api.linqapp.com/api/partner/v3/chats/{chatId}
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

export function last10(raw?: string | null): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normalizeHandle(raw?: string | null): string | null {
  const value = String(raw ?? '').trim();
  if (!value || value.includes('@')) return null; // email handles are out of scope
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
}

export function isOwnedLine(handle?: string | null): boolean {
  const tail = last10(handle);
  if (!tail) return false;
  return OWNED_LINES.some((line) => last10(line) === tail);
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
        reference: part?.url ?? part?.value ?? part?.id ?? null,
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
  const chatId = String(chat?.id ?? '').trim();
  const messageId = String(data?.id ?? '').trim();
  if (!eventId || !chatId || !messageId) return { ok: false, code: 'malformed_payload' };

  // Hard 1:1 exclusion — anything that is not explicitly a group is skipped.
  if (chat?.is_group !== true) return { ok: false, code: 'not_group' };

  const direction = String(data?.direction ?? '') === 'outbound' ? 'outbound' : 'inbound';
  const { text, attachments } = partsOf(data);

  const handles = Array.isArray(chat?.handles) ? chat.handles : [];
  const participantHandles = handles
    .map((h: any) => normalizeHandle(h?.handle))
    .filter((h: string | null): h is string => !!h);

  return {
    ok: true,
    event: {
      eventId,
      eventType: eventType as LinqGroupMessage['eventType'],
      webhookVersion: version,
      chatId,
      messageId,
      direction,
      senderHandle: normalizeHandle(data?.sender_handle?.handle),
      senderIsMe: data?.sender_handle?.is_me === true,
      sentAt: String(data?.sent_at ?? envelope.created_at ?? ''),
      text,
      attachments,
      participantHandles,
    },
  };
}

/** Participants to match in GHL: everyone except our own lines and `is_me`. */
export function selectExternalParticipants(
  handles: Array<{ handle?: string | null; is_me?: boolean; left_at?: string | null }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of handles ?? []) {
    if (entry?.is_me === true) continue;
    const normalized = normalizeHandle(entry?.handle);
    if (!normalized || isOwnedLine(normalized)) continue;
    const tail = last10(normalized)!;
    if (seen.has(tail)) continue;
    seen.add(tail);
    out.push(normalized);
  }
  return out;
}

/* -------------------------------------------------------- comment building */

export function maskHandle(handle?: string | null): string {
  const tail = last10(handle);
  return tail ? `•••${tail.slice(-4)}` : 'unknown';
}

export function buildInternalComment(input: {
  event: LinqGroupMessage;
  groupName: string | null;
  participants: string[];
}): string {
  const { event } = input;
  const lines: string[] = [];
  lines.push(`[Linq group text — logged automatically]`);
  lines.push(`Group: ${input.groupName || 'Unnamed group'} (chat ${event.chatId})`);
  lines.push(`Direction: ${event.direction === 'outbound' ? 'Outbound (from us)' : 'Inbound'}`);
  lines.push(`Sender: ${event.senderIsMe ? 'HPA line' : ''} ${event.senderHandle || 'unknown'}`.trim());
  lines.push(`Sent at: ${event.sentAt}`);
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
  return lines.join('\n');
}

/** Durable idempotency scope: one internal comment per message per contact. */
export function deliveryKey(messageId: string, contactId: string): string {
  return `${messageId}::${contactId}`;
}

/** Which contact match results are safe to write. */
export function classifyContactMatch(
  contacts: Array<{ id?: string | null; phone?: string | null }>,
  handle: string,
): { status: 'matched'; contactId: string } | { status: 'unmatched' | 'ambiguous' } {
  const tail = last10(handle);
  if (!tail) return { status: 'unmatched' };
  const ids = new Set<string>();
  for (const contact of contacts ?? []) {
    if (!contact?.id) continue;
    if (last10(contact.phone) === tail) ids.add(String(contact.id));
  }
  if (ids.size === 1) return { status: 'matched', contactId: [...ids][0] };
  if (ids.size > 1) return { status: 'ambiguous' };
  return { status: 'unmatched' };
}
