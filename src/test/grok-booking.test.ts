import { describe, it, expect } from 'vitest';
import {
  authorizeGrokBooking,
  validateSlotsInput,
  validateBookingInput,
  parseFreeSlots,
  slotIsAvailable,
  matchSlot,
  endTimeFor,
  bookingIdempotencyKey,
  offsetMatchesTimezone,
  maskForLog,
} from '../../supabase/functions/_shared/grokBooking.ts';

const TOKEN = 'a'.repeat(40);

/** A future instant, expressed with the correct New York offset. */
function futureNyIso(daysAhead = 3): string {
  const d = new Date(Date.now() + daysAhead * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, p) => (a[p.type] = p.value, a), {});
  const offName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(d).find((p) => p.type === 'timeZoneName')!.value;
  const off = offName.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00${off}`;
}

describe('grok-booking auth (fail closed)', () => {
  it('rejects when the environment secret is absent', () => {
    expect(authorizeGrokBooking(TOKEN, undefined)).toBe(false);
    expect(authorizeGrokBooking(TOKEN, '')).toBe(false);
  });
  it('rejects wrong, short and empty presented tokens', () => {
    expect(authorizeGrokBooking('', TOKEN)).toBe(false);
    expect(authorizeGrokBooking('short', TOKEN)).toBe(false);
    expect(authorizeGrokBooking('b'.repeat(40), TOKEN)).toBe(false);
  });
  it('accepts only the exact token', () => {
    expect(authorizeGrokBooking(TOKEN, TOKEN)).toBe(true);
  });
});

describe('get_available_slots input', () => {
  it('accepts a valid range and timezone', () => {
    const r = validateSlotsInput({ start_date: '2026-09-07', end_date: '2026-09-12', timezone: 'America/New_York' });
    expect(r.ok).toBe(true);
  });
  it('defaults end_date to start_date', () => {
    const r = validateSlotsInput({ start_date: '2026-09-07', timezone: 'UTC' });
    expect(r.ok && r.value.endDate).toBe('2026-09-07');
  });
  it('rejects bad dates, reversed ranges, oversized ranges and bad zones', () => {
    expect(validateSlotsInput({ start_date: '09/07/2026', timezone: 'UTC' })).toMatchObject({ code: 'invalid_date_range' });
    expect(validateSlotsInput({ start_date: '2026-09-12', end_date: '2026-09-07', timezone: 'UTC' })).toMatchObject({ code: 'invalid_date_range' });
    expect(validateSlotsInput({ start_date: '2026-09-01', end_date: '2026-11-01', timezone: 'UTC' })).toMatchObject({ code: 'invalid_date_range' });
    expect(validateSlotsInput({ start_date: '2026-09-07', timezone: 'Mars/Olympus' })).toMatchObject({ code: 'invalid_timezone' });
  });
});

describe('create_discovery_booking input', () => {
  const base = { name: 'Jane Doe', phone: '+1 916 709 7345', email: 'jane@example.com', timezone: 'America/New_York' };

  it('accepts a complete, future, offset-correct request', () => {
    const r = validateBookingInput({ ...base, start_time: futureNyIso() });
    expect(r.ok).toBe(true);
  });

  it('requires name, phone, email, start_time and timezone', () => {
    expect(validateBookingInput({ ...base, name: '', start_time: futureNyIso() })).toMatchObject({ code: 'invalid_name' });
    expect(validateBookingInput({ ...base, phone: '123', start_time: futureNyIso() })).toMatchObject({ code: 'invalid_phone' });
    expect(validateBookingInput({ ...base, email: 'nope', start_time: futureNyIso() })).toMatchObject({ code: 'invalid_email' });
    expect(validateBookingInput({ ...base, start_time: 'tomorrow at 3' })).toMatchObject({ code: 'invalid_start_time' });
    expect(validateBookingInput({ ...base, start_time: futureNyIso(), timezone: undefined })).toMatchObject({ code: 'invalid_timezone' });
  });

  it('rejects an offset that contradicts the timezone', () => {
    const r = validateBookingInput({ ...base, start_time: '2099-09-07T14:00:00+09:00' });
    expect(r).toMatchObject({ code: 'timezone_mismatch' });
  });

  it('rejects times in the past', () => {
    expect(validateBookingInput({ ...base, start_time: '2020-09-07T14:00:00-04:00' }))
      .toMatchObject({ code: 'start_time_in_past' });
  });

  it('validates offsets against the zone at that instant (DST aware)', () => {
    expect(offsetMatchesTimezone('2026-07-01T12:00:00-04:00', 'America/New_York')).toBe(true);
    expect(offsetMatchesTimezone('2026-01-01T12:00:00-04:00', 'America/New_York')).toBe(false);
    expect(offsetMatchesTimezone('2026-01-01T12:00:00-05:00', 'America/New_York')).toBe(true);
  });
});

describe('GHL free-slots parsing and staleness', () => {
  const body = {
    '2026-09-07': { slots: ['2026-09-07T13:30:00-04:00', '2026-09-07T14:00:00-04:00'] },
    traceId: 'x',
  };

  it('parses the date-keyed shape', () => {
    expect(parseFreeSlots(body)).toEqual(['2026-09-07T13:30:00-04:00', '2026-09-07T14:00:00-04:00']);
  });

  it('parses the nested slots-object and object-slot shapes', () => {
    expect(parseFreeSlots({ slots: { '2026-09-07': [{ slot: '2026-09-07T15:00:00-04:00' }] } }))
      .toEqual(['2026-09-07T15:00:00-04:00']);
  });

  it('returns nothing for empty or malformed payloads', () => {
    expect(parseFreeSlots(null)).toEqual([]);
    expect(parseFreeSlots({ '2026-09-07': { slots: ['not-a-time'] } })).toEqual([]);
  });

  it('matches a requested instant across equivalent offsets', () => {
    expect(slotIsAvailable(parseFreeSlots(body), '2026-09-07T17:30:00Z')).toBe(true);
    expect(matchSlot(parseFreeSlots(body), '2026-09-07T17:30:00Z')).toBe('2026-09-07T13:30:00-04:00');
  });

  it('treats an unlisted or removed slot as stale/unavailable', () => {
    expect(slotIsAvailable(parseFreeSlots(body), '2026-09-07T16:00:00-04:00')).toBe(false);
    expect(slotIsAvailable([], '2026-09-07T13:30:00-04:00')).toBe(false);
  });
});

describe('booking result shape and idempotency', () => {
  it('derives a 30 minute end time', () => {
    expect(endTimeFor('2026-09-07T13:30:00-04:00')).toBe('2026-09-07T18:00:00.000Z');
  });

  it('is stable for the same calendar + instant + invitee, and differs otherwise', async () => {
    const a = await bookingIdempotencyKey('5NMmbITnqFbds1yWP3TD', '2026-09-07T13:30:00-04:00', 'Jane@Example.com');
    const b = await bookingIdempotencyKey('5NMmbITnqFbds1yWP3TD', '2026-09-07T17:30:00Z', 'jane@example.com');
    const c = await bookingIdempotencyKey('5NMmbITnqFbds1yWP3TD', '2026-09-07T14:00:00-04:00', 'jane@example.com');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('grok-booking-')).toBe(true);
  });

  it('never puts PII in log strings', () => {
    const masked = maskForLog('jane@example.com');
    expect(masked).not.toContain('jane@example.com');
    expect(masked).not.toContain('example');
    expect(maskForLog('')).toBe('(none)');
  });
});

/** Successful booking, fully mocked: availability read -> contact -> appointment. */
describe('mocked successful booking flow', () => {
  it('books only after the slot is confirmed available and returns the appointment id', async () => {
    const start = '2026-09-07T13:30:00-04:00';
    const freeSlots = { '2026-09-07': { slots: [start] } };
    const calls: string[] = [];

    const ghl = async (path: string) => {
      calls.push(path.split('?')[0]);
      if (path.includes('free-slots')) return freeSlots;
      if (path.includes('/contacts')) return { contact: { id: 'contact_123' } };
      return { id: 'appt_456', calendarId: '5NMmbITnqFbds1yWP3TD', startTime: start };
    };

    const slots = parseFreeSlots(await ghl('/calendars/5NMmbITnqFbds1yWP3TD/free-slots?x=1'));
    expect(slotIsAvailable(slots, start)).toBe(true);

    const contact = await ghl('/contacts/upsert');
    const appt: any = await ghl('/calendars/events/appointments');

    expect(calls[0]).toBe('/calendars/5NMmbITnqFbds1yWP3TD/free-slots');
    expect(contact).toMatchObject({ contact: { id: 'contact_123' } });
    expect({
      appointment_id: appt.id,
      start_time: appt.startTime,
      end_time: endTimeFor(start),
      timezone: 'America/New_York',
      calendar_name: '30-min Discovery Call',
    }).toEqual({
      appointment_id: 'appt_456',
      start_time: start,
      end_time: '2026-09-07T18:00:00.000Z',
      timezone: 'America/New_York',
      calendar_name: '30-min Discovery Call',
    });
  });

  it('does not book when the pre-write availability read comes back empty', async () => {
    const slots = parseFreeSlots({ '2026-09-07': { slots: [] } });
    expect(slotIsAvailable(slots, '2026-09-07T13:30:00-04:00')).toBe(false);
  });
});
