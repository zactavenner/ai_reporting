/**
 * Zero-OAuth "shadow invite" iCalendar builder.
 *
 * The notetaker account is invited by EMAIL with a standard METHOD:REQUEST
 * .ics attachment. Gmail auto-adds emailed invites to that account's calendar
 * (Event settings → "Add invitations to my calendar → From everyone"), and
 * MeetGeek joins from there. Nothing touches the organizer's calendar, so no
 * Google Calendar OAuth is required anywhere in this path.
 *
 * Pure module (no Deno/Supabase imports) so it is unit-testable.
 */

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface ShadowInviteInput {
  /** Stable UID derived from the GHL appointment id — never regenerate it. */
  uid: string;
  method: IcsMethod;
  /** Bumped on every time change so calendars accept the update. */
  sequence: number;
  start: string;
  end: string;
  summary: string;
  description?: string | null;
  /** Video meeting link — goes in both LOCATION and DESCRIPTION. */
  meetingUrl?: string | null;
  organizerEmail: string;
  organizerName?: string | null;
  attendeeEmail: string;
}

/** Stable UID space: one appointment ⇒ one calendar event, forever. */
export function buildShadowInviteUid(args: { clientId: string; appointmentId: string }): string {
  const safe = String(args.appointmentId).replace(/[^A-Za-z0-9._-]/g, '-');
  return `hpa-mg-${args.clientId}-${safe}@reporting.highperformanceads.com`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC basic-format timestamp required by RFC 5545. */
export function toIcsUtc(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('ics_invalid_date');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function escapeIcsText(value: string): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 folding is defined in OCTETS, not JS characters. Fold on the UTF-8
 * byte length and never split a multi-byte sequence.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 74) return line;
  const chars = Array.from(line);
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 74;
  for (const ch of chars) {
    const size = encoder.encode(ch).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = ch;
      currentBytes = size;
      limit = 73; // continuation lines start with a leading space
    } else {
      current += ch;
      currentBytes += size;
    }
  }
  if (current) out.push(current);
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join('\r\n');
}

/**
 * Visible title: the exact original appointment title when present. No internal
 * prefixes, client codes, or attribution labels ever reach the calendar.
 */
export function buildCalendarSummary(args: {
  appointmentTitle?: string | null;
  contactName?: string | null;
  calendarName?: string | null;
}): string {
  const title = (args.appointmentTitle || '').trim();
  if (title) return title;
  const contact = (args.contactName || '').trim();
  const calendar = (args.calendarName || '').trim();
  if (calendar && contact) return `${calendar} with ${contact}`;
  if (contact) return `Meeting with ${contact}`;
  if (calendar) return calendar;
  return 'Meeting';
}

/** Visible description: ordinary invite prose plus the join link. Nothing internal. */
export function buildCalendarDescription(args: {
  appointmentDescription?: string | null;
  meetingUrl?: string | null;
}): string {
  const body = (args.appointmentDescription || '').trim();
  const link = (args.meetingUrl || '').trim();
  return [body, link ? `Join: ${link}` : ''].filter(Boolean).join('\n\n');
}

export function buildShadowInviteIcs(input: ShadowInviteInput): string {
  const link = (input.meetingUrl || '').trim();
  const descriptionParts = [input.description || '', link ? `Join: ${link}` : ''].filter(Boolean);
  const description = (input.description || '').includes(link) && link
    ? input.description || ''
    : descriptionParts.join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//High Performance Ads//Reporting Notetaker//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `SEQUENCE:${Math.max(0, Math.floor(input.sequence))}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(input.start)}`,
    `DTEND:${toIcsUtc(input.end)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : '',
    link ? `LOCATION:${escapeIcsText(link)}` : '',
    link ? `URL;VALUE=URI:${link}` : '',
    `ORGANIZER;CN=${escapeIcsText(input.organizerName || 'High Performance Ads')}:mailto:${input.organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${input.attendeeEmail}`,
    input.method === 'CANCEL' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/**
 * Bumped whenever the VISIBLE calendar presentation changes, so every existing
 * upcoming linked appointment receives exactly one update into the new format
 * and then stays idempotent.
 */
export const CALENDAR_PRESENTATION_VERSION = 'v2-natural';

/** Signature used to detect reschedules (time change ⇒ SEQUENCE bump). */
export function scheduleSignature(start: string | null, end: string | null, link?: string | null): string {
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : '');
  return `${iso(start)}|${iso(end)}|${(link || '').trim()}|${CALENDAR_PRESENTATION_VERSION}`;
}

