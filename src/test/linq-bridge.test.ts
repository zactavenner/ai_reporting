import { describe, it, expect } from 'vitest';
import {
  HPA_GHL_LOCATION_ID,
  LINQ_ORG_ID,
  LINQ_WEBHOOK_VERSION,
  OWNED_LINES,
  SIGNATURE_TOLERANCE_SECONDS,
  buildInternalComment,
  classifyContactMatch,
  deliveryKey,
  isOwnedLine,
  normalizeHandle,
  parseLinqEvent,
  selectExternalParticipants,
  verifyLinqSignature,
} from '../../supabase/functions/_shared/linqBridge';

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

describe('participant selection excludes our own lines', () => {
  it('drops is_me handles, both owned lines and duplicates', () => {
    const external = selectExternalParticipants([
      { handle: OWNED_LINES[0], is_me: true },
      { handle: OWNED_LINES[1], is_me: false },
      { handle: '+1 (202) 555-9876', is_me: false },
      { handle: '2025559876', is_me: false },
      { handle: 'someone@example.com', is_me: false },
      { handle: '911', is_me: false },
    ]);
    expect(external).toEqual(['+12025559876']);
    expect(isOwnedLine('(415) 604-0157')).toBe(true);
    expect(isOwnedLine('+12025559876')).toBe(false);
    expect(normalizeHandle('4154980385')).toBe('+14154980385');
  });
});

describe('contact matching is skipped unless exactly one contact matches', () => {
  it('matches one, and refuses ambiguous or unmatched phones', () => {
    expect(classifyContactMatch([{ id: 'c1', phone: '+1 202-555-9876' }], '+12025559876')).toEqual({ status: 'matched', contactId: 'c1' });
    expect(classifyContactMatch([{ id: 'c1', phone: '2025559876' }, { id: 'c2', phone: '+12025559876' }], '+12025559876')).toEqual({ status: 'ambiguous' });
    expect(classifyContactMatch([{ id: 'c1', phone: '+12025550000' }], '+12025559876')).toEqual({ status: 'unmatched' });
    expect(classifyContactMatch([], '+12025559876')).toEqual({ status: 'unmatched' });
  });
});

describe('internal comment body', () => {
  it('carries group, sender, participants, timestamp, direction, text and attachments', () => {
    const parsed = parseLinqEvent(groupEnvelope());
    if (!parsed.ok) throw new Error('expected group message');
    const comment = buildInternalComment({ event: parsed.event, groupName: 'Series A investors', participants: ['+12025559876', '+14155550142'] });
    expect(comment).toContain('Series A investors');
    expect(comment).toContain('chat chat-1');
    expect(comment).toContain('Inbound');
    expect(comment).toContain('+12025559876');
    expect(comment).toContain('2026-02-05T19:31:13.074Z');
    expect(comment).toContain('Are we still on for Tuesday?');
    expect(comment).toContain('https://cdn.linqapp.com/a/1.jpg');
    expect(comment).toContain('Linq message msg-1');
  });
});

describe('idempotency scope', () => {
  it('keys one comment per message per contact', () => {
    expect(deliveryKey('msg-1', 'c1')).toBe('msg-1::c1');
    expect(deliveryKey('msg-1', 'c1')).toBe(deliveryKey('msg-1', 'c1'));
    expect(deliveryKey('msg-1', 'c2')).not.toBe(deliveryKey('msg-1', 'c1'));
  });
});
