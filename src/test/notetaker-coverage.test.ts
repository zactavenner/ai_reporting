import { describe, it, expect } from 'vitest';
import {
  buildCoverageRow,
  classifyAppointmentState,
  classifyExpectedProvider,
  computeOverdueAt,
  evaluateCoverage,
  summarizeCoverage,
  TRANSCRIPT_GRACE_MINUTES,
} from '../../supabase/functions/_shared/notetakerCoverage';
import {
  extractTranscriptText,
  isTerminalIngestStatus,
  hydrateMeetingFromProvider,
  normalizeMeetgeekPayload,
} from '../../supabase/functions/_shared/meetgeekIngest';

const NOW = new Date('2026-03-02T18:00:00Z');
const past = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();
const future = (min: number) => new Date(NOW.getTime() + min * 60000).toISOString();

describe('appointment state classification', () => {
  it('lets the CRM status win over timing', () => {
    expect(classifyAppointmentState({ rawStatus: 'cancelled', scheduledEnd: future(60), now: NOW })).toBe('cancelled');
    expect(classifyAppointmentState({ rawStatus: 'noshow', scheduledEnd: past(300), now: NOW })).toBe('noshow');
    expect(classifyAppointmentState({ rawStatus: 'showed', scheduledEnd: future(60), now: NOW })).toBe('completed');
  });

  it('treats a passed window as completed and flags reschedules', () => {
    expect(classifyAppointmentState({ rawStatus: 'confirmed', scheduledEnd: past(10), now: NOW })).toBe('completed');
    expect(
      classifyAppointmentState({ rawStatus: 'confirmed', scheduledEnd: future(60), scheduleChanged: true, now: NOW }),
    ).toBe('rescheduled');
  });
});

describe('expected provider classification', () => {
  it('routes video links to the notetaker and phone-only bookings to the dialer', () => {
    expect(classifyExpectedProvider({ meetingUrl: 'https://zoom.us/j/123' })).toBe('meetgeek');
    expect(classifyExpectedProvider({ meetingUrl: null, contactPhone: '+19167097345' })).toBe('ghl_phone');
    expect(classifyExpectedProvider({ meetingUrl: null, contactPhone: null })).toBe('none');
  });

  it('expects nothing for cancelled bookings', () => {
    expect(
      classifyExpectedProvider({ meetingUrl: 'https://zoom.us/j/1', appointmentState: 'cancelled' }),
    ).toBe('none');
  });
});

describe('coverage state machine', () => {
  it('is pending well before the call and awaiting once invited', () => {
    expect(
      evaluateCoverage({
        expectedProvider: 'meetgeek',
        appointmentState: 'scheduled',
        scheduledStart: future(600),
        scheduledEnd: future(660),
        now: NOW,
      }).coverage_state,
    ).toBe('pending');

    expect(
      evaluateCoverage({
        expectedProvider: 'meetgeek',
        appointmentState: 'scheduled',
        inviteState: 'invited',
        scheduledStart: future(30),
        scheduledEnd: future(90),
        now: NOW,
      }).coverage_state,
    ).toBe('awaiting_transcript');
  });

  it('raises an exception when the invite is missing at start time', () => {
    const result = evaluateCoverage({
      expectedProvider: 'meetgeek',
      appointmentState: 'scheduled',
      inviteState: 'pending',
      scheduledStart: future(5),
      scheduledEnd: future(65),
      now: NOW,
    });
    expect(result.coverage_state).toBe('exception');
    expect(result.exception_code).toBe('invite_not_delivered');
  });

  it('distinguishes never-invited from never-joined after the grace window', () => {
    const base = {
      expectedProvider: 'meetgeek' as const,
      appointmentState: 'completed' as const,
      scheduledStart: past(TRANSCRIPT_GRACE_MINUTES + 120),
      scheduledEnd: past(TRANSCRIPT_GRACE_MINUTES + 60),
      now: NOW,
    };
    expect(evaluateCoverage({ ...base, inviteState: 'invited' }).exception_code).toBe('notetaker_never_joined');
    expect(evaluateCoverage({ ...base, inviteState: 'pending' }).exception_code).toBe('invite_never_sent');
  });

  it('flags overdue phone appointments with no transcript', () => {
    const result = evaluateCoverage({
      expectedProvider: 'ghl_phone',
      appointmentState: 'completed',
      scheduledEnd: past(TRANSCRIPT_GRACE_MINUTES + 30),
      now: NOW,
    });
    expect(result.exception_code).toBe('phone_transcript_missing');
    expect(result.outcome).toBe('no_transcript');
  });

  it('closes as complete only when a real transcript is linked', () => {
    const complete = evaluateCoverage({
      expectedProvider: 'meetgeek',
      appointmentState: 'completed',
      inviteState: 'invited',
      scheduledEnd: past(200),
      transcriptChars: 4000,
      meetingRecordId: 'rec_1',
      now: NOW,
    });
    expect(complete.coverage_state).toBe('transcript_complete');
    expect(complete.exception_code).toBeNull();

    const tooShort = evaluateCoverage({
      expectedProvider: 'meetgeek',
      appointmentState: 'completed',
      inviteState: 'invited',
      scheduledEnd: past(TRANSCRIPT_GRACE_MINUTES + 10),
      transcriptChars: 12,
      meetingRecordId: 'rec_1',
      now: NOW,
    });
    expect(tooShort.coverage_state).toBe('exception');
  });

  it('never demands capture for cancelled, no-show or unrecordable bookings', () => {
    expect(
      evaluateCoverage({ expectedProvider: 'meetgeek', appointmentState: 'cancelled', scheduledEnd: past(500), now: NOW })
        .coverage_state,
    ).toBe('not_required');
    expect(
      evaluateCoverage({ expectedProvider: 'none', appointmentState: 'completed', scheduledEnd: past(500), now: NOW })
        .coverage_state,
    ).toBe('not_required');
    expect(
      evaluateCoverage({
        expectedProvider: 'meetgeek',
        appointmentState: 'noshow',
        inviteState: 'invited',
        scheduledEnd: past(TRANSCRIPT_GRACE_MINUTES + 30),
        now: NOW,
      }).coverage_state,
    ).toBe('not_required');
  });

  it('computes the deterministic grace deadline', () => {
    expect(computeOverdueAt('2026-03-02T17:00:00Z', 'meetgeek')).toBe('2026-03-02T18:30:00.000Z');
    expect(computeOverdueAt('2026-03-02T17:00:00Z', 'none')).toBeNull();
    expect(computeOverdueAt(null, 'meetgeek')).toBeNull();
  });
});

