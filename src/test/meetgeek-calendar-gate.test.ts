import { describe, it, expect } from 'vitest';
import {
  buildActivityKey,
  evaluateCalendarGate,
  nextCrmState,
  processCalendarMeeting,
  type CalendarAppointment,
  type LifecycleDeps,
  type MeetgeekClientConfig,
} from '../../supabase/functions/_shared/meetgeekCalendarGate';
import { normalizeMeetgeekPayload, type NormalizedMeeting } from '../../supabase/functions/_shared/meetgeekIngest';
import { scoreMeetingQuality } from '../../supabase/functions/_shared/meetgeekQuality';

const config: MeetgeekClientConfig = {
  clientId: 'client-1',
  enabled: true,
  ghlLocationId: 'loc-1',
  ghlCalendarId: 'cal-selected',
  botJoinPolicy: 'selected_calendar_video_only',
  mappingValid: true,
};

function appt(over: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    eventId: 'evt-1',
    calendarId: 'cal-selected',
    locationId: 'loc-1',
    contactId: 'ghl-1',
    attendeeEmail: 'jane@acme.com',
    title: 'Discovery Call',
    startTime: '2026-02-01T17:00:00Z',
    endTime: '2026-02-01T17:30:00Z',
    isVideo: true,
    ...over,
  };
}

const meeting: NormalizedMeeting = normalizeMeetgeekPayload({
  event_id: 'evt_1',
  status: 'analyzed',
  meeting: {
    meeting_id: 'mtg_1',
    title: 'Discovery Call - Acme',
    timestamp_start_utc: '2026-02-01T17:00:00Z',
    timestamp_end_utc: '2026-02-01T17:30:00Z',
  },
  participants: [{ name: 'Jane', email: 'jane@acme.com' }],
  summary: 'Great call',
  action_items: ['Send deck'],
})!;

function makeDeps(over: Partial<LifecycleDeps> = {}) {
  const calls: any = { activities: [], patches: [], notes: [], health: [] };
  const deps: LifecycleDeps = {
    getConfigForMeeting: async () => config,
    findAppointments: async () => [appt()],
    findActivity: async () => null,
    upsertActivity: async (row) => { calls.activities.push(row); return { id: 'act-1' }; },
    patchActivity: async (id, patch) => { calls.patches.push({ id, ...patch }); },
    matchLead: async () => ({ id: 'lead-1', external_id: 'ghl-1', email: 'jane@acme.com' }),
    writeGhlNote: async (i) => { calls.notes.push(i); return { status: 'written' }; },
    touchHealth: async (clientId, patch) => { calls.health.push({ clientId, ...patch }); },
    ...over,
  };
  return { deps, calls };
}

const run = (deps: LifecycleDeps) =>
  processCalendarMeeting({ meeting, noteBuilder: () => 'note body', deps });

describe('evaluateCalendarGate', () => {
  it('allows a video booking on the selected calendar', () => {
    const d = evaluateCalendarGate({ config, appointments: [appt()] });
    expect(d.allowed).toBe(true);
  });

  it('rejects bookings on a different calendar', () => {
    const d = evaluateCalendarGate({ config, appointments: [appt({ calendarId: 'cal-other' })] });
    expect(d).toMatchObject({ allowed: false, reason: 'calendar_not_selected' });
  });

  it('rejects bookings from another client location', () => {
    const d = evaluateCalendarGate({ config, appointments: [appt({ locationId: 'loc-other' })] });
    expect(d).toMatchObject({ allowed: false, reason: 'cross_client_location' });
  });

  it('refuses to guess between ambiguous bookings', () => {
    const d = evaluateCalendarGate({ config, appointments: [appt(), appt({ eventId: 'evt-2' })] });
    expect(d).toMatchObject({ allowed: false, reason: 'ambiguous_appointment' });
  });

  it('rejects unconfigured, disabled, unmapped and non-video cases', () => {
    expect(evaluateCalendarGate({ config: null, appointments: [] })).toMatchObject({ reason: 'not_configured' });
    expect(evaluateCalendarGate({ config: { ...config, enabled: false }, appointments: [appt()] })).toMatchObject({ reason: 'integration_disabled' });
    expect(evaluateCalendarGate({ config: { ...config, mappingValid: false }, appointments: [appt()] })).toMatchObject({ reason: 'mapping_invalid' });
    expect(evaluateCalendarGate({ config: { ...config, ghlCalendarId: null }, appointments: [appt()] })).toMatchObject({ reason: 'no_calendar_selected' });
    expect(evaluateCalendarGate({ config, appointments: [appt({ isVideo: false })] })).toMatchObject({ reason: 'not_video_meeting' });
    expect(evaluateCalendarGate({ config: { ...config, botJoinPolicy: 'never' }, appointments: [appt()] })).toMatchObject({ reason: 'bot_join_disabled' });
    expect(evaluateCalendarGate({ config, appointments: [] })).toMatchObject({ reason: 'appointment_not_found' });
  });
});

