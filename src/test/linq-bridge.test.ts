import { describe, it, expect } from 'vitest';
import {
  CONTACT_SEARCH_PAGE_LIMIT,
  HPA_GHL_LOCATION_ID,
  LINQ_ORG_ID,
  LINQ_WEBHOOK_VERSION,
  OWNED_LINES,
  SIGNATURE_TOLERANCE_SECONDS,
  buildContactSearchBody,
  buildEventFromResources,
  buildInternalComment,
  classifyContactMatch,
  commentMarker,
  contactLocationStatus,
  deliveryKey,
  findMarkedMessageId,
  isOwnedLine,
  normalizeHandle,
  parseLinqEvent,
  participantWasMemberAt,
  selectExternalParticipants,
  toE164,
  verifyLinqSignature,
} from '../../supabase/functions/_shared/linqBridge';
import {
  deliverToParticipants,
  reconstructEvent,
  runPipeline,
  type DeliveryClaim,
  type LinqDeps,
} from '../../supabase/functions/_shared/linqDelivery';

const SECRET = 'whsec_' + btoa('linq-test-signing-key-0123456789');

async function sign(rawBody: string, id: string, ts: string, secret = SECRET) {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const bin = atob(raw);
  const keyBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)));
  let out = '';
  for (const b of digest) out += String.fromCharCode(b);
  return `v1,${btoa(out)}`;
}

function groupEnvelope(overrides: Record<string, any> = {}) {
  return {
    api_version: 'v3',
    webhook_version: LINQ_WEBHOOK_VERSION,
    event_type: 'message.received',
    event_id: 'evt-1',
    created_at: '2026-02-05T19:31:13.736Z',
    data: {
      id: 'msg-1',
      direction: 'inbound',
      sender_handle: { handle: '+12025559876', is_me: false },
      sent_at: '2026-02-05T19:31:13.074Z',
      parts: [
        { type: 'text', value: 'Are we still on for Tuesday?' },
        { type: 'image', url: 'https://cdn.linqapp.com/a/1.jpg' },
      ],
      chat: {
        id: 'chat-1',
        is_group: true,
        owner_handle: { handle: OWNED_LINES[0], is_me: true },
        handles: [
          { handle: OWNED_LINES[0], is_me: true },
          { handle: '+12025559876', is_me: false },
          { handle: '(415) 555-0142', is_me: false },
        ],
      },
      ...(overrides.data || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'data')),
  };
}

