import { describe, it, expect } from 'vitest';
import {
  assertOwnerPreserved,
  botAlreadyGuest,
  buildAttendeePatch,
  buildInviteIdempotencyKey,
  buildTaggedEventSearch,
  CALENDAR_SCOPES,
  evaluateGuestGate,
  redactConnection,
  resolveEventLink,
  verifyWebhookSignature,
  type GhlAppointmentLite,
  type GuestConfig,
  type GoogleEventLite,
} from '../../supabase/functions/_shared/calendarGuest';

const config: GuestConfig = {
  id: 'cfg-1',
  clientId: 'client-1',
  enabled: true,
  ghlLocationId: 'loc-1',
  ghlCalendarId: 'cal-1',
  calendarConnectionId: 'conn-1',
  organizerCalendarId: 'primary',
  botGuestEmail: 'Notetaker@MeetGeek.ai',
};

const appointment: GhlAppointmentLite = {
  appointmentId: 'appt-1',
  calendarId: 'cal-1',
  locationId: 'loc-1',
  title: 'Discovery call',
  startTime: '2026-08-10T15:00:00.000Z',
  endTime: '2026-08-10T15:30:00.000Z',
};

async function sign(body: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('webhook signature verification (fail closed)', () => {
  const body = JSON.stringify({ appointmentId: 'appt-1' });

  it('accepts a valid hex signature', async () => {
    const header = await sign(body, 's3cret');
    expect(await verifyWebhookSignature({ rawBody: body, header, secret: 's3cret' })).toBe(true);
    expect(await verifyWebhookSignature({ rawBody: body, header: `sha256=${header}`, secret: 's3cret' })).toBe(true);
  });

  it('rejects wrong secret, tampered body, missing header and missing secret', async () => {
    const header = await sign(body, 's3cret');
    expect(await verifyWebhookSignature({ rawBody: body, header, secret: 'other' })).toBe(false);
    expect(await verifyWebhookSignature({ rawBody: body + ' ', header, secret: 's3cret' })).toBe(false);
    expect(await verifyWebhookSignature({ rawBody: body, header: null, secret: 's3cret' })).toBe(false);
    expect(await verifyWebhookSignature({ rawBody: body, header, secret: null })).toBe(false);
    expect(await verifyWebhookSignature({ rawBody: body, header: 'deadbeef', secret: 's3cret' })).toBe(false);
  });
});

describe('mapping gate', () => {
  it('allows a fully mapped, enabled, matching appointment', () => {
    const decision = evaluateGuestGate({ config, appointment });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.botGuestEmail).toBe('notetaker@meetgeek.ai');
  });

  it('rejects unmapped, disabled and incomplete configuration', () => {
    expect(evaluateGuestGate({ config: null, appointment })).toMatchObject({ reason: 'not_configured' });
    expect(evaluateGuestGate({ config: { ...config, enabled: false }, appointment })).toMatchObject({ reason: 'disabled' });
    expect(evaluateGuestGate({ config: { ...config, calendarConnectionId: null }, appointment })).toMatchObject({
      reason: 'no_calendar_connection',
    });
    expect(evaluateGuestGate({ config: { ...config, botGuestEmail: null }, appointment })).toMatchObject({
      reason: 'no_bot_guest_email',
    });
    expect(evaluateGuestGate({ config: { ...config, ghlCalendarId: null }, appointment })).toMatchObject({
      reason: 'no_calendar_mapped',
    });
  });

  it('rejects mismatched location and mismatched calendar', () => {
    expect(evaluateGuestGate({ config, appointment: { ...appointment, locationId: 'loc-2' } })).toMatchObject({
      reason: 'location_mismatch',
    });
    expect(evaluateGuestGate({ config, appointment: { ...appointment, calendarId: 'cal-9' } })).toMatchObject({
      reason: 'calendar_mismatch',
    });
    expect(evaluateGuestGate({ config, appointment: { ...appointment, locationId: null } })).toMatchObject({
      reason: 'appointment_location_missing',
    });
    expect(evaluateGuestGate({ config, appointment: { ...appointment, calendarId: null } })).toMatchObject({
      reason: 'appointment_calendar_missing',
    });
    expect(evaluateGuestGate({ config, appointment: null })).toMatchObject({ reason: 'appointment_not_found' });
  });
});

