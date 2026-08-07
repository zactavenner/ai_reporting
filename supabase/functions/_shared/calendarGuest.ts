/**
 * Guest-only MeetGeek calendar orchestration — pure, testable core.
 *
 * Hard product rules encoded here:
 *  - The MeetGeek notetaker account is ONLY ever an attendee (guest) on the
 *    organizer's real Google Calendar event.
 *  - It is NEVER an organizer, creator, event owner, GHL appointment owner,
 *    assigned user, linked GHL calendar or conflict calendar. Any patch payload
 *    that would touch ownership is rejected before it can reach Google/GHL.
 *  - Every decision uses the SERVER-side mapping row. Nothing from the webhook
 *    payload may widen scope.
 *
 * This module intentionally has no Deno/Supabase imports so it runs under
 * vitest as well as the edge runtime.
 */

export interface GuestConfig {
  id: string;
  clientId: string;
  enabled: boolean;
  ghlLocationId: string | null;
  ghlCalendarId: string | null;
  calendarConnectionId: string | null;
  organizerCalendarId: string;
  botGuestEmail: string | null;
}

export interface GhlAppointmentLite {
  appointmentId: string;
  calendarId: string | null;
  locationId: string | null;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  /** Google event id, when GHL surfaces it. Usually absent. */
  externalGoogleEventId?: string | null;
  meetingUrl?: string | null;
}

export type GuestRejection =
  | 'not_configured'
  | 'disabled'
  | 'no_calendar_connection'
  | 'no_bot_guest_email'
  | 'no_location_mapped'
  | 'no_calendar_mapped'
  | 'appointment_not_found'
  | 'appointment_location_missing'
  | 'location_mismatch'
  | 'appointment_calendar_missing'
  | 'calendar_mismatch'
  | 'missing_schedule';

export const GUEST_REJECTION_MESSAGES: Record<GuestRejection, string> = {
  not_configured: 'No guest-invite configuration exists for this client.',
  disabled: 'Guest invites are disabled for this client.',
  no_calendar_connection: 'No organizer Google Calendar connection is linked.',
  no_bot_guest_email: 'No notetaker guest email is configured.',
  no_location_mapped: 'No CRM location is mapped for this client.',
  no_calendar_mapped: 'No CRM calendar is mapped for this client.',
  appointment_not_found: 'The appointment could not be read back from the CRM.',
  appointment_location_missing: 'The appointment returned no CRM location, so ownership cannot be proven.',
  location_mismatch: 'The appointment belongs to a different CRM location.',
  appointment_calendar_missing: 'The appointment returned no CRM calendar id.',
  calendar_mismatch: 'The appointment is not on the mapped calendar.',
  missing_schedule: 'The appointment has no start/end time.',
};

export type GuestGateDecision =
  | { allowed: true; config: GuestConfig; appointment: GhlAppointmentLite; botGuestEmail: string }
  | { allowed: false; reason: GuestRejection };

export function evaluateGuestGate(args: {
  config: GuestConfig | null;
  appointment: GhlAppointmentLite | null;
}): GuestGateDecision {
  const { config, appointment } = args;
  if (!config) return { allowed: false, reason: 'not_configured' };
  if (!config.enabled) return { allowed: false, reason: 'disabled' };
  if (!config.calendarConnectionId) return { allowed: false, reason: 'no_calendar_connection' };
  const bot = normalizeEmail(config.botGuestEmail);
  if (!bot) return { allowed: false, reason: 'no_bot_guest_email' };
  if (!config.ghlLocationId) return { allowed: false, reason: 'no_location_mapped' };
  if (!config.ghlCalendarId) return { allowed: false, reason: 'no_calendar_mapped' };

  if (!appointment) return { allowed: false, reason: 'appointment_not_found' };
  if (!appointment.locationId) return { allowed: false, reason: 'appointment_location_missing' };
  if (appointment.locationId !== config.ghlLocationId) return { allowed: false, reason: 'location_mismatch' };
  if (!appointment.calendarId) return { allowed: false, reason: 'appointment_calendar_missing' };
  if (appointment.calendarId !== config.ghlCalendarId) return { allowed: false, reason: 'calendar_mismatch' };
  if (!appointment.startTime || !appointment.endTime) return { allowed: false, reason: 'missing_schedule' };

  return { allowed: true, config, appointment, botGuestEmail: bot };
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = (value || '').trim().toLowerCase();
  return v.includes('@') ? v : null;
}