describe('scope constants are locked to the verified target', () => {
  it('targets only HPA location, Linq org 22365 and the two owned lines', () => {
    expect(HPA_GHL_LOCATION_ID).toBe('ZcPPQTHBxBWlnM1WyjvU');
    expect(LINQ_ORG_ID).toBe('22365');
    expect(OWNED_LINES).toEqual(['+14154980385', '+14156040157']);
    expect(LINQ_WEBHOOK_VERSION).toBe('2026-02-03');
    expect(SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });
});

describe('signature verification', () => {
  const body = JSON.stringify(groupEnvelope());
  const ts = '1770000000';
  const now = Number(ts) * 1000;

  it('accepts a correctly signed Standard Webhooks request', async () => {
    const signatureHeader = await sign(body, 'wh-1', ts);
    const res = await verifyLinqSignature({ secret: SECRET, webhookId: 'wh-1', timestamp: ts, signatureHeader, rawBody: body, nowMs: now });
    expect(res.ok).toBe(true);
  });

  it('accepts when multiple v1 signatures are presented (key rotation)', async () => {
    const good = await sign(body, 'wh-1', ts);
    const res = await verifyLinqSignature({ secret: SECRET, webhookId: 'wh-1', timestamp: ts, signatureHeader: `v1,AAAA ${good}`, rawBody: body, nowMs: now });
    expect(res.ok).toBe(true);
  });

  it('rejects a tampered body, wrong id, wrong secret and bad header', async () => {
    const signatureHeader = await sign(body, 'wh-1', ts);
    const cases = [
      { rawBody: body.replace('Tuesday', 'Friday'), webhookId: 'wh-1', secret: SECRET },
      { rawBody: body, webhookId: 'wh-2', secret: SECRET },
      { rawBody: body, webhookId: 'wh-1', secret: 'whsec_' + btoa('another-key-value-0000000000000') },
    ];
    for (const c of cases) {
      const res = await verifyLinqSignature({ ...c, timestamp: ts, signatureHeader, nowMs: now });
      expect(res).toEqual({ ok: false, code: 'signature_mismatch' });
    }
    expect(await verifyLinqSignature({ secret: SECRET, webhookId: 'wh-1', timestamp: ts, signatureHeader: 'garbage', rawBody: body, nowMs: now }))
      .toEqual({ ok: false, code: 'headers_missing' });
  });

  it('fails closed with no secret and rejects replays outside the 5 minute window', async () => {
    const signatureHeader = await sign(body, 'wh-1', ts);
    expect(await verifyLinqSignature({ secret: '', webhookId: 'wh-1', timestamp: ts, signatureHeader, rawBody: body, nowMs: now }))
      .toEqual({ ok: false, code: 'secret_missing' });
    expect(await verifyLinqSignature({ secret: SECRET, webhookId: 'wh-1', timestamp: ts, signatureHeader, rawBody: body, nowMs: now + 301_000 }))
      .toEqual({ ok: false, code: 'timestamp_out_of_tolerance' });
    expect(await verifyLinqSignature({ secret: SECRET, webhookId: 'wh-1', timestamp: 'not-a-number', signatureHeader, rawBody: body, nowMs: now }))
      .toEqual({ ok: false, code: 'timestamp_invalid' });
    expect(await verifyLinqSignature({ secret: SECRET, webhookId: '', timestamp: ts, signatureHeader, rawBody: body, nowMs: now }))
      .toEqual({ ok: false, code: 'headers_missing' });
  });
});

describe('parser and group filtering', () => {
  it('parses a group message with text and attachment references', () => {
    const parsed = parseLinqEvent(groupEnvelope());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event).toMatchObject({
      eventId: 'evt-1',
      chatId: 'chat-1',
      messageId: 'msg-1',
      direction: 'inbound',
      senderHandle: '+12025559876',
      text: 'Are we still on for Tuesday?',
    });
    expect(parsed.event.attachments).toEqual([{ type: 'image', reference: 'https://cdn.linqapp.com/a/1.jpg' }]);
    expect(parsed.event.participantHandles).toContain('+14155550142');
  });

  it('strictly skips 1:1 chats and chats with no group flag', () => {
    expect(parseLinqEvent(groupEnvelope({ data: { chat: { id: 'c', is_group: false } } })))
      .toEqual({ ok: false, code: 'not_group' });
    expect(parseLinqEvent(groupEnvelope({ data: { chat: { id: 'c' } } })))
      .toEqual({ ok: false, code: 'not_group' });
  });

  it('skips other events, other payload versions and malformed payloads', () => {
    expect(parseLinqEvent(groupEnvelope({ event_type: 'message.read' }))).toEqual({ ok: false, code: 'unsupported_event' });
    expect(parseLinqEvent(groupEnvelope({ webhook_version: '2025-01-01' }))).toEqual({ ok: false, code: 'unsupported_version' });
    expect(parseLinqEvent(groupEnvelope({ event_id: '' }))).toEqual({ ok: false, code: 'malformed_payload' });
    expect(parseLinqEvent(null)).toEqual({ ok: false, code: 'malformed_payload' });
    expect(parseLinqEvent(groupEnvelope({ event_type: 'message.sent', data: { direction: 'outbound' } })).ok).toBe(true);
  });
});

