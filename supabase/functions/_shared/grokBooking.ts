/**
 * Pure, testable core for the Grok voice-agent booking bridge.
 *
 * Nothing here talks to the network or reads credentials. The edge function
 * supplies GHL responses and the environment token; this module only decides
 * whether a request is well-formed, authorized, and whether a requested start
 * time is genuinely still available.
 *
 * Hard rules encoded here:
 *  - The caller can never supply GHL credentials, client ids, location ids or
 *    calendar ids. The target is resolved from calendar_mappings server-side.
 *  - A booking is only allowed for an ISO start time that appears in the
 *    free-slots response fetched immediately before the write.
 */

export const GROK_BOOKING_TOKEN_ENV = 'GROK_BOOKING_TOKEN';

export type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

function fail<T>(code: string, error: string): Result<T> {
  return { ok: false, code, error };
}

/** Fail-closed constant-time token check. An unset secret authorizes nobody. */
export function authorizeGrokBooking(
  presented: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const a = (presented || '').trim();
  const b = (expected || '').trim();
  if (!a || !b || a.length < 16 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Bearer token or x-grok-booking-token header. */
export function presentedToken(headers: Headers): string | null {
  const auth = headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim() || null;
  return (headers.get('x-grok-booking-token') || '').trim() || null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** UTC offset in minutes that `tz` has at the given instant. */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/**
 * The ISO start time must carry an explicit offset that matches the supplied
 * timezone at that instant (a plain `Z` is accepted only for a zero-offset zone).
 */
export function offsetMatchesTimezone(iso: string, tz: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const m = /(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!m) return false;
  const declared = m[1] === 'Z' ? 0 : (m[1].startsWith('-') ? -1 : 1) *
    (Number(m[1].slice(1, 3)) * 60 + Number(m[1].slice(4, 6)));
  return declared === tzOffsetMinutes(d, tz);
}

export interface SlotsInput { startDate: string; endDate: string; timezone: string }

export function validateSlotsInput(payload: any): Result<SlotsInput> {
  const startDate = String(payload?.start_date ?? '');
  const endDate = String(payload?.end_date ?? startDate);
  const timezone = payload?.timezone;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return fail('invalid_date_range', 'start_date and end_date must be YYYY-MM-DD');
  }
  if (endDate < startDate) return fail('invalid_date_range', 'end_date is before start_date');
  const spanDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000;
  if (spanDays > 30) return fail('invalid_date_range', 'date range may not exceed 31 days');
  if (!isValidTimezone(timezone)) return fail('invalid_timezone', 'timezone must be a valid IANA zone');
  return { ok: true, value: { startDate, endDate, timezone } };
}

export interface BookingInput {
  name: string;
  phone: string;
  email: string;
  startTime: string;
  timezone: string;
}

export function validateBookingInput(payload: any): Result<BookingInput> {
  const name = String(payload?.name ?? '').trim();
  const phone = String(payload?.phone ?? '').trim();
  const email = String(payload?.email ?? '').trim().toLowerCase();
  const startTime = String(payload?.start_time ?? '').trim();
  const timezone = payload?.timezone;

  if (name.length < 2 || name.length > 120) return fail('invalid_name', 'name is required');
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return fail('invalid_phone', 'phone must be a valid number');
  if (!EMAIL_RE.test(email) || email.length > 254) return fail('invalid_email', 'email must be valid');
  if (!ISO_RE.test(startTime) || Number.isNaN(Date.parse(startTime))) {
    return fail('invalid_start_time', 'start_time must be an ISO 8601 time with offset');
  }
  if (!isValidTimezone(timezone)) return fail('invalid_timezone', 'timezone must be a valid IANA zone');
  if (!offsetMatchesTimezone(startTime, timezone as string)) {
    return fail('timezone_mismatch', 'start_time offset does not match timezone');
  }
  if (Date.parse(startTime) <= Date.now()) return fail('start_time_in_past', 'start_time must be in the future');

  return { ok: true, value: { name, phone, email, startTime, timezone: timezone as string } };
}

/** Normalise GHL's several free-slots response shapes into ISO strings. */
export function parseFreeSlots(body: any): string[] {
  const out: string[] = [];
  const push = (v: any) => {
    const s = typeof v === 'string' ? v : v?.slot ?? v?.startTime;
    if (typeof s === 'string' && !Number.isNaN(Date.parse(s))) out.push(s);
  };
  const walkDay = (day: any) => {
    if (Array.isArray(day)) day.forEach(push);
    else if (Array.isArray(day?.slots)) day.slots.forEach(push);
  };
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      if (DATE_RE.test(k)) walkDay(v);
    }
    if (Array.isArray((body as any).slots)) (body as any).slots.forEach(push);
    else if ((body as any).slots && typeof (body as any).slots === 'object') {
      for (const v of Object.values((body as any).slots)) walkDay(v);
    }
  }
  return Array.from(new Set(out));
}

/** Instant-equality match: offsets may differ, the moment may not. */
export function matchSlot(slots: string[], startTime: string): string | null {
  const want = Date.parse(startTime);
  if (Number.isNaN(want)) return null;
  for (const s of slots) if (Date.parse(s) === want) return s;
  return null;
}

export function slotIsAvailable(slots: string[], startTime: string): boolean {
  return matchSlot(slots, startTime) !== null;
}

export function endTimeFor(startTime: string, durationMinutes = 30): string {
  return new Date(Date.parse(startTime) + durationMinutes * 60000).toISOString();
}

/** Deterministic idempotency key — same calendar + instant + invitee = same booking. */
export async function bookingIdempotencyKey(
  calendarId: string,
  startTime: string,
  email: string,
): Promise<string> {
  const raw = `${calendarId}|${new Date(startTime).toISOString()}|${email.trim().toLowerCase()}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `grok-booking-${hex.slice(0, 32)}`;
}

/** Console-safe: never log a name, phone, email or raw identifier. */
export function maskForLog(value: string | null | undefined): string {
  const v = (value || '').trim();
  if (!v) return '(none)';
  return `${v.length}chars:${v.slice(0, 1)}***`;
}