describe('idempotency and event linkage', () => {
  it('produces a stable key regardless of email casing', () => {
    const a = buildInviteIdempotencyKey({ clientId: 'c', appointmentId: 'a', botGuestEmail: 'Bot@X.com' });
    const b = buildInviteIdempotencyKey({ clientId: 'c', appointmentId: 'a', botGuestEmail: 'bot@x.com' });
    expect(a).toBe(b);
    expect(a).not.toBe(buildInviteIdempotencyKey({ clientId: 'c', appointmentId: 'a2', botGuestEmail: 'bot@x.com' }));
  });

  it('prefers a tagged event, adopts a single window match, and never duplicates', () => {
    const tagged: GoogleEventLite = { id: 'ev-tagged' };
    const win: GoogleEventLite = { id: 'ev-window' };
    expect(resolveEventLink({ taggedEvents: [tagged], windowEvents: [win] })).toMatchObject({ kind: 'tagged' });
    expect(resolveEventLink({ taggedEvents: [], windowEvents: [win] })).toMatchObject({ kind: 'adopted' });
    expect(resolveEventLink({ taggedEvents: [], windowEvents: [win, { id: 'x' }] })).toMatchObject({
      kind: 'needs_event_link',
      candidates: 2,
    });
    expect(resolveEventLink({ taggedEvents: [], windowEvents: [] })).toMatchObject({ kind: 'needs_event_link' });
    expect(resolveEventLink({ taggedEvents: [], windowEvents: [], allowCreate: true })).toMatchObject({ kind: 'create' });
    expect(resolveEventLink({ taggedEvents: [{ id: 'c', status: 'cancelled' }], windowEvents: [] })).toMatchObject({
      kind: 'needs_event_link',
    });
    expect(buildTaggedEventSearch('appt-1').privateExtendedProperty).toBe('hpaGhlAppointmentId=appt-1');
  });

  it('is a no-op when the bot is already a guest', () => {
    const event: GoogleEventLite = { id: 'ev', attendees: [{ email: 'NoteTaker@meetgeek.ai' }] };
    expect(botAlreadyGuest(event, 'notetaker@meetgeek.ai')).toBe(true);
    const patch = buildAttendeePatch({ event, botGuestEmail: 'notetaker@meetgeek.ai', appointmentId: 'a', clientId: 'c' });
    expect(patch.attendees).toHaveLength(1);
  });
});

describe('owner preservation', () => {
  const event: GoogleEventLite = {
    id: 'ev',
    organizer: { email: 'organizer@client.com', self: true },
    creator: { email: 'organizer@client.com' },
    attendees: [
      { email: 'organizer@client.com', organizer: true, responseStatus: 'accepted' },
      { email: 'investor@example.com', responseStatus: 'needsAction' },
    ],
  };

  it('appends the bot as a plain guest and preserves existing attendees', () => {
    const patch = buildAttendeePatch({ event, botGuestEmail: 'bot@meetgeek.ai', appointmentId: 'appt-1', clientId: 'client-1' });
    expect(patch.attendees.map((a) => a.email)).toEqual([
      'organizer@client.com',
      'investor@example.com',
      'bot@meetgeek.ai',
    ]);
    expect(patch.attendees[0].organizer).toBe(true);
    expect(patch.attendees[2].organizer).toBeUndefined();
    expect(Object.keys(patch)).toEqual(['attendees', 'extendedProperties']);
    expect(patch.extendedProperties.private.hpaGhlAppointmentId).toBe('appt-1');
    expect(() => assertOwnerPreserved(patch as any, 'bot@meetgeek.ai')).not.toThrow();
  });

  it('blocks any ownership mutation', () => {
    for (const key of ['organizer', 'creator', 'owner', 'assignedUserId', 'calendarId', 'transferOwnership']) {
      expect(() => assertOwnerPreserved({ [key]: 'x' }, 'bot@meetgeek.ai')).toThrow(/owner_mutation_blocked/);
    }
    expect(() =>
      assertOwnerPreserved({ attendees: [{ email: 'bot@meetgeek.ai', organizer: true }] }, 'bot@meetgeek.ai'),
    ).toThrow(/bot_organizer/);
  });
});

describe('no token exposure', () => {
  it('redacts every credential field from connection metadata', () => {
    const redacted = redactConnection({
      id: 'conn-1',
      organizer_email: 'organizer@client.com',
      display_name: 'Organizer',
      status: 'active',
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email',
      refresh_token: 'SUPER_SECRET_REFRESH',
      access_token: 'SUPER_SECRET_ACCESS',
      access_token_expires_at: '2026-08-10T00:00:00.000Z',
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('SUPER_SECRET_REFRESH');
    expect(serialized).not.toContain('SUPER_SECRET_ACCESS');
    expect(serialized).not.toContain('refresh_token');
    expect(redacted.token_present).toBe(true);
    expect(redacted.scope_summary).toBe('calendar.events, userinfo.email');
  });

  it('requests least-privilege calendar scopes only', () => {
    expect(CALENDAR_SCOPES).toBe(
      'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email',
    );
    expect(CALENDAR_SCOPES).not.toContain('gmail');
    expect(CALENDAR_SCOPES).not.toContain('auth/calendar ');
  });
});