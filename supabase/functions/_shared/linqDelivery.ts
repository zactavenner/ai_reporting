/**
 * Linq -> GHL internal-comment delivery core.
 *
 * Every side effect (HTTP, database) is injected, so the exact behaviour that
 * runs in production — concurrency claims, marker reconciliation, location
 * verification, membership-at-message-time, full-note reconstruction — is
 * covered by mocked behavioural tests.
 *
 * Reads/writes are restricted to the HPA location and to `InternalComment`.
 */
import {
  CONTACT_SEARCH_MAX_PAGES,
  CONTACT_SEARCH_PAGE_LIMIT,
  DELIVERY_LEASE_SECONDS,
  HPA_GHL_LOCATION_ID,
  LINQ_API_BASE,
  LINQ_ORG_ID,
  buildContactQueryBody,
  buildContactSearchBody,
  buildEventFromResources,
  buildInternalComment,
  classifyContactMatch,
  commentMarker,
  contactLocationStatus,
  findMarkedMessageId,
  isOwnedLine,
  maskHandle,
  selectExternalParticipants,
  toE164,
  type LinqGroupMessage,
} from './linqBridge.ts';

export const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
export const GHL_VERSION = '2021-07-28';

export interface DeliveryClaim {
  claimed: boolean;
  deliveryId: string | null;
  status: string | null;
  attempts: number;
  ghlMessageId: string | null;
}

export interface LinqDeps {
  fetch: typeof fetch;
  ghlApiKey: string;
  linqToken: string;
  /** Atomic per (message, contact) lease. Must be backed by linq_claim_delivery. */
  claimDelivery(input: {
    messageId: string;
    contactId: string;
    chatId: string;
    marker: string;
    owner: string;
    leaseSeconds: number;
  }): Promise<DeliveryClaim | null>;
  updateDelivery(deliveryId: string, patch: Record<string, unknown>): Promise<{ ok: boolean }>;
  log?: (line: string) => void;
}

function ghlHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function linqHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

function note(deps: LinqDeps, line: string) {
  (deps.log ?? ((l: string) => console.log(l)))(line);
}

/* ------------------------------------------------------------------- Linq */

