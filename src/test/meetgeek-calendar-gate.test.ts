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
  scoreCapitalRaisingQA,
  QA_CATEGORY_MAX,
  QA_PASS_THRESHOLD,
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
  engagement: 5,
  productivity: 3,
  agenda_follow_through: 5,
  clear_project_scope: 2,
  risk_awareness: 1,
  task_ownership: 4,
  milestones_identified: 3,
  speaker_distribution: 5,
};

const pad = (n: number) => 'Rep: understood, noted for the record. '.repeat(n);

const CLEAN_TRANSCRIPT = [
  'Rep: thanks for making time. What are you looking to accomplish with this allocation?',
  'Prospect: I have capital available and I want exposure to a real estate fund.',
  'Rep: what is your time horizon, and how much would you allocate?',
  'Prospect: maybe a 500k check size over five years.',
  'Rep: tell me about your portfolio mix today?',
  'Prospect: mostly public equity.',
  'Rep: the offering is a private placement with a preferred return; targeted returns are projected, not guaranteed, and there is risk of loss.',
  'Rep: on liquidity, the hold period is five to seven years and distributions begin in year two.',
  'Prospect: I am a little concerned about the lock-up.',
  'Rep: that is fair. Here is how we handle it. Does that address your concern?',
  'Prospect: yes, that clarifies it.',
  'Rep: we will schedule the next call for Tuesday at 2pm and send over the PPM.',
  pad(6),
].join('\n');

const ACTION_ITEMS = ['Jane: send the PPM by Friday', 'Rep: book follow-up call on 2026-02-10'];

const OBJECTION_FREE_TRANSCRIPT = CLEAN_TRANSCRIPT
  .replace('Prospect: I am a little concerned about the lock-up.', 'Prospect: the lock-up makes sense to me.')
  .replace('Rep: that is fair. Here is how we handle it. Does that address your concern?', 'Rep: appreciate that.');