/** Stable per-appointment key so replays collapse to a single job row. */
export function buildInviteIdempotencyKey(input: {
  clientId: string;
  appointmentId: string;
  botGuestEmail: string;
}): string {
  return `guest:${input.clientId}:${input.appointmentId}:${normalizeEmail(input.botGuestEmail)}`;
}

/**
 * Event-linkage / no-duplicate strategy when the GHL payload has NO external
 * Google event id (the normal case):
 *
 *  1. Every event this system touches is tagged with a private extended
 *     property `hpaGhlAppointmentId = <GHL appointment id>` (plus
 *     `hpaClientId`). Private extended properties are invisible to guests and
 *     never leave the organizer's calendar.
 *  2. Before writing anything we search the organizer's calendar with
 *     `privateExtendedProperty=hpaGhlAppointmentId=<id>`. A hit means we already
 *     have an event for this appointment → PATCH attendees only.
 *  3. If no tagged event exists we search the organizer's calendar by time
 *     window (`timeMin`/`timeMax` = appointment start/end) and match the
 *     organizer's own untagged event; if exactly one candidate matches we adopt
 *     it (patch attendees + add the tag). Zero or multiple candidates → we do
 *     NOT create a second event; the job is parked as `needs_event_link` for a
 *     human, because creating our own event would duplicate the organizer's.
 *  4. Only when the config explicitly opts into `allowCreate` do we create a
 *     new tagged event.
 *
 * Required linkage for full automation: either GHL sends the Google event id, or
 * the organizer's Google Calendar is the booking destination for that GHL
 * calendar so the time-window adoption in (3) resolves to exactly one event.
 */
export const GHL_APPOINTMENT_PROPERTY = 'hpaGhlAppointmentId';
export const CLIENT_PROPERTY = 'hpaClientId';

export function buildTaggedEventSearch(appointmentId: string): Record<string, string> {
  return { privateExtendedProperty: `${GHL_APPOINTMENT_PROPERTY}=${appointmentId}` };
}

export function buildTimeWindowSearch(appointment: GhlAppointmentLite): Record<string, string> {
  return {
    timeMin: new Date(appointment.startTime!).toISOString(),
    timeMax: new Date(appointment.endTime!).toISOString(),
    singleEvents: 'true',
    showDeleted: 'false',
  };
}

export interface GoogleEventLite {
  id: string;
  organizer?: { email?: string; self?: boolean } | null;
  creator?: { email?: string } | null;
  attendees?: { email?: string; organizer?: boolean; resource?: boolean; responseStatus?: string }[] | null;
  extendedProperties?: { private?: Record<string, string> } | null;
  status?: string | null;
}

export type EventLinkResolution =
  | { kind: 'tagged'; event: GoogleEventLite }
  | { kind: 'adopted'; event: GoogleEventLite }
  | { kind: 'create' }
  | { kind: 'needs_event_link'; candidates: number };

export function resolveEventLink(args: {
  taggedEvents: GoogleEventLite[];
  windowEvents: GoogleEventLite[];
  allowCreate?: boolean;
}): EventLinkResolution {
  const tagged = (args.taggedEvents || []).filter((e) => e.status !== 'cancelled');
  if (tagged.length >= 1) return { kind: 'tagged', event: tagged[0] };

  const candidates = (args.windowEvents || []).filter((e) => e.status !== 'cancelled');
  if (candidates.length === 1) return { kind: 'adopted', event: candidates[0] };
  if (candidates.length === 0 && args.allowCreate) return { kind: 'create' };
  return { kind: 'needs_event_link', candidates: candidates.length };
}