describe('processCalendarMeeting', () => {
  it('records a matched meeting and writes exactly one CRM note', async () => {
    const { deps, calls } = makeDeps();
    const res = await run(deps);
    expect(res).toMatchObject({ ok: true, matched: true, crmSyncStatus: 'written', clientId: 'client-1' });
    expect(calls.notes).toHaveLength(1);
    expect(calls.activities[0]).toMatchObject({ client_id: 'client-1', status: 'completed', ghl_calendar_id: 'cal-selected' });
  });

  it('persists lifecycle activity for an unmatched lead without a CRM write', async () => {
    const { deps, calls } = makeDeps({ matchLead: async () => null });
    const res = await run(deps);
    expect(res.matched).toBe(false);
    expect(calls.activities[0].status).toBe('unmatched');
    expect(calls.notes).toHaveLength(0);
    expect(calls.patches.at(-1).crm_sync_status).toBe('skipped');
  });

  it('rejects a wrong-calendar booking and stores the rejection', async () => {
    const { deps, calls } = makeDeps({ findAppointments: async () => [appt({ calendarId: 'cal-other' })] });
    const res = await run(deps);
    expect(res).toMatchObject({ ok: false, status: 403, rejected: 'calendar_not_selected' });
    expect(calls.activities[0].status).toBe('rejected');
    expect(calls.notes).toHaveLength(0);
  });

  it('rejects a cross-client booking', async () => {
    const { deps } = makeDeps({ findAppointments: async () => [appt({ locationId: 'loc-other' })] });
    expect(await run(deps)).toMatchObject({ ok: false, rejected: 'cross_client_location' });
  });

  it('is idempotent once the CRM note is written', async () => {
    const { deps, calls } = makeDeps({
      findActivity: async () => ({ id: 'act-1', status: 'completed', crm_sync_status: 'written', crm_attempts: 1 }),
    });
    const res = await run(deps);
    expect(res.duplicate).toBe(true);
    expect(calls.notes).toHaveLength(0);
    expect(calls.activities).toHaveLength(0);
  });

  it('marks the CRM sync for retry on a transient failure', async () => {
    const { deps, calls } = makeDeps({ writeGhlNote: async () => ({ status: 'error', error: 'GHL 500' }) });
    const res = await run(deps);
    expect(res.crmSyncStatus).toBe('retrying');
    expect(calls.patches.at(-1)).toMatchObject({ crm_sync_status: 'retrying', crm_attempts: 1 });
  });

  it('stops retrying after the attempt budget is exhausted', () => {
    expect(nextCrmState({ status: 'error', attempts: 0 })).toMatchObject({ crm_sync_status: 'retrying', retryable: true });
    expect(nextCrmState({ status: 'error', attempts: 2 })).toMatchObject({ crm_sync_status: 'error', retryable: false });
    expect(nextCrmState({ status: 'written', attempts: 0 }).crm_sync_status).toBe('written');
  });

  it('builds stable idempotency keys per stage', () => {
    const key = buildActivityKey({ clientId: 'c1', stage: 'completed', meetgeekEventId: 'evt_1' });
    expect(key).toBe('c1:completed:evt_1');
    expect(buildActivityKey({ clientId: 'c1', stage: 'rejected', ghlEventId: 'g1' })).toBe('c1:rejected:g1');
  });
});

describe('ingest modes and quality rubric', () => {
  it('allows any calendar inside the mapped location in all_mapped_calendars mode', () => {
    const cfg: MeetgeekClientConfig = { ...config, mode: 'all_mapped_calendars' };
    expect(evaluateCalendarGate({ config: cfg, appointments: [appt({ calendarId: 'cal-other' })] }))
      .toMatchObject({ allowed: true });
  });

  it('still rejects cross-location bookings in all_mapped_calendars mode', () => {
    const cfg: MeetgeekClientConfig = { ...config, mode: 'all_mapped_calendars' };
    expect(evaluateCalendarGate({ config: cfg, appointments: [appt({ locationId: 'loc-other' })] }))
      .toMatchObject({ allowed: false, reason: 'cross_client_location' });
  });

  it('does not require a selected calendar in all_mapped_calendars mode', () => {
    const cfg: MeetgeekClientConfig = { ...config, mode: 'all_mapped_calendars', ghlCalendarId: null };
    expect(evaluateCalendarGate({ config: cfg, appointments: [appt({ calendarId: 'cal-x' })] }))
      .toMatchObject({ allowed: true });
  });

  it('stores a deterministic quality rating on the activity row', async () => {
    const { deps, calls } = makeDeps();
    const res = await run(deps);
    expect(res.qualityRating).toBeGreaterThanOrEqual(1);
    expect(calls.activities[0].quality_rating).toBe(res.qualityRating);
    expect(Array.isArray(calls.activities[0].quality_rubric)).toBe(true);
  });

  it('rates a matched, artifact-rich meeting higher than a bare unmatched one', () => {
    const rich = scoreMeetingQuality({
      meeting: { ...meeting, durationMinutes: 32, summary: 'x'.repeat(700), actionItems: ['a', 'b', 'c'], recordingUrl: 'https://r', transcriptUrl: 'https://t' },
      matched: true,
    });
    const bare = scoreMeetingQuality({
      meeting: { ...meeting, durationMinutes: 1, summary: null, actionItems: [], recordingUrl: null, transcriptUrl: null, sourceUrl: null },
      matched: false,
    });
    expect(rich.rating).toBeGreaterThan(bare.rating);
    expect(bare.rating).toBeGreaterThanOrEqual(1);
    expect(rich.rating).toBeLessThanOrEqual(10);
  });
});