describe('strict E.164 normalization', () => {
  it('defaults plain 10-digit numbers to US and keeps country codes intact', () => {
    expect(toE164('4154980385')).toBe('+14154980385');
    expect(toE164('(415) 498-0385')).toBe('+14154980385');
    expect(toE164('+44 20 2555 9876')).toBe('+442025559876');
    expect(toE164('911')).toBeNull();
    expect(toE164('someone@example.com')).toBeNull();
    expect(normalizeHandle('4154980385')).toBe('+14154980385');
  });

  it('never conflates an international number that shares the last ten digits', () => {
    const us = '+12025559876';
    const uk = '+442025559876';
    expect(toE164(uk)).not.toBe(toE164(us));
    expect(classifyContactMatch([{ id: 'c1', phone: uk, locationId: HPA_GHL_LOCATION_ID }], us))
      .toEqual({ status: 'unmatched' });
    expect(classifyContactMatch([{ id: 'c1', phone: us, locationId: HPA_GHL_LOCATION_ID }], uk))
      .toEqual({ status: 'unmatched' });
    expect(isOwnedLine('+44415498 0385'.replace(/\s/g, ''))).toBe(false);
    expect(isOwnedLine('(415) 604-0157')).toBe(true);
  });
});

describe('participant membership at the original message time', () => {
  const at = '2026-02-05T19:31:13.074Z';

  it('excludes handles that joined after the message or had already left', () => {
    const handles = [
      { handle: OWNED_LINES[0], is_me: true, joined_at: '2026-01-01T00:00:00Z', status: 'active' },
      { handle: '+12025559876', is_me: false, joined_at: '2026-01-02T00:00:00Z', status: 'active' },
      { handle: '+14155550142', is_me: false, joined_at: '2026-03-01T00:00:00Z', status: 'active' },
      { handle: '+14155550143', is_me: false, joined_at: '2026-01-02T00:00:00Z', left_at: '2026-02-01T00:00:00Z', status: 'left' },
      { handle: '+14155550144', is_me: false, joined_at: '2026-01-02T00:00:00Z', status: 'removed' },
    ];
    expect(selectExternalParticipants(handles, at)).toEqual(['+12025559876']);
  });

  it('keeps a member who left only after the message and fails closed on unknown times', () => {
    expect(participantWasMemberAt({ handle: 'x', joined_at: '2026-01-01T00:00:00Z', left_at: '2026-03-01T00:00:00Z', status: 'left' }, at)).toBe(true);
    expect(participantWasMemberAt({ handle: 'x', status: 'removed' }, at)).toBe(false);
    expect(participantWasMemberAt({ handle: 'x', left_at: '2026-03-01T00:00:00Z' }, 'not-a-date')).toBe(false);
    expect(participantWasMemberAt({ handle: 'x', status: 'active' }, 'not-a-date')).toBe(true);
  });

  it('still drops our own lines and duplicates', () => {
    expect(selectExternalParticipants([
      { handle: OWNED_LINES[0], is_me: true },
      { handle: OWNED_LINES[1], is_me: false },
      { handle: '+1 (202) 555-9876', is_me: false },
      { handle: '2025559876', is_me: false },
      { handle: 'someone@example.com', is_me: false },
    ], at)).toEqual(['+12025559876']);
  });
});

describe('contact matching requires exactly one contact in the HPA location', () => {
  const loc = HPA_GHL_LOCATION_ID;
  it('matches one, refuses ambiguous, unmatched and foreign-location contacts', () => {
    expect(classifyContactMatch([{ id: 'c1', phone: '+1 202-555-9876', locationId: loc }], '+12025559876'))
      .toEqual({ status: 'matched', contactId: 'c1' });
    expect(classifyContactMatch([
      { id: 'c1', phone: '2025559876', locationId: loc },
      { id: 'c2', phone: '+12025559876', locationId: loc },
    ], '+12025559876')).toEqual({ status: 'ambiguous' });
    expect(classifyContactMatch([{ id: 'c1', phone: '+12025550000', locationId: loc }], '+12025559876'))
      .toEqual({ status: 'unmatched' });
    expect(classifyContactMatch([{ id: 'c1', phone: '+12025559876', locationId: 'someOtherLocation' }], '+12025559876'))
      .toEqual({ status: 'unmatched' });
    expect(classifyContactMatch([{ id: 'c1', phone: '+12025559876' }], '+12025559876'))
      .toEqual({ status: 'location_unverified', contactIds: ['c1'] });
    expect(contactLocationStatus({ locationId: loc }, loc)).toBe('match');
    expect(contactLocationStatus({}, loc)).toBe('unknown');
  });
});

