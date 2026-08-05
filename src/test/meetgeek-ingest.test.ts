import { describe, it, expect } from 'vitest';
import {
  buildMeetingNote,
  computeDedupeKey,
  ingestMeetgeekWebhook,
  matchLeadByEmail,
  normalizeEmail,
  normalizeMeetgeekPayload,
  verifyMeetgeekSignature,
  type IngestDeps,
} from '../../supabase/functions/_shared/meetgeekIngest';

const SECRET = 'test-secret';

async function sign(body: string, secret = SECRET) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const payload = {
  event_id: 'evt_1',
  status: 'analyzed',
  meeting: {
    meeting_id: 'mtg_1',
    title: 'Discovery Call - Acme',
    timestamp_start_utc: '2026-02-01T17:00:00Z',
    timestamp_end_utc: '2026-02-01T17:32:00Z',
    host_email: 'Rep@Agency.com',
  },
  participants: [
    { name: 'Rep', email: 'Rep@Agency.com' },
    { name: 'Jane Investor', email: 'JANE@acme.com' },
    { name: 'Jane Investor', email: 'jane@acme.com' },
  ],
  summary: 'Investor is interested in the fund.',
  action_items: ['Send deck', { text: 'Send deck' }, 'Schedule follow up'],
};

function makeDeps(overrides: Partial<IngestDeps> = {}) {
  const calls: any = { events: [], updates: [], contexts: [], notes: [], meetings: [] };
  const deps: IngestDeps = {
    findProcessedEvent: async () => null,
    recordEvent: async (i) => { calls.events.push(i); return { id: 'evt-row-1' }; },
    updateEvent: async (id, patch) => { calls.updates.push({ id, ...patch }); },
    resolveClientId: async () => 'client-1',
    upsertMeetingRecord: async (m, c) => { calls.meetings.push({ m, c }); return { id: 'rec-1' }; },
    findLeadsByEmails: async () => [{ id: 'lead-1', client_id: 'client-1', email: 'jane@acme.com', external_id: 'ghl-1' }],
    upsertLeadContext: async (i) => { calls.contexts.push(i); },
    writeGhlNote: async (i) => { calls.notes.push(i); return { status: 'written', contactId: 'ghl-1' }; },
    ...overrides,
  };
  return { deps, calls };
}

describe('normalizeMeetgeekPayload', () => {
  it('normalizes ids, timing, participants and dedupes action items', () => {
    const m = normalizeMeetgeekPayload(payload)!;
    expect(m.meetingExternalId).toBe('mtg_1');
    expect(m.durationMinutes).toBe(32);
    expect(m.isCompleted).toBe(true);
    expect(m.hostEmail).toBe('rep@agency.com');
    expect(m.participants.map((p) => p.email)).toEqual(['rep@agency.com', 'jane@acme.com']);
    expect(m.actionItems).toEqual(['Send deck', 'Schedule follow up']);
  });

  it('returns null without a meeting id', () => {
    expect(normalizeMeetgeekPayload({ status: 'analyzed' })).toBeNull();
  });

  it('flags in-progress meetings as not completed', () => {
    const m = normalizeMeetgeekPayload({ meeting_id: 'x', status: 'recording' })!;
    expect(m.isCompleted).toBe(false);
  });
});

describe('signature verification', () => {
  it('accepts a valid hex signature over the raw body', async () => {
    const raw = JSON.stringify(payload);
    expect(await verifyMeetgeekSignature(raw, await sign(raw), SECRET)).toBe(true);
    expect(await verifyMeetgeekSignature(raw, `sha256=${await sign(raw)}`, SECRET)).toBe(true);
  });

  it('rejects tampered bodies, wrong secrets and missing headers', async () => {
    const raw = JSON.stringify(payload);
    const sig = await sign(raw);
    expect(await verifyMeetgeekSignature(raw + ' ', sig, SECRET)).toBe(false);
    expect(await verifyMeetgeekSignature(raw, sig, 'other')).toBe(false);
    expect(await verifyMeetgeekSignature(raw, null, SECRET)).toBe(false);
    expect(await verifyMeetgeekSignature(raw, sig, '')).toBe(false);
  });
});

