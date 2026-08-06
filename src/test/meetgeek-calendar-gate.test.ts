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
import {
  scoreMeetingQuality,
  MEETGEEK_KPI_WEIGHTS,
  type MeetgeekMeetingInsights,
} from '../../supabase/functions/_shared/meetgeekQuality';

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

describe('ingest modes', () => {
  const cfg: MeetgeekClientConfig = { ...config, mode: 'all_mapped_calendars' };

  it('allows any calendar inside the mapped location in all_mapped_calendars mode', () => {
    expect(evaluateCalendarGate({ config: cfg, appointments: [appt({ calendarId: 'cal-other' })] }))
      .toMatchObject({ allowed: true });
  });

  it('still rejects cross-location bookings in all_mapped_calendars mode', () => {
    expect(evaluateCalendarGate({ config: cfg, appointments: [appt({ locationId: 'loc-other' })] }))
      .toMatchObject({ allowed: false, reason: 'cross_client_location' });
  });

  it('rejects an appointment with a MISSING location in all_mapped_calendars mode', () => {
    expect(evaluateCalendarGate({ config: cfg, appointments: [appt({ locationId: null })] }))
      .toMatchObject({ allowed: false, reason: 'appointment_location_missing' });
  });

  it('rejects an unknown calendar in selected_calendar mode with an explicit code', () => {
    expect(evaluateCalendarGate({ config, appointments: [appt({ calendarId: null })] }))
      .toMatchObject({ allowed: false, reason: 'unknown_calendar' });
  });

  it('does not require a selected calendar in all_mapped_calendars mode', () => {
    expect(evaluateCalendarGate({ config: { ...cfg, ghlCalendarId: null }, appointments: [appt({ calendarId: 'cal-x' })] }))
      .toMatchObject({ allowed: true });
  });
});

const insights = (kpis: Record<string, number | null>, extra: Partial<MeetgeekMeetingInsights> = {}): MeetgeekMeetingInsights => ({
  kpis: kpis as any,
  actionItemsTotal: 4,
  actionItemsWithOwner: 3,
  ...extra,
});

const allEight = {
  engagement: 4,
  productivity: 3,
  agenda_follow_through: 5,
  clear_project_scope: 2,
  risk_awareness: 1,
  task_ownership: 4,
  milestones_identified: 3,
  speaker_distribution: 5,
};

describe('quality rubric (provider insights only)', () => {
  it('weights all eight KPIs exactly', () => {
    const q = scoreMeetingQuality({ insights: insights(allEight) });
    const expected = Object.entries(allEight)
      .reduce((s, [k, v]) => s + (MEETGEEK_KPI_WEIGHTS as any)[k] * ((v / 5) * 10), 0);
    expect(q.rating).toBe(Math.round(expected * 10) / 10);
    expect(q.availableWeight).toBe(1);
    expect(q.rubric).toHaveLength(8);
    expect(q.rubric!.every((r) => typeof r.weight === 'number' && r.value !== null)).toBe(true);
  });

  it('keeps an all-zero meeting at exactly 0 and never forces a 1', () => {
    const zeros = Object.fromEntries(Object.keys(allEight).map((k) => [k, 0]));
    const q = scoreMeetingQuality({ insights: insights(zeros) });
    expect(q.rating).toBe(0);
    expect(q.rubric!.every((r) => r.score === 0)).toBe(true);
  });

  it('returns null when no insights are present', () => {
    const q = scoreMeetingQuality({ insights: null });
    expect(q.rating).toBeNull();
    expect(q.rubric).toBeNull();
    expect(q.summary).toBe('insufficient source data');
  });

  it('refuses to score when more than 30% of weight is missing', () => {
    // engagement (20%) + task_ownership (20%) + productivity (15%) = 55% available.
    const q = scoreMeetingQuality({
      insights: insights({ engagement: 4, task_ownership: 4, productivity: 4 }),
    });
    expect(q.missingWeight).toBeGreaterThan(0.3);
    expect(q.rating).toBeNull();
    expect(q.summary).toBe('insufficient source data');
  });

  it('scores from partial data when missing weight is within 30%', () => {
    const partial = { ...allEight } as Record<string, number | null>;
    delete partial.risk_awareness;      // 5%
    delete partial.speaker_distribution; // 5%
    delete partial.milestones_identified; // 10%
    const q = scoreMeetingQuality({ insights: insights(partial) });
    expect(q.missingWeight).toBeCloseTo(0.2, 5);
    expect(q.rating).not.toBeNull();
  });

  it('summary reports the two lowest categories and action-owner coverage', () => {
    const q = scoreMeetingQuality({ insights: insights(allEight) });
    expect(q.summary).toContain('Risk awareness');
    expect(q.summary).toContain('Clear project scope');
    expect(q.summary).toContain('3/4 action items have an owner');
    expect(q.summary).toContain('speaker distribution');
  });

  it('never infers quality from duration, summary length, artifacts or lead matching', async () => {
    const { deps, calls } = makeDeps();
    const res = await run(deps);
    // Rich meeting, matched lead, but no provider insights => no score at all.
    expect(res.qualityRating).toBeNull();
    expect(calls.activities[0].quality_rating).toBeNull();
    expect(calls.activities[0].quality_summary).toBe('insufficient source data');
  });

  it('scores only after the calendar-validated provider enrichment runs', async () => {
    const order: string[] = [];
    const { deps, calls } = makeDeps({
      findAppointments: async () => { order.push('gate'); return [appt()]; },
      enrichMeeting: async (_c, m) => {
        order.push('enrich');
        return { ...m, insights: insights(allEight) };
      },
    });
    const res = await run(deps);
    expect(order).toEqual(['gate', 'enrich']);
    expect(res.qualityRating).toBeGreaterThan(0);
    expect(calls.activities[0].quality_rating).toBe(res.qualityRating);
    expect(Array.isArray(calls.activities[0].quality_rubric)).toBe(true);
  });

  it('does not enrich or score a gate-rejected meeting', async () => {
    let enriched = false;
    const { deps } = makeDeps({
      findAppointments: async () => [appt({ calendarId: 'cal-other' })],
      enrichMeeting: async (_c, m) => { enriched = true; return m; },
    });
    const res = await run(deps);
    expect(res.ok).toBe(false);
    expect(enriched).toBe(false);
  });
});