describe('documented GHL search body', () => {
  it('uses a phone filter with eq plus bounded pagination', () => {
    expect(buildContactSearchBody({ handle: '+12025559876', locationId: HPA_GHL_LOCATION_ID, page: 2 })).toEqual({
      locationId: HPA_GHL_LOCATION_ID,
      page: 2,
      pageLimit: CONTACT_SEARCH_PAGE_LIMIT,
      filters: [{ field: 'phone', operator: 'eq', value: '+12025559876' }],
    });
  });
});

describe('internal comment body', () => {
  it('carries group, sender, participants, timestamp, direction, text, attachments and marker', () => {
    const parsed = parseLinqEvent(groupEnvelope());
    if (!parsed.ok) throw new Error('expected group message');
    const comment = buildInternalComment({ event: parsed.event, groupName: 'Series A investors', participants: ['+12025559876', '+14155550142'], contactId: 'c1' });
    expect(comment).toContain('Series A investors');
    expect(comment).toContain('chat chat-1');
    expect(comment).toContain('Inbound');
    expect(comment).toContain('+12025559876');
    expect(comment).toContain('2026-02-05T19:31:13.074Z');
    expect(comment).toContain('Are we still on for Tuesday?');
    expect(comment).toContain('https://cdn.linqapp.com/a/1.jpg');
    expect(comment).toContain('Linq message msg-1');
    expect(comment).toContain(commentMarker('msg-1', 'c1'));
  });

  it('finds its own marker when reading a thread back', () => {
    const marker = commentMarker('msg-1', 'c1');
    expect(findMarkedMessageId([{ id: 'm9', body: `note\n${marker}` }], marker)).toBe('m9');
    expect(findMarkedMessageId([{ id: 'm9', body: 'unrelated' }], marker)).toBeNull();
  });
});

describe('idempotency scope', () => {
  it('keys one comment per message per contact', () => {
    expect(deliveryKey('msg-1', 'c1')).toBe('msg-1::c1');
    expect(deliveryKey('msg-1', 'c2')).not.toBe(deliveryKey('msg-1', 'c1'));
  });
});

/* ------------------------------------------------- behavioural integration */

interface HarnessOptions {
  contacts?: any[];
  contactDetails?: Record<string, any>;
  threadMessages?: any[];
  postStatus?: number;
  searchStatus?: number;
  linqMessage?: any;
  linqChat?: any;
  recordFails?: boolean;
  threadUnavailable?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const searchBodies: any[] = [];
  const posts: any[] = [];
  const rows = new Map<string, any>();
  const updates: any[] = [];
  let nextId = 1;

  const fetchImpl = (async (url: any, init: any = {}) => {
    const target = String(url);
    const jsonRes = (body: any, status = 200) => new Response(JSON.stringify(body), { status });

    if (target.endsWith('/contacts/search')) {
      searchBodies.push(JSON.parse(String(init.body || '{}')));
      if (options.searchStatus && options.searchStatus >= 400) return jsonRes({}, options.searchStatus);
      return jsonRes({ contacts: options.contacts ?? [] });
    }
    if (/\/contacts\/[^/]+$/.test(target) && (init.method ?? 'GET') === 'GET') {
      const id = target.split('/').pop()!;
      const detail = options.contactDetails?.[id];
      if (!detail) return jsonRes({}, 404);
      return jsonRes({ contact: detail });
    }
    if (target.endsWith('/conversations/messages') && init.method === 'POST') {
      posts.push(JSON.parse(String(init.body || '{}')));
      if (options.postStatus && options.postStatus >= 400) return jsonRes({}, options.postStatus);
      return jsonRes({ conversationId: 'conv-1', messageId: `ghl-msg-${posts.length}` });
    }
    if (target.includes('/conversations/search')) {
      if (options.threadUnavailable) return jsonRes({}, 500);
      return jsonRes({ conversations: options.threadMessages ? [{ id: 'conv-1' }] : [] });
    }
    if (/\/conversations\/[^/]+\/messages/.test(target)) {
      return jsonRes({ messages: { messages: options.threadMessages ?? [] } });
    }
    if (target.includes('/api/partner/v3/messages/')) {
      if (!options.linqMessage) return jsonRes({}, 404);
      return jsonRes({ message: options.linqMessage });
    }
    if (target.includes('/api/partner/v3/chats/')) {
      if (!options.linqChat) return jsonRes({}, 404);
      return jsonRes({ chat: options.linqChat });
    }
    return jsonRes({}, 404);
  }) as unknown as typeof fetch;