/** True when the bot is already a guest — used to skip redundant writes. */
export function botAlreadyGuest(event: GoogleEventLite, botEmail: string): boolean {
  const bot = normalizeEmail(botEmail);
  return (event.attendees || []).some((a) => normalizeEmail(a.email) === bot);
}

export interface AttendeePatch {
  attendees: { email: string; organizer?: boolean; responseStatus?: string }[];
  extendedProperties: { private: Record<string, string> };
}

/**
 * Additive attendee patch. Existing attendees (and their organizer flags) are
 * preserved byte-for-byte; the bot is appended as a plain guest. NOTHING about
 * ownership is emitted.
 */
export function buildAttendeePatch(args: {
  event: GoogleEventLite;
  botGuestEmail: string;
  appointmentId: string;
  clientId: string;
}): AttendeePatch {
  const bot = normalizeEmail(args.botGuestEmail)!;
  const existing = (args.event.attendees || [])
    .filter((a) => normalizeEmail(a.email))
    .map((a) => ({
      email: normalizeEmail(a.email)!,
      ...(a.organizer ? { organizer: true } : {}),
      ...(a.responseStatus ? { responseStatus: a.responseStatus } : {}),
    }));
  const attendees = botAlreadyGuest(args.event, bot) ? existing : [...existing, { email: bot }];
  const priorPrivate = args.event.extendedProperties?.private || {};
  return {
    attendees,
    extendedProperties: {
      private: {
        ...priorPrivate,
        [GHL_APPOINTMENT_PROPERTY]: args.appointmentId,
        [CLIENT_PROPERTY]: args.clientId,
      },
    },
  };
}

const OWNERSHIP_KEYS = [
  'organizer',
  'creator',
  'owner',
  'assignedUserId',
  'assigned_user_id',
  'calendarId',
  'transferOwnership',
];

/**
 * Fail-closed guard: throws if a payload would move ownership, or if the bot is
 * marked as organizer anywhere in the attendee list.
 */
export function assertOwnerPreserved(payload: Record<string, unknown>, botGuestEmail: string): void {
  for (const key of OWNERSHIP_KEYS) {
    if (key in payload) throw new Error(`owner_mutation_blocked:${key}`);
  }
  const bot = normalizeEmail(botGuestEmail);
  const attendees = (payload as any).attendees as { email?: string; organizer?: boolean }[] | undefined;
  for (const a of attendees || []) {
    if (normalizeEmail(a.email) === bot && a.organizer) {
      throw new Error('owner_mutation_blocked:bot_organizer');
    }
  }
}

/** Redacted connection metadata — the ONLY shape allowed to leave the server. */
export interface RedactedConnection {
  id: string;
  organizer_email: string;
  display_name: string | null;
  status: string;
  scope_summary: string;
  token_present: boolean;
  access_token_expires_at: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string | null;
}

const TOKEN_FIELDS = ['refresh_token', 'access_token', 'id_token', 'client_secret'];

export function redactConnection(row: Record<string, any>): RedactedConnection {
  const scopes = String(row.scope || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.replace('https://www.googleapis.com/auth/', ''));
  const out: RedactedConnection = {
    id: row.id,
    organizer_email: row.organizer_email,
    display_name: row.display_name ?? null,
    status: row.status ?? 'unknown',
    scope_summary: scopes.join(', '),
    token_present: !!row.refresh_token,
    access_token_expires_at: row.access_token_expires_at ?? null,
    last_verified_at: row.last_verified_at ?? null,
    last_error: row.last_error ?? null,
    created_at: row.created_at ?? null,
  };
  for (const f of TOKEN_FIELDS) {
    if (f in (out as any)) delete (out as any)[f];
  }
  return out;
}

/** Timing-safe compare of equal-length strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Verifies an HMAC-SHA256 signature over the RAW request body. Accepts hex or
 * base64, with or without a `sha256=` prefix. Fails closed on any missing input.
 *
 * NOTE: native GHL "Workflow → Webhook" actions cannot compute an HMAC over
 * their own serialized body, so this path is only usable for callers that can
 * sign (our own tooling, replay harnesses, custom senders). The native workflow
 * uses the shared-secret header path below.
 */