describe('HNWI capital-raising operational QA scorecard', () => {
  it('sums to a fixed 100-point scale', () => {
    expect(Object.values(QA_CATEGORY_MAX).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('passes a clean, fully evidenced capital-raising call', () => {
    const qa = scoreCapitalRaisingQA({
      transcript: CLEAN_TRANSCRIPT,
      summary: 'Discovery call on the fund offering; PPM to follow.',
      actionItems: ACTION_ITEMS,
      analytics: insights(allEight, { repTalkRatio: 0.55 }),
      crm: { leadMatched: true, ghlContactId: 'ghl-1', noteWritten: true },
    });
    expect(qa.gateStatus).toBe('pass');
    expect(qa.total).toBeGreaterThanOrEqual(QA_PASS_THRESHOLD);
    expect(qa.redFlags).toHaveLength(0);
    expect(qa.nextStep).toMatchObject({ committed: true });
    expect(qa.evidenceTags).toContain('transcript');
    expect(qa.pipelineOutcome).toBe('advanced_next_step_committed');
    expect(qa.actionOwners[0]).toMatchObject({ owner: 'Jane', deadline: 'Friday' });
  });

  it('hard-fails an explicit guarantee and zeroes the total', () => {
    const qa = scoreCapitalRaisingQA({
      transcript: CLEAN_TRANSCRIPT.replace('targeted returns are projected, not guaranteed', 'returns are guaranteed and risk-free'),
      summary: 'Call summary',
      actionItems: ACTION_ITEMS,
      analytics: insights(allEight),
    });
    expect(qa.gateStatus).toBe('fail');
    expect(qa.total).toBe(0);
    expect(qa.redFlags.some((f) => f.code === 'promissory_guarantee' && f.hardFail)).toBe(true);
    expect(qa.categories.find((c) => c.key === 'non_promissory')!.points).toBe(0);
    expect(qa.pipelineOutcome).toBe('blocked_hard_fail');
  });

  it('hard-fails an accreditation/suitability verification claim', () => {
    const qa = scoreCapitalRaisingQA({
      transcript: `${CLEAN_TRANSCRIPT}\nRep: good news, we have verified your accreditation already.`,
      summary: 'Call summary',
      actionItems: ACTION_ITEMS,
      analytics: insights(allEight),
    });
    expect(qa.gateStatus).toBe('fail');
    expect(qa.redFlags.some((f) => f.code === 'accreditation_or_suitability_claim')).toBe(true);
  });

  it('hard-fails a call with no committed next step', () => {
    const qa = scoreCapitalRaisingQA({
      transcript: CLEAN_TRANSCRIPT.replace('Rep: we will schedule the next call for Tuesday at 2pm and send over the PPM.', 'Rep: alright, talk sometime.'),
      summary: 'Call summary',
      actionItems: ['Nothing agreed'],
      analytics: insights(allEight),
    });
    expect(qa.gateStatus).toBe('fail');
    expect(qa.redFlags.some((f) => f.code === 'no_committed_next_step')).toBe(true);
  });

  it('hard-fails zero discovery', () => {
    const qa = scoreCapitalRaisingQA({
      transcript: `Rep: this offering is a private placement with a preferred return. We will schedule Tuesday at 2pm. ${pad(20)}`,
      summary: 'Monologue pitch',
      actionItems: ACTION_ITEMS,
      analytics: insights(allEight),
    });
    expect(qa.gateStatus).toBe('fail');
    expect(qa.redFlags.some((f) => f.code === 'zero_discovery')).toBe(true);
  });

  it('sends unresolved risk to manual review without a hard fail', () => {
    const qa = scoreCapitalRaisingQA({
      transcript: OBJECTION_FREE_TRANSCRIPT
        .replace('Rep: on liquidity, the hold period is five to seven years and distributions begin in year two.', 'Rep: anyway, moving on.'),
      summary: 'Call summary',
      actionItems: ACTION_ITEMS,
      analytics: insights(allEight),
    });
    expect(qa.gateStatus).toBe('manual_review');
    expect(qa.redFlags.some((f) => f.code === 'unresolved_risk')).toBe(true);
    expect(qa.redFlags.every((f) => !f.hardFail)).toBe(true);
  });

  it('flags rep-dominated talk time for manual review', () => {
    const qa = scoreCapitalRaisingQA({
      transcript: CLEAN_TRANSCRIPT,
      summary: 'Call summary',
      actionItems: ACTION_ITEMS,
      analytics: insights(allEight, { repTalkRatio: 0.86 }),
      crm: { noteWritten: true },
    });
    expect(qa.gateStatus).toBe('manual_review');
    expect(qa.redFlags.some((f) => f.code === 'rep_dominated_talk_time')).toBe(true);
  });

  it('scores 0 with insufficient_evidence when no artifacts exist and never infers', () => {
    const qa = scoreCapitalRaisingQA({ transcript: null, summary: null, actionItems: [], analytics: null });
    expect(qa.total).toBe(0);
    expect(qa.gateStatus).toBe('manual_review');
    expect(qa.evidenceTags).toContain('insufficient_evidence');
    expect(qa.redFlags.some((f) => f.code === 'missing_material_transcript')).toBe(true);
    expect(qa.categories.every((c) => c.points === 0)).toBe(true);
    expect(qa.categories.filter((c) => c.insufficientEvidence).length).toBeGreaterThanOrEqual(6);
  });

  it('is deterministic for identical inputs', () => {
    const args = { transcript: CLEAN_TRANSCRIPT, summary: 'Call summary', actionItems: ACTION_ITEMS, analytics: insights(allEight) };
    expect(JSON.stringify(scoreCapitalRaisingQA(args))).toBe(JSON.stringify(scoreCapitalRaisingQA(args)));
  });

  it('reweights objection handling to N/A when no objection was raised', () => {
    const qa = scoreCapitalRaisingQA({
      transcript: OBJECTION_FREE_TRANSCRIPT,
      summary: 'Call summary',
      actionItems: ACTION_ITEMS,
      analytics: insights(allEight),
      crm: { noteWritten: true },
    });
    const objection = qa.categories.find((c) => c.key === 'objection_handling')!;
    expect(objection.na).toBe(true);
    expect(qa.naRedistribution).toMatchObject({ naKeys: ['objection_handling'], removedMax: 10, scoredMax: 90 });
    expect(qa.total).toBeGreaterThanOrEqual(QA_PASS_THRESHOLD);
  });

  it('never scores from duration, recording presence or CRM matching', async () => {
    const { deps, calls } = makeDeps();
    const res = await run(deps);
    // Rich meeting, matched lead, but no transcript/analytics => transcript-derived
    // categories earn nothing and the row cannot pass.
    expect(res.qaTotal).toBeLessThan(QA_PASS_THRESHOLD);
    expect(calls.activities[0].qa_total).toBe(res.qaTotal);
    const byKey = Object.fromEntries((calls.activities[0].qa_scores as any[]).map((c) => [c.key, c]));
    for (const key of ['discovery', 'next_step', 'engagement', 'objection_handling']) {
      expect(byKey[key].points).toBe(0);
      expect(byKey[key].insufficientEvidence || byKey[key].na).toBe(true);
    }
    expect(calls.activities[0].qa_gate_status).toBe('manual_review');
    expect(calls.activities[0].qa_evidence_tags).toContain('insufficient_evidence');
  });

  it('scores only after the calendar-validated provider enrichment runs', async () => {
    const order: string[] = [];
    const { deps, calls } = makeDeps({
      findAppointments: async () => { order.push('gate'); return [appt()]; },
      enrichMeeting: async (_c, m) => {
        order.push('enrich');
        return { ...m, insights: insights(allEight), transcriptText: CLEAN_TRANSCRIPT, actionItems: ACTION_ITEMS };
      },
    });
    const res = await run(deps);
    expect(order).toEqual(['gate', 'enrich']);
    expect(res.qaTotal).toBeGreaterThan(0);
    expect(res.qaGateStatus).toBe('pass');
    expect(calls.activities[0].qa_total).toBe(res.qaTotal);
    expect(Array.isArray(calls.activities[0].qa_scores)).toBe(true);
    expect(calls.activities[0].qa_scores).toHaveLength(8);
    expect(calls.activities[0].qa_meetgeek_summary).toBeTruthy();
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