  const deps: LinqDeps = {
    fetch: fetchImpl,
    ghlApiKey: 'test-key',
    linqToken: 'test-token',
    log: () => {},
    async claimDelivery(input) {
      const key = `${input.messageId}::${input.contactId}`;
      const existing = rows.get(key);
      const nowMs = Date.now();
      if (!existing) {
        const row = {
          id: `d${nextId++}`,
          status: 'pending',
          attempts: 0,
          ghl_message_id: null,
          lease_owner: input.owner,
          lease_expires_at: nowMs + input.leaseSeconds * 1000,
        };
        rows.set(key, row);
        return { claimed: true, deliveryId: row.id, status: row.status, attempts: 0, ghlMessageId: null } as DeliveryClaim;
      }
      const leaseLive = existing.lease_owner && existing.lease_expires_at > nowMs && existing.lease_owner !== input.owner;
      if (existing.status === 'posted' || leaseLive) {
        return {
          claimed: false,
          deliveryId: existing.id,
          status: existing.status,
          attempts: existing.attempts,
          ghlMessageId: existing.ghl_message_id,
        } as DeliveryClaim;
      }
      existing.lease_owner = input.owner;
      existing.lease_expires_at = nowMs + input.leaseSeconds * 1000;
      return {
        claimed: true,
        deliveryId: existing.id,
        status: existing.status,
        attempts: existing.attempts,
        ghlMessageId: existing.ghl_message_id,
      } as DeliveryClaim;
    },
    async updateDelivery(deliveryId, patch) {
      updates.push({ deliveryId, patch });
      if (options.recordFails) return { ok: false };
      for (const row of rows.values()) {
        if (row.id === deliveryId) Object.assign(row, patch);
      }
      return { ok: true };
    },
  };

  return { deps, searchBodies, posts, updates, rows };
}

const hpaContact = { id: 'c1', phone: '+12025559876', locationId: HPA_GHL_LOCATION_ID };

function testEvent(overrides: Partial<any> = {}) {
  const parsed = parseLinqEvent(groupEnvelope());
  if (!parsed.ok) throw new Error('bad fixture');
  return { ...parsed.event, ...overrides };
}