export async function fetchLinqChat(deps: LinqDeps, chatId: string) {
  const res = await deps.fetch(`${LINQ_API_BASE}/chats/${encodeURIComponent(chatId)}`, {
    headers: linqHeaders(deps.linqToken),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const body = await res.json().catch(() => null);
  const chat = body?.chat ?? body?.data ?? body;
  return {
    ok: true as const,
    chat,
    displayName: chat?.display_name ? String(chat.display_name) : null,
    handles: Array.isArray(chat?.handles) ? chat.handles : [],
    isGroup: chat?.is_group,
    organizationId: chat?.organization_id ? String(chat.organization_id) : null,
  };
}

/** Documented single-message read: GET /v3/messages/{messageId}. */
export async function fetchLinqMessage(deps: LinqDeps, messageId: string) {
  const res = await deps.fetch(`${LINQ_API_BASE}/messages/${encodeURIComponent(messageId)}`, {
    headers: linqHeaders(deps.linqToken),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const body = await res.json().catch(() => null);
  return { ok: true as const, message: body?.message ?? body?.data ?? body };
}

/** Rebuild the full original note context from the authenticated Linq APIs. */
export async function reconstructEvent(
  deps: LinqDeps,
  messageId: string,
  eventId: string,
  eventType?: string,
) {
  const message = await fetchLinqMessage(deps, messageId);
  if (!message.ok) return { ok: false as const, code: `linq_message_${message.status}` };
  const chatId = String(message.message?.chat_id ?? '').trim();
  if (!chatId) return { ok: false as const, code: 'linq_message_chat_unknown' };
  const chat = await fetchLinqChat(deps, chatId);
  if (!chat.ok) return { ok: false as const, code: `linq_chat_${chat.status}` };
  const built: any = buildEventFromResources({ message: message.message, chat: chat.chat, eventId, eventType });
  if (!built.ok) return { ok: false as const, code: String(built.code) };
  return { ok: true as const, event: built.event as LinqGroupMessage };
}

/* -------------------------------------------------------------------- GHL */

/**
 * Read-only contact lookup on the documented advanced-search contract: a
 * `phone` filter with `eq`, bounded page/pageLimit pagination, with the
 * documented free-text `query` form as fallback.
 */
export async function ghlContactsByPhone(deps: LinqDeps, handle: string) {
  const collected: any[] = [];
  let mode: 'filters' | 'query' = 'filters';

  const runPages = async (): Promise<{ ok: boolean; status: number }> => {
    for (let page = 1; page <= CONTACT_SEARCH_MAX_PAGES; page++) {
      const body = mode === 'filters'
        ? buildContactSearchBody({ handle, locationId: HPA_GHL_LOCATION_ID, page })
        : buildContactQueryBody({ handle, locationId: HPA_GHL_LOCATION_ID, page });
      const res = await deps.fetch(`${GHL_BASE_URL}/contacts/search`, {
        method: 'POST',
        headers: ghlHeaders(deps.ghlApiKey),
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const parsed = await res.json().catch(() => ({}));
      const contacts = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
      collected.push(...contacts);
      if (contacts.length < CONTACT_SEARCH_PAGE_LIMIT) break;
    }
    return { ok: true, status: 200 };
  };

  let attempt = await runPages();
  if (!attempt.ok && (attempt.status === 400 || attempt.status === 422)) {
    mode = 'query';
    attempt = await runPages();
  }
  if (!attempt.ok) return { ok: false as const, status: attempt.status };

  if (collected.length === 0 && mode === 'filters') {
    mode = 'query';
    const second = await runPages();
    if (!second.ok) return { ok: false as const, status: second.status };
  }

  return { ok: true as const, contacts: collected, mode };
}

/** Authoritative per-contact location check before any write. */
export async function ghlContactLocation(deps: LinqDeps, contactId: string) {
  const res = await deps.fetch(`${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`, {
    headers: ghlHeaders(deps.ghlApiKey),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const body = await res.json().catch(() => ({}));
  const contact = body?.contact ?? body;
  return { ok: true as const, contact, status: contactLocationStatus(contact, HPA_GHL_LOCATION_ID) };
}

export type ResolvedContact =
  | { status: 'matched'; contactId: string }
  | { status: 'unmatched' | 'ambiguous' | 'location_mismatch' | 'lookup_failed' };

export async function resolveContactForHandle(deps: LinqDeps, handle: string): Promise<ResolvedContact> {
  const lookup = await ghlContactsByPhone(deps, handle);
  if (!lookup.ok) return { status: 'lookup_failed' };
  const classified = classifyContactMatch(lookup.contacts, handle, HPA_GHL_LOCATION_ID);

  if (classified.status === 'matched') {
    const verified = await ghlContactLocation(deps, classified.contactId);
    if (!verified.ok) return { status: 'lookup_failed' };
    if (verified.status !== 'match') return { status: 'location_mismatch' };
    return { status: 'matched', contactId: classified.contactId };
  }
  if (classified.status !== 'location_unverified') return { status: classified.status };

  const confirmed: string[] = [];
  for (const id of classified.contactIds) {
    const verified = await ghlContactLocation(deps, id);
    if (!verified.ok) return { status: 'lookup_failed' };
    if (verified.status === 'match') confirmed.push(id);
  }
  if (confirmed.length === 1) return { status: 'matched', contactId: confirmed[0] };
  if (confirmed.length > 1) return { status: 'ambiguous' };
  return { status: 'location_mismatch' };
}

export async function postInternalComment(deps: LinqDeps, contactId: string, message: string) {
  const res = await deps.fetch(`${GHL_BASE_URL}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(deps.ghlApiKey),
    // InternalComment only — never a deliverable channel.
    body: JSON.stringify({ type: 'InternalComment', contactId, message, mentions: [] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false as const, status: res.status, error: `ghl_${res.status}` };
  return {
    ok: true as const,
    conversationId: body?.conversationId ?? body?.conversation?.id ?? null,
    messageId: body?.messageId ?? body?.msg?.id ?? body?.message?.id ?? null,
  };
}

/**
 * Look for an already-posted note carrying our marker. Returns the GHL message
 * id when found, `null` when definitely absent, `undefined` when undetermined
 * (in which case we must NOT re-post).
 */
export async function findPostedMarker(
  deps: LinqDeps,
  contactId: string,
  marker: string,
): Promise<string | null | undefined> {
  const search = await deps.fetch(
    `${GHL_BASE_URL}/conversations/search?locationId=${encodeURIComponent(HPA_GHL_LOCATION_ID)}&contactId=${encodeURIComponent(contactId)}&limit=20`,
    { headers: ghlHeaders(deps.ghlApiKey) },
  );
  if (!search.ok) return undefined;
  const body = await search.json().catch(() => ({}));
  const conversations = Array.isArray(body?.conversations) ? body.conversations : [];
  if (conversations.length === 0) return null;
  for (const conversation of conversations) {
    const id = conversation?.id;
    if (!id) continue;
    const res = await deps.fetch(
      `${GHL_BASE_URL}/conversations/${encodeURIComponent(String(id))}/messages?limit=100`,
      { headers: ghlHeaders(deps.ghlApiKey) },
    );
    if (!res.ok) return undefined;
    const parsed = await res.json().catch(() => ({}));
    const messages = Array.isArray(parsed?.messages?.messages)
      ? parsed.messages.messages
      : Array.isArray(parsed?.messages)
        ? parsed.messages
        : [];
    const found = findMarkedMessageId(messages, marker);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------- processing */

export interface DeliveryOutcome {
  matched: number;
  skipped: number;
  failed: number;
  retriable: number;
  deferred: number;
}

export async function deliverToParticipants(
  deps: LinqDeps,
  input: {
    event: LinqGroupMessage;
    groupName: string | null;
    participants: string[];
    owner: string;
    reconciled?: boolean;
  },
): Promise<DeliveryOutcome> {
  const { event, participants, owner } = input;
  const out: DeliveryOutcome = { matched: 0, skipped: 0, failed: 0, retriable: 0, deferred: 0 };

  for (const handle of participants) {
    const resolved = await resolveContactForHandle(deps, handle);
    if (resolved.status === 'lookup_failed') {
      out.failed++;
      out.retriable++;
      note(deps, `[linq-bridge] contact lookup failed handle=${maskHandle(handle)}`);
      continue;
    }
    if (resolved.status !== 'matched') {
      out.skipped++;
      note(deps, `[linq-bridge] participant ${resolved.status} handle=${maskHandle(handle)}`);
      continue;
    }

    const contactId = resolved.contactId;
    const marker = commentMarker(event.messageId, contactId);

    const claim = await deps.claimDelivery({
      messageId: event.messageId,
      contactId,
      chatId: event.chatId,
      marker,
      owner,
      leaseSeconds: DELIVERY_LEASE_SECONDS,
    });
    if (!claim) {
      out.failed++;
      out.retriable++;
      note(deps, '[linq-bridge] claim failed');
      continue;
    }
    if (!claim.claimed) {
      if (claim.status === 'posted') out.matched++; // already logged — no-op
      else {
        out.deferred++; // another worker holds a live lease
        out.retriable++;
      }
      continue;
    }
    const deliveryId = claim.deliveryId!;
    const priorAttempts = Number(claim.attempts ?? 0);

    // A previous attempt of unknown outcome is reconciled, never repeated.
    if (priorAttempts > 0 || claim.ghlMessageId) {
      const existing = await findPostedMarker(deps, contactId, marker);
      if (existing === undefined) {
        out.failed++;
        out.retriable++;
        await deps.updateDelivery(deliveryId, {
          status: 'failed',
          last_error: 'marker_check_unavailable',
          lease_owner: null,
          lease_expires_at: null,
        });
        continue;
      }
      if (existing) {
        out.matched++;
        await deps.updateDelivery(deliveryId, {
          status: 'posted',
          ghl_message_id: existing,
          posted_at: new Date().toISOString(),
          last_error: null,
          lease_owner: null,
          lease_expires_at: null,
        });
        continue;
      }
    }

    const comment = buildInternalComment({
      event,
      groupName: input.groupName,
      participants,
      contactId,
      reconciled: input.reconciled,
    });
    const posted = await postInternalComment(deps, contactId, comment);
    if (posted.ok) {
      out.matched++;
      const recorded = await deps.updateDelivery(deliveryId, {
        status: 'posted',
        ghl_conversation_id: posted.conversationId,
        ghl_message_id: posted.messageId,
        posted_at: new Date().toISOString(),
        last_error: null,
        lease_owner: null,
        lease_expires_at: null,
      });
      if (!recorded.ok) {
        // The note exists in GHL; the marker lookup on the next pass settles the
        // row instead of posting a duplicate.
        note(deps, '[linq-bridge] posted but failed to record delivery');
      }
    } else {
      out.failed++;
      if (posted.status >= 500 || posted.status === 429) out.retriable++;
      await deps.updateDelivery(deliveryId, {
        status: 'failed',
        attempts: priorAttempts + 1,
        last_error: posted.error,
        lease_owner: null,
        lease_expires_at: null,
      });
    }
  }

  return out;
}

export type PipelineResult =
  | { kind: 'skipped'; reason: string; isGroup?: boolean }
  | { kind: 'failed'; code: string; httpStatus: number }
  | { kind: 'delivered'; outcome: DeliveryOutcome; participants: number };

/**
 * Shared gate + delivery pipeline used by the webhook and by reconciliation, so
 * both enforce group-only, org scope, owned-line presence, membership at the
 * original message time and per-contact location identically.
 */
export async function runPipeline(
  deps: LinqDeps,
  input: { event: LinqGroupMessage; config: any; owner: string; reconciled?: boolean },
): Promise<PipelineResult> {
  const { event, config, owner } = input;

  if (!config || config.ingestion_enabled !== true) {
    return { kind: 'skipped', reason: 'ingestion_disabled' };
  }

  const chat = await fetchLinqChat(deps, event.chatId);
  if (!chat.ok) return { kind: 'failed', code: `linq_chat_${chat.status}`, httpStatus: 502 };
  if (chat.isGroup !== true) return { kind: 'skipped', reason: 'not_group', isGroup: false };
  if (chat.organizationId && chat.organizationId !== String(config?.linq_org_id || LINQ_ORG_ID)) {
    return { kind: 'skipped', reason: 'organization_out_of_scope' };
  }

  const handles = chat.handles.length ? chat.handles : event.handles;
  const ownedPresent =
    handles.some((h: any) => isOwnedLine(h?.handle)) || isOwnedLine(event.senderHandle);
  if (!ownedPresent) return { kind: 'skipped', reason: 'no_owned_line_in_chat' };

  const participants = selectExternalParticipants(handles, event.sentAt);
  if (participants.length === 0) return { kind: 'skipped', reason: 'no_external_participants' };

  const outcome = await deliverToParticipants(deps, {
    event,
    groupName: chat.displayName,
    participants,
    owner,
    reconciled: input.reconciled,
  });
  return { kind: 'delivered', outcome, participants: participants.length };
}

/** Read-only access probe: counts only, never contact PII. */
export async function ghlReadProbe(deps: LinqDeps, rawHandle: string) {
  const handle = toE164(rawHandle);
  if (!handle) return { ok: false as const, code: 'invalid_probe_phone' };
  const lookup = await ghlContactsByPhone(deps, handle);
  if (!lookup.ok) return { ok: false as const, code: 'ghl_read_failed', status: lookup.status };
  const exact = lookup.contacts.filter(
    (c: any) => classifyContactMatch([c], handle, HPA_GHL_LOCATION_ID).status !== 'unmatched',
  );
  const states = new Set(lookup.contacts.map((c: any) => contactLocationStatus(c, HPA_GHL_LOCATION_ID)));
  return {
    ok: true as const,
    read_only: true,
    search_mode: lookup.mode,
    location_id: HPA_GHL_LOCATION_ID,
    contacts_returned: lookup.contacts.length,
    exact_e164_matches: exact.length,
    location_field_states: [...states],
  };
}