describe('coverage row build + rollup', () => {
  it('is deterministic for the same appointment input (idempotent upserts)', () => {
    const input = {
      clientId: 'c1',
      ghlAppointmentId: 'appt_1',
      meetingUrl: 'https://meet.google.com/abc',
      scheduledStart: future(120),
      scheduledEnd: future(180),
      rawStatus: 'confirmed',
      inviteState: 'invited',
      now: NOW,
    };
    const a = buildCoverageRow(input);
    const b = buildCoverageRow(input);
    expect(a).toEqual(b);
    expect(a.expected_provider).toBe('meetgeek');
    expect(a.coverage_state).toBe('awaiting_transcript');
  });

  it('rolls up capture rate ignoring not-required rows', () => {
    const summary = summarizeCoverage([
      { coverage_state: 'transcript_complete', expected_provider: 'meetgeek' },
      { coverage_state: 'transcript_complete', expected_provider: 'ghl_phone' },
      { coverage_state: 'exception', exception_code: 'invite_never_sent', expected_provider: 'meetgeek' },
      { coverage_state: 'not_required', expected_provider: 'none' },
      { coverage_state: 'pending', expected_provider: 'meetgeek' },
    ]);
    expect(summary.total).toBe(5);
    expect(summary.transcript_complete).toBe(2);
    expect(summary.exceptions).toBe(1);
    expect(summary.by_exception.invite_never_sent).toBe(1);
    expect(summary.capture_rate).toBe(66.7);
  });
});

describe('MeetGeek hydration recovery + parsing', () => {
  it('only treats processed/ignored ingest events as terminal', () => {
    expect(isTerminalIngestStatus('processed')).toBe(true);
    expect(isTerminalIngestStatus('ignored')).toBe(true);
    expect(isTerminalIngestStatus('failed')).toBe(false);
    expect(isTerminalIngestStatus('rejected')).toBe(false);
    expect(isTerminalIngestStatus('processing')).toBe(false);
  });

  it('parses transcripts from sentence.transcript, sentence.text and plain strings', () => {
    expect(
      extractTranscriptText({ sentences: [{ speaker: 'Rep', transcript: 'Hello there' }, { transcript: 'Thanks' }] }),
    ).toBe('Rep: Hello there\nThanks');
    expect(extractTranscriptText({ sentences: [{ text: 'legacy field' }] })).toBe('legacy field');
    expect(extractTranscriptText({ transcript: '  raw text  ' })).toBe('raw text');
    expect(extractTranscriptText({ sentences: [] })).toBeNull();
  });

  it('adopts join_link and participant_emails from the provider response', () => {
    const meeting = normalizeMeetgeekPayload({ message: 'File analyzed successfully', meeting_id: 'mtg_9' })!;
    const hydrated = hydrateMeetingFromProvider(meeting, {
      timestamp_start_utc: '2026-03-02T16:00:00Z',
      timestamp_end_utc: '2026-03-02T16:45:00Z',
      title: 'Investor call',
      join_link: 'https://zoom.us/j/999',
      participant_emails: ['Rep@Agency.com', 'jane@acme.com'],
      transcript: { sentences: [{ speaker: 'Jane', transcript: 'I am interested' }] },
    })!;
    expect(hydrated.sourceUrl).toBe('https://zoom.us/j/999');
    expect(hydrated.participants.map((p) => p.email)).toEqual(['rep@agency.com', 'jane@acme.com']);
    expect(hydrated.transcriptText).toBe('Jane: I am interested');
    expect(hydrated.hydrationRequired).toBe(false);
  });
});