describe('delivery behaviour (mocked GHL + database)', () => {
  it('posts one InternalComment and sends the documented phone filter search body', async () => {
    const h = harness({ contacts: [hpaContact], contactDetails: { c1: hpaContact } });
    const out = await deliverToParticipants(h.deps, {
      event: testEvent(),
      groupName: 'Series A investors',
      participants: ['+12025559876'],
      owner: 'owner-a',
    });
    expect(out).toMatchObject({ matched: 1, failed: 0, skipped: 0, retriable: 0 });
    expect(h.searchBodies[0]).toMatchObject({
      locationId: HPA_GHL_LOCATION_ID,
      filters: [{ field: 'phone', operator: 'eq', value: '+12025559876' }],
      page: 1,
      pageLimit: CONTACT_SEARCH_PAGE_LIMIT,
    });
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].type).toBe('InternalComment');
    expect(h.posts[0].contactId).toBe('c1');
    expect(h.posts[0].message).toContain('Are we still on for Tuesday?');
  });

  it('never posts twice when two workers process the same event concurrently', async () => {
    const h = harness({ contacts: [hpaContact], contactDetails: { c1: hpaContact } });
    const event = testEvent();
    const both = await Promise.all([
      deliverToParticipants(h.deps, { event, groupName: 'g', participants: ['+12025559876'], owner: 'worker-1' }),
      deliverToParticipants(h.deps, { event, groupName: 'g', participants: ['+12025559876'], owner: 'worker-2' }),
    ]);
    expect(h.posts).toHaveLength(1);
    const deferred = both.reduce((n, r) => n + r.deferred, 0);
    const matched = both.reduce((n, r) => n + r.matched, 0);
    expect(deferred + matched).toBe(2);
    expect(matched).toBeGreaterThanOrEqual(1);

    // A later run finds the row already posted and stays a no-op.
    const again = await deliverToParticipants(h.deps, { event, groupName: 'g', participants: ['+12025559876'], owner: 'worker-3' });
    expect(again).toMatchObject({ matched: 1, retriable: 0 });
    expect(h.posts).toHaveLength(1);
  });

  it('recovers a POST whose database write failed by reading the marker back', async () => {
    const first = harness({ contacts: [hpaContact], contactDetails: { c1: hpaContact }, recordFails: true });
    const event = testEvent();
    await deliverToParticipants(first.deps, { event, groupName: 'g', participants: ['+12025559876'], owner: 'w1' });
    expect(first.posts).toHaveLength(1);
    const marker = commentMarker(event.messageId, 'c1');
    expect(first.posts[0].message).toContain(marker);

    // Retry, with the note already in the thread and the row still unposted.
    const retry = harness({
      contacts: [hpaContact],
      contactDetails: { c1: hpaContact },
      threadMessages: [{ id: 'ghl-msg-1', body: first.posts[0].message }],
    });
    await retry.deps.claimDelivery({ messageId: event.messageId, contactId: 'c1', chatId: event.chatId, marker, owner: 'seed', leaseSeconds: 0 });
    const row = [...retry.rows.values()][0];
    row.attempts = 1;
    row.lease_owner = null;
    const out = await deliverToParticipants(retry.deps, { event, groupName: 'g', participants: ['+12025559876'], owner: 'w2' });
    expect(retry.posts).toHaveLength(0); // no duplicate
    expect(out).toMatchObject({ matched: 1, failed: 0 });
    expect(retry.updates.at(-1)?.patch).toMatchObject({ status: 'posted', ghl_message_id: 'ghl-msg-1' });
  });

  it('refuses to post when the thread state cannot be determined after a prior attempt', async () => {
    const h = harness({ contacts: [hpaContact], contactDetails: { c1: hpaContact }, threadUnavailable: true });
    const event = testEvent();
    const marker = commentMarker(event.messageId, 'c1');
    await h.deps.claimDelivery({ messageId: event.messageId, contactId: 'c1', chatId: event.chatId, marker, owner: 'seed', leaseSeconds: 0 });
    const row = [...h.rows.values()][0];
    row.attempts = 2;
    row.lease_owner = null;
    const out = await deliverToParticipants(h.deps, { event, groupName: 'g', participants: ['+12025559876'], owner: 'w2' });
    expect(h.posts).toHaveLength(0);
    expect(out).toMatchObject({ matched: 0, failed: 1, retriable: 1 });
    expect(h.updates.at(-1)?.patch).toMatchObject({ status: 'failed', last_error: 'marker_check_unavailable' });
  });

  it('posts exactly once when a prior attempt is proven absent from the thread', async () => {
    const h = harness({ contacts: [hpaContact], contactDetails: { c1: hpaContact } });
    const event = testEvent();
    const marker = commentMarker(event.messageId, 'c1');
    await h.deps.claimDelivery({ messageId: event.messageId, contactId: 'c1', chatId: event.chatId, marker, owner: 'seed', leaseSeconds: 0 });
    const row = [...h.rows.values()][0];
    row.attempts = 2;
    row.lease_owner = null;
    const out = await deliverToParticipants(h.deps, { event, groupName: 'g', participants: ['+12025559876'], owner: 'w2' });
    expect(h.posts).toHaveLength(1);
    expect(out.matched).toBe(1);
  });

  it('skips ambiguous contacts and never posts to either of them', async () => {
    const h = harness({
      contacts: [
        { id: 'c1', phone: '+12025559876', locationId: HPA_GHL_LOCATION_ID },
        { id: 'c2', phone: '2025559876', locationId: HPA_GHL_LOCATION_ID },
      ],
      contactDetails: { c1: hpaContact },
    });
    const out = await deliverToParticipants(h.deps, { event: testEvent(), groupName: 'g', participants: ['+12025559876'], owner: 'w' });
    expect(h.posts).toHaveLength(0);
    expect(out).toMatchObject({ matched: 0, skipped: 1, failed: 0 });
  });

  it('skips a contact that belongs to a different location', async () => {
    const foreign = { id: 'c9', phone: '+12025559876', locationId: 'someOtherLocation' };
    const h = harness({ contacts: [foreign], contactDetails: { c9: foreign } });
    const out = await deliverToParticipants(h.deps, { event: testEvent(), groupName: 'g', participants: ['+12025559876'], owner: 'w' });
    expect(h.posts).toHaveLength(0);
    expect(out.skipped).toBe(1);
  });

  it('rechecks the location on the contact record even when search claims a match', async () => {
    const h = harness({
      contacts: [{ id: 'c1', phone: '+12025559876', locationId: HPA_GHL_LOCATION_ID }],
      contactDetails: { c1: { id: 'c1', phone: '+12025559876', locationId: 'movedElsewhere' } },
    });
    const out = await deliverToParticipants(h.deps, { event: testEvent(), groupName: 'g', participants: ['+12025559876'], owner: 'w' });
    expect(h.posts).toHaveLength(0);
    expect(out.skipped).toBe(1);
  });

  it('never matches a foreign number that shares the last ten digits', async () => {
    const uk = { id: 'c7', phone: '+442025559876', locationId: HPA_GHL_LOCATION_ID };
    const h = harness({ contacts: [uk], contactDetails: { c7: uk } });
    const out = await deliverToParticipants(h.deps, { event: testEvent(), groupName: 'g', participants: ['+12025559876'], owner: 'w' });
    expect(h.posts).toHaveLength(0);
    expect(out.skipped).toBe(1);
  });

  it('reports a transient GHL failure as retriable instead of dropping the message', async () => {
    const h = harness({ contacts: [hpaContact], contactDetails: { c1: hpaContact }, postStatus: 502 });
    const out = await deliverToParticipants(h.deps, { event: testEvent(), groupName: 'g', participants: ['+12025559876'], owner: 'w' });
    expect(out).toMatchObject({ matched: 0, failed: 1, retriable: 1 });
    expect(h.updates.at(-1)?.patch).toMatchObject({ status: 'failed', last_error: 'ghl_502' });
  });
});

describe('recovery rebuilds the full original note from the Linq APIs', () => {
  const linqMessage = {
    id: 'msg-1',
    chat_id: 'chat-1',
    created_at: '2026-02-05T19:31:13.074Z',
    is_from_me: false,
    from_handle: { handle: '+12025559876', is_me: false },
    parts: [
      { type: 'text', value: 'Are we still on for Tuesday?' },
      { type: 'image', url: 'https://cdn.linqapp.com/a/1.jpg' },
    ],
  };
  const linqChat = {
    id: 'chat-1',
    is_group: true,
    display_name: 'Series A investors',
    organization_id: LINQ_ORG_ID,
    handles: [
      { handle: OWNED_LINES[0], is_me: true, joined_at: '2026-01-01T00:00:00Z', status: 'active' },
      { handle: '+12025559876', is_me: false, joined_at: '2026-01-02T00:00:00Z', status: 'active' },
      { handle: '+14155550142', is_me: false, joined_at: '2026-06-01T00:00:00Z', status: 'active' },
    ],
  };
  const config = { ingestion_enabled: true, linq_org_id: LINQ_ORG_ID };

  it('reconstructs text, sender, timestamp and participants — no stub', async () => {
    const h = harness({
      contacts: [hpaContact],
      contactDetails: { c1: hpaContact },
      linqMessage,
      linqChat,
    });
    const rebuilt = await reconstructEvent(h.deps, 'msg-1', 'reconcile:msg-1');
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    const result = await runPipeline(h.deps, { event: rebuilt.event, config, owner: 'rc', reconciled: true });
    expect(result.kind).toBe('delivered');
    expect(h.posts).toHaveLength(1);
    const message = h.posts[0].message as string;
    expect(message).toContain('Are we still on for Tuesday?');
    expect(message).toContain('https://cdn.linqapp.com/a/1.jpg');
    expect(message).toContain('+12025559876');
    expect(message).toContain('2026-02-05T19:31:13.074Z');
    expect(message).toContain('Series A investors');
    expect(message).toContain('reconciled');
    // The participant who joined in June is not exposed to a February message.
    expect(message).not.toContain('+14155550142');
  });

  it('refuses to reconcile while ingestion is disabled', async () => {
    const h = harness({ contacts: [hpaContact], contactDetails: { c1: hpaContact }, linqMessage, linqChat });
    const rebuilt = await reconstructEvent(h.deps, 'msg-1', 'reconcile:msg-1');
    if (!rebuilt.ok) throw new Error('expected rebuild');
    const result = await runPipeline(h.deps, { event: rebuilt.event, config: { ingestion_enabled: false }, owner: 'rc', reconciled: true });
    expect(result).toEqual({ kind: 'skipped', reason: 'ingestion_disabled' });
    expect(h.posts).toHaveLength(0);
  });

  it('refuses a 1:1 chat, an out-of-scope org and a chat with no owned line', async () => {
    const oneToOne = harness({ linqMessage, linqChat: { ...linqChat, is_group: false } });
    expect(await reconstructEvent(oneToOne.deps, 'msg-1', 'e')).toEqual({ ok: false, code: 'not_group' });

    const otherOrg = harness({ contacts: [hpaContact], contactDetails: { c1: hpaContact }, linqMessage, linqChat: { ...linqChat, organization_id: '99999' } });
    const rebuiltOther = await reconstructEvent(otherOrg.deps, 'msg-1', 'e');
    if (!rebuiltOther.ok) throw new Error('expected rebuild');
    expect(await runPipeline(otherOrg.deps, { event: rebuiltOther.event, config, owner: 'rc' }))
      .toEqual({ kind: 'skipped', reason: 'organization_out_of_scope' });

    const noOwned = harness({
      contacts: [hpaContact],
      contactDetails: { c1: hpaContact },
      linqMessage,
      linqChat: { ...linqChat, handles: linqChat.handles.filter((h) => !h.is_me) },
    });
    const rebuiltNoOwned = await reconstructEvent(noOwned.deps, 'msg-1', 'e');
    if (!rebuiltNoOwned.ok) throw new Error('expected rebuild');
    expect(await runPipeline(noOwned.deps, { event: rebuiltNoOwned.event, config, owner: 'rc' }))
      .toEqual({ kind: 'skipped', reason: 'no_owned_line_in_chat' });
    expect(noOwned.posts).toHaveLength(0);
  });

  it('reports a missing Linq message instead of writing a stub', async () => {
    const h = harness({ linqChat });
    expect(await reconstructEvent(h.deps, 'msg-missing', 'e')).toEqual({ ok: false, code: 'linq_message_404' });
    expect(h.posts).toHaveLength(0);
  });

  it('builds the same shape from REST resources as from the webhook envelope', () => {
    const built = buildEventFromResources({ message: linqMessage, chat: linqChat, eventId: 'e1' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.event).toMatchObject({
      messageId: 'msg-1',
      chatId: 'chat-1',
      direction: 'inbound',
      senderHandle: '+12025559876',
      sentAt: '2026-02-05T19:31:13.074Z',
      text: 'Are we still on for Tuesday?',
    });
  });
});
