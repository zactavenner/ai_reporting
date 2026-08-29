import { describe, it, expect } from 'vitest';
import {
  CALENDAR_PRESENTATION_VERSION,
  buildCalendarDescription,
  buildCalendarSummary,
  buildShadowInviteIcs,
  buildShadowInviteUid,
  escapeIcsText,
  foldIcsLine,
  scheduleSignature,
} from '../../supabase/functions/_shared/icsInvite';

const base = {
  uid: buildShadowInviteUid({ clientId: 'client-1', appointmentId: 'appt-1' }),
  method: 'REQUEST' as const,
  sequence: 0,
  start: '2026-09-01T17:00:00.000Z',
  end: '2026-09-01T17:30:00.000Z',
  summary: 'Discovery Call — Acme Capital',
  description: 'Intro chat about the fund.',
  meetingUrl: 'https://us02web.zoom.us/j/1234567890',
  organizerEmail: 'invites@highperformanceads.com',
  organizerName: 'Acme Capital',
  attendeeEmail: 'theainotetaker@gmail.com',
};

describe('visible calendar presentation', () => {
  it('uses the exact trimmed appointment title when present', () => {
    expect(buildCalendarSummary({ appointmentTitle: '  Strategy Call  ', contactName: 'Jane' })).toBe('Strategy Call');
  });

  it('falls back to natural calendar/contact wording only when the title is absent', () => {
    expect(buildCalendarSummary({ appointmentTitle: null, calendarName: 'Discovery Call', contactName: 'Jane Doe' }))
      .toBe('Discovery Call with Jane Doe');
    expect(buildCalendarSummary({ appointmentTitle: '', contactName: 'Jane Doe' })).toBe('Meeting with Jane Doe');
    expect(buildCalendarSummary({})).toBe('Meeting');
  });

  it('builds an ordinary description with the original body and join link', () => {
    const d = buildCalendarDescription({ appointmentDescription: 'Bring the deck.', meetingUrl: 'https://meet.google.com/abc' });
    expect(d).toBe('Bring the deck.\n\nJoin: https://meet.google.com/abc');
  });

  it('never leaks internal labels into visible ICS content', () => {
    const unfolded = buildShadowInviteIcs(base).replace(/\r\n /g, '');
    const visible = unfolded
      .split('\r\n')
      .filter((l) => /^(SUMMARY|DESCRIPTION|LOCATION):/.test(l))
      .join('\n');
    for (const banned of ['HPA', 'Reporting', 'ghost', 'shadow', 'notetaker', 'Ref:', 'Auto-scheduled', 'Sales agent', 'client-1']) {
      expect(visible.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });


  it('preserves normal calendar semantics', () => {
    const ics = buildShadowInviteIcs(base);
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('DTSTART:20260901T170000Z');
    expect(ics).toContain('DTEND:20260901T173000Z');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('TRANSP:OPAQUE');
    expect(ics).toContain('LOCATION:https://us02web.zoom.us/j/1234567890');
    expect(ics).toContain('URL;VALUE=URI:https://us02web.zoom.us/j/1234567890');
    expect(ics).toContain('mailto:theainotetaker@gmail.com');
    expect(ics).toContain(`UID:${base.uid}`);
  });

  it('keeps the same UID on update and cancel, with a bumped sequence', () => {
    const update = buildShadowInviteIcs({ ...base, sequence: 1 });
    const cancel = buildShadowInviteIcs({ ...base, method: 'CANCEL', sequence: 2 });
    expect(update).toContain(`UID:${base.uid}`);
    expect(update).toContain('SEQUENCE:1');
    expect(cancel).toContain(`UID:${base.uid}`);
    expect(cancel).toContain('METHOD:CANCEL');
    expect(cancel).toContain('STATUS:CANCELLED');
    expect(cancel).toContain('SEQUENCE:2');
  });

  it('versions the schedule signature so existing invites update exactly once', () => {
    const sig = scheduleSignature(base.start, base.end, base.meetingUrl);
    expect(sig.endsWith(`|${CALENDAR_PRESENTATION_VERSION}`)).toBe(true);
    expect(sig).not.toBe(`${new Date(base.start).toISOString()}|${new Date(base.end).toISOString()}|${base.meetingUrl}`);
    expect(scheduleSignature(base.start, base.end, base.meetingUrl)).toBe(sig);
  });

  it('escapes text and folds on UTF-8 octets without splitting characters', () => {
    expect(escapeIcsText('a,b;c\nd')).toBe('a\\,b\\;c\\nd');
    const folded = foldIcsLine('DESCRIPTION:' + 'é'.repeat(80));
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('')).toBe('DESCRIPTION:' + 'é'.repeat(80));
    folded.split('\r\n').slice(1).forEach((l) => expect(l.startsWith(' ')).toBe(true));
  });
});