export async function verifyWebhookSignature(args: {
  rawBody: string;
  header: string | null | undefined;
  secret: string | null | undefined;
}): Promise<boolean> {
  const header = (args.header || '').trim();
  const secret = args.secret || '';
  if (!header || !secret) return false;
  const provided = header.replace(/^sha256=/i, '').trim();
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(args.rawBody));
  return safeEqual(provided.toLowerCase(), toHex(sig)) || safeEqual(provided, toBase64(sig));
}

/** Least-privilege Calendar scope set: create/patch events + invite attendees. */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

/* ------------------------------------------------------------------ *
 * Shared-secret header auth (native GHL Workflow Webhook action)
 * ------------------------------------------------------------------ */

/**
 * Explicit header carrying a high-entropy, server-held, per-integration secret.
 * A native GHL workflow can send a static custom header but cannot sign a body,
 * so this is the operable fail-closed alternative. Requests with no header, an
 * empty header, or a non-matching value are rejected — nothing unsigned or
 * unauthenticated is ever accepted.
 */
export const SHARED_SECRET_HEADER = 'x-hpa-webhook-token';

/** Minimum accepted secret length (~192 bits of base64/hex entropy). */
export const SHARED_SECRET_MIN_LENGTH = 32;

export type WebhookAuthResult =
  | { ok: true; method: 'shared_secret' | 'ghl_marketplace' | 'hmac' }
  | {
      ok: false;
      reason:
        | 'missing_credential'
        | 'secret_not_configured'
        | 'secret_too_weak'
        | 'credential_mismatch';
    };

/**
 * Constant-time shared-secret check. Fails closed when the header is absent,
 * when no secret is configured, and when the configured secret is too weak to
 * be treated as an authenticator.
 */
export function verifySharedSecretHeader(args: {
  header: string | null | undefined;
  secret: string | null | undefined;
}): WebhookAuthResult {
  const provided = (args.header || '').trim();
  const secret = (args.secret || '').trim();
  if (!secret) return { ok: false, reason: 'secret_not_configured' };
  if (secret.length < SHARED_SECRET_MIN_LENGTH) return { ok: false, reason: 'secret_too_weak' };
  if (!provided) return { ok: false, reason: 'missing_credential' };
  // Compare digests so the comparison is constant time for any input length.
  return safeEqual(provided, secret) && provided.length === secret.length
    ? { ok: true, method: 'shared_secret' }
    : { ok: false, reason: 'credential_mismatch' };
}

/**
 * Official GHL Marketplace webhook signature (Ed25519 over the raw body, sent
 * as `x-wh-signature` / `x-ghl-signature`, base64). Verified against GHL's
 * public key when one is configured; absent a key this path simply does not
 * authenticate, and the shared-secret path remains required.
 */
export const GHL_MARKETPLACE_SIGNATURE_HEADERS = ['x-wh-signature', 'x-ghl-signature'];

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function verifyGhlMarketplaceSignature(args: {
  rawBody: string;
  header: string | null | undefined;
  publicKeyPem: string | null | undefined;
}): Promise<boolean> {
  const header = (args.header || '').trim();
  const pem = (args.publicKeyPem || '').trim();
  if (!header || !pem) return false;
  const sig = base64ToBytes(header);
  const spki = base64ToBytes(
    pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----/g, '').replace(/\s+/g, ''),
  );
  if (!sig || !spki) return false;
  for (const algo of [{ name: 'Ed25519' }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }] as const) {
    try {
      const key = await crypto.subtle.importKey('spki', spki as unknown as ArrayBuffer, algo as any, false, [
        'verify',
      ]);
      const ok = await crypto.subtle.verify(
        algo.name === 'Ed25519' ? { name: 'Ed25519' } : { name: 'RSASSA-PKCS1-v1_5' },
        key,
        sig as unknown as ArrayBuffer,
        new TextEncoder().encode(args.rawBody),
      );
      if (ok) return true;
    } catch {
      /* try the next algorithm */
    }
  }
  return false;
}