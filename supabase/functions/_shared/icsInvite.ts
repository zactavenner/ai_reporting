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

/** RFC 5545 requires folding at 75 octets. */
export function foldIcsLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length) {
    parts.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  return parts.join('\r\n');
}

export function buildShadowInviteIcs(input: ShadowInviteInput): string {
  const link = (input.meetingUrl || '').trim();
  const descriptionParts = [input.description || '', link ? `Join: ${link}` : ''].filter(Boolean);
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
    descriptionParts.length ? `DESCRIPTION:${escapeIcsText(descriptionParts.join('\n\n'))}` : '',
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

/** Signature used to detect reschedules (time change ⇒ SEQUENCE bump). */
export function scheduleSignature(start: string | null, end: string | null, link?: string | null): string {
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : '');
  return `${iso(start)}|${iso(end)}|${(link || '').trim()}`;
}
