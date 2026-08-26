import { describe, it, expect } from 'vitest';
import {
  classifyHydrationFailure,
  normalizeHydrationAttempt,
  isTerminalIngestStatus,
  extractTranscriptText,
  hydrateMeetingFromProvider,
  normalizeMeetgeekPayload,
} from '../../supabase/functions/_shared/meetgeekIngest';
import { buildCoverageRow } from '../../supabase/functions/_shared/notetakerCoverage';

const NOW = new Date('2026-03-02T18:00:00Z');
const future = (min: number) => new Date(NOW.getTime() + min * 60000).toISOString();

describe('hydration diagnostics', () => {
  it('distinguishes every documented failure mode without leaking credentials', () => {
    expect(classifyHydrationFailure({ apiKeyPresent: false }).code).toBe('missing_api_key');
    expect(classifyHydrationFailure({ apiKeyPresent: true, httpStatus: 401 }).code).toBe('unauthorized');
    expect(classifyHydrationFailure({ apiKeyPresent: true, httpStatus: 403 }).code).toBe('unauthorized');
    expect(classifyHydrationFailure({ apiKeyPresent: true, httpStatus: 404 }).code).toBe('not_found');
    expect(classifyHydrationFailure({ apiKeyPresent: true, httpStatus: 429 }).code).toBe('rate_limited');
    expect(classifyHydrationFailure({ apiKeyPresent: true, httpStatus: 502 }).code).toBe('server_error');
    expect(classifyHydrationFailure({ apiKeyPresent: true, errorKind: 'parse' }).code).toBe('parse_error');
    expect(classifyHydrationFailure({ apiKeyPresent: true, errorKind: 'network' }).code).toBe('network_error');
    expect(classifyHydrationFailure({}).code).toBe('empty_response');

    const details = [401, 403, 404, 429].map((s) => classifyHydrationFailure({ apiKeyPresent: true, httpStatus: s }).detail || '');
    for (const d of details) {
      expect(d).not.toMatch(/Bearer|@|token|key\s*=/i);
    }
  });

  it('normalizes both plain-meeting and diagnostic hydration return shapes', () => {
    const meeting = normalizeMeetgeekPayload({ message: 'File analyzed successfully', meeting_id: 'mtg_1' })!;
    expect(normalizeHydrationAttempt(meeting).meeting?.meetingExternalId).toBe('mtg_1');
    expect(normalizeHydrationAttempt(null).meeting).toBeNull();
    const wrapped = normalizeHydrationAttempt({ meeting: null, diagnostic: { code: 'not_found' } });
    expect(wrapped.meeting).toBeNull();
    expect(wrapped.diagnostic?.code).toBe('not_found');
  });

  it('keeps a hydration failure retryable (never a terminal duplicate)', () => {
    // Events rejected with provider_hydration_failed stay retryable so the next
    // delivery or an operator replay re-hydrates them.
    expect(isTerminalIngestStatus('rejected')).toBe(false);
    expect(isTerminalIngestStatus('received')).toBe(false);
    expect(isTerminalIngestStatus('processed')).toBe(true);
  });
});

describe('current MeetGeek field parsing', () => {
  it('adopts join_link + participant_emails and sentence.transcript pages', () => {
    const base = normalizeMeetgeekPayload({ message: 'File analyzed successfully', meeting_id: 'mtg_2' })!;
    const hydrated = hydrateMeetingFromProvider(base, {
      timestamp_start_utc: '2026-03-02T16:00:00Z',
      timestamp_end_utc: '2026-03-02T16:30:00Z',
      join_link: 'https://meet.google.com/xyz',
      participant_emails: ['A@Agency.com'],
    })!;
    expect(hydrated.sourceUrl).toBe('https://meet.google.com/xyz');
    expect(hydrated.participants.map((p) => p.email)).toEqual(['a@agency.com']);

    const page1 = extractTranscriptText({ sentences: [{ speaker: 'Rep', transcript: 'Page one' }], cursor: 'c2' });
    const page2 = extractTranscriptText({ sentences: [{ transcript: 'Page two' }] });
    expect([page1, page2].join('\n')).toBe('Rep: Page one\nPage two');
  });
});

describe('coverage routing + idempotency', () => {
  it('routes no-link bookings to GHL phone instead of a ghost-invite failure', () => {
    const row = buildCoverageRow({
      clientId: 'c1',
      ghlAppointmentId: 'appt_phone',
      meetingUrl: null,
      contactPhone: '+19167097345',
      scheduledStart: future(120),
      scheduledEnd: future(150),
      rawStatus: 'confirmed',
      now: NOW,
    });
    expect(row.expected_provider).toBe('ghl_phone');
    expect(row.exception_code).toBeNull();
  });

  it('is idempotent across reschedule and cancellation', () => {
    const input = {
      clientId: 'c1',
      ghlAppointmentId: 'appt_1',
      meetingUrl: 'https://zoom.us/j/1',
      scheduledStart: future(120),
      scheduledEnd: future(180),
      rawStatus: 'confirmed',
      inviteState: 'invited',
      now: NOW,
    };
    expect(buildCoverageRow(input)).toEqual(buildCoverageRow(input));

    const moved = buildCoverageRow({ ...input, scheduledStart: future(300), scheduledEnd: future(360) });
    expect(moved.ghl_appointment_id).toBe('appt_1');
    expect(moved.scheduled_start).not.toBe(buildCoverageRow(input).scheduled_start);

    const cancelled = buildCoverageRow({ ...input, cancelled: true });
    const cancelledAgain = buildCoverageRow({ ...input, cancelled: true });
    expect(cancelled.coverage_state).toBe('not_required');
    expect(cancelled.expected_provider).toBe('none');
    expect(cancelled).toEqual(cancelledAgain);
  });
});