describe('lead matching', () => {
  it('matches case-insensitively on email', () => {
    const m = normalizeMeetgeekPayload(payload)!;
    const match = matchLeadByEmail(m.participants, [
      { id: 'l1', client_id: 'c', email: 'Jane@Acme.com' },
    ]);
    expect(match.lead?.id).toBe('l1');
    expect(match.matchMethod).toBe('email_exact');
    expect(match.confidence).toBe(1);
  });

  it('reports no match when nothing lines up', () => {
    const m = normalizeMeetgeekPayload(payload)!;
    const match = matchLeadByEmail(m.participants, []);
    expect(match.lead).toBeNull();
    expect(match.matchMethod).toBe('none');
  });

  it('normalizes emails safely', () => {
    expect(normalizeEmail('  A@B.com ')).toBe('a@b.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe('ingestMeetgeekWebhook', () => {
  it('rejects unsigned requests before any write', async () => {
    const { deps, calls } = makeDeps();
    const raw = JSON.stringify(payload);
    const res = await ingestMeetgeekWebhook({ rawBody: raw, signatureHeader: null, secret: SECRET, deps });
    expect(res.status).toBe(401);
    expect(calls.events).toHaveLength(0);
  });

  it('fails closed when no secret is configured', async () => {
    const { deps } = makeDeps();
    const raw = JSON.stringify(payload);
    const res = await ingestMeetgeekWebhook({ rawBody: raw, signatureHeader: await sign(raw), secret: '', deps });
    expect(res.status).toBe(500);
    expect(res.reason).toBe('webhook_secret_not_configured');
  });

  it('processes a signed meeting, matches the lead and writes one CRM note', async () => {
    const { deps, calls } = makeDeps();
    const raw = JSON.stringify(payload);
    const res = await ingestMeetgeekWebhook({ rawBody: raw, signatureHeader: await sign(raw), secret: SECRET, deps });
    expect(res.ok).toBe(true);
    expect(res.matched).toBe(true);
    expect(res.ghlNoteStatus).toBe('written');
    expect(calls.notes).toHaveLength(1);
    expect(calls.contexts[0].leadId).toBe('lead-1');
    expect(calls.updates.at(-1).status).toBe('processed');
  });

  it('is idempotent for a replayed event', async () => {
    const { deps, calls } = makeDeps({ findProcessedEvent: async () => ({ id: 'x', status: 'processed' }) });
    const raw = JSON.stringify(payload);
    const res = await ingestMeetgeekWebhook({ rawBody: raw, signatureHeader: await sign(raw), secret: SECRET, deps });
    expect(res.duplicate).toBe(true);
    expect(calls.notes).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
  });

  it('stores context without a CRM note when no lead matches', async () => {
    const { deps, calls } = makeDeps({ findLeadsByEmails: async () => [] });
    const raw = JSON.stringify(payload);
    const res = await ingestMeetgeekWebhook({ rawBody: raw, signatureHeader: await sign(raw), secret: SECRET, deps });
    expect(res.matched).toBe(false);
    expect(calls.notes).toHaveLength(0);
    expect(calls.contexts[0].ghlNoteStatus).toBe('skipped');
  });

  it('ignores meetings that have not completed', async () => {
    const raw = JSON.stringify({ meeting_id: 'm2', status: 'recording' });
    const { deps, calls } = makeDeps();
    const res = await ingestMeetgeekWebhook({ rawBody: raw, signatureHeader: await sign(raw), secret: SECRET, deps });
    expect(res.status).toBe(202);
    expect(calls.meetings).toHaveLength(0);
    expect(calls.updates[0].status).toBe('ignored');
  });

  it('marks the event failed when persistence throws', async () => {
    const { deps, calls } = makeDeps({ upsertMeetingRecord: async () => { throw new Error('db down'); } });
    const raw = JSON.stringify(payload);
    const res = await ingestMeetgeekWebhook({ rawBody: raw, signatureHeader: await sign(raw), secret: SECRET, deps });
    expect(res.ok).toBe(false);
    expect(calls.updates.at(-1).status).toBe('failed');
  });

  it('builds a stable dedupe key and a readable note', () => {
    const m = normalizeMeetgeekPayload(payload)!;
    expect(computeDedupeKey(m)).toBe('event:evt_1');
    expect(computeDedupeKey({ ...m, eventId: null })).toBe('meeting:mtg_1:analyzed');
    const note = buildMeetingNote(m);
    expect(note).toContain('Discovery Call - Acme');
    expect(note).toContain('- Send deck');
  });
});