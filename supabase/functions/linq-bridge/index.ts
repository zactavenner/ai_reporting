/* linq-bridge */
/**
 * linq-bridge — receives signed Linq iMessage webhooks and appends the group
 * conversation to each matched HPA GHL contact as an InternalComment note.
 *
 * Hard guarantees:
 *  - Fails closed when LINQ_WEBHOOK_SECRET or LINQ_API_TOKEN is absent.
 *  - Ingestion is additionally gated by linq_bridge_config.ingestion_enabled,
 *    which ships DISABLED (webhook and reconcile alike).
 *  - Writes only to GHL location ZcPPQTHBxBWlnM1WyjvU, using that client's
 *    existing server-side credential, and only after verifying that the target
 *    contact's own locationId is that location.
 *  - Only `InternalComment` is ever posted. No SMS, no email, no contact create.
 *  - Group chats only; 1:1 chats are skipped with an operational status.
 *  - Per (message, contact) claims are leased atomically in Postgres, so two
 *    concurrent deliveries can never both post the same note; stale leases are
 *    recovered automatically.
 *  - Every note carries a stable marker. Before re-posting after an uncertain
 *    outcome the contact's thread is read for that marker, so a POST that
 *    succeeded but failed to record is reconciled instead of duplicated.
 *  - Transient failures return a retriable status; a dropped message is never
 *    silently 200'd.
 *  - No raw message text, participant PII or credentials in console output.
 *
 * Operator surface (existing agency auth via authorizeOperator):
 *   { action: 'status' }
 *   { action: 'verify_ghl_read' }            -> read-only GHL access probe
 *   { action: 'set_ingestion', enabled: boolean }
 *   { action: 'reconcile', limit?: number }  -> replays deliveries AND partially
 *                                               failed events from the ledger
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { corsHeaders as sdkCors } from 'npm:@supabase/supabase-js@2.58.0/cors';
import { authorizeOperator } from '../_shared/operatorAuth.ts';
import {
  CONTACT_SEARCH_MAX_PAGES,
  CONTACT_SEARCH_PAGE_LIMIT,
  DELIVERY_LEASE_SECONDS,
  HPA_GHL_LOCATION_ID,
  LINQ_API_BASE,
  LINQ_API_TOKEN_HEADER_NOTE,
  LINQ_ORG_ID,
  LINQ_TOKEN_ENV,
  LINQ_WEBHOOK_SECRET_ENV,
  RECONCILE_LEASE_SECONDS,
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
  parseLinqEvent,
  selectExternalParticipants,
  toE164,
  verifyLinqSignature,
  type LinqGroupMessage,
} from '../_shared/linqBridge.ts';

const corsHeaders = {
  ...sdkCors,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
};

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function secrets() {
  return {
    signing: (Deno.env.get(LINQ_WEBHOOK_SECRET_ENV) || '').trim(),
    token: (Deno.env.get(LINQ_TOKEN_ENV) || '').trim(),
  };
}

async function loadConfig() {
  const { data } = await admin
    .from('linq_bridge_config')
    .select('*')
    .eq('ghl_location_id', HPA_GHL_LOCATION_ID)
    .maybeSingle();
  return data;
}

/** The only GHL target this bridge may ever touch. */
async function resolveHpaClient() {
  const { data, error } = await admin
    .from('clients')
    .select('id, name, ghl_api_key, ghl_location_id')
    .eq('ghl_location_id', HPA_GHL_LOCATION_ID);
  if (error) return { code: 'client_lookup_failed' as const };
  const rows = (data || []).filter((c) => (c.ghl_api_key || '').length > 10);
  if (rows.length === 0) return { code: 'ghl_credential_unavailable' as const };
  if (rows.length > 1) return { code: 'ambiguous_client_mapping' as const };
  return { client: rows[0] };
}

/* ------------------------------------------------------------------- Linq */

function linqHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function fetchLinqChat(chatId: string, token: string) {
  const res = await fetch(`${LINQ_API_BASE}/chats/${encodeURIComponent(chatId)}`, {
    headers: linqHeaders(token),
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
async function fetchLinqMessage(messageId: string, token: string) {
  const res = await fetch(`${LINQ_API_BASE}/messages/${encodeURIComponent(messageId)}`, {
    headers: linqHeaders(token),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const body = await res.json().catch(() => null);
  return { ok: true as const, message: body?.message ?? body?.data ?? body };
}

/* -------------------------------------------------------------------- GHL */

function ghlHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Read-only contact lookup using the documented advanced-search contract:
 * a `phone` filter with `eq`, paginated with page/pageLimit (bounded), with the
 * documented free-text `query` form as a fallback for locations where the
 * filter form is rejected or returns nothing.
 */
async function ghlContactsByPhone(apiKey: string, handle: string) {
  const collected: any[] = [];
  let mode: 'filters' | 'query' = 'filters';
  let usedQueryFallback = false;

  const runPages = async (): Promise<{ ok: true } | { ok: false; status: number }> => {
    for (let page = 1; page <= CONTACT_SEARCH_MAX_PAGES; page++) {
      const body = mode === 'filters'
        ? buildContactSearchBody({ handle, locationId: HPA_GHL_LOCATION_ID, page })
        : buildContactQueryBody({ handle, locationId: HPA_GHL_LOCATION_ID, page });
      const res = await fetch(`${GHL_BASE_URL}/contacts/search`, {
        method: 'POST',
        headers: ghlHeaders(apiKey),
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const parsed = await res.json().catch(() => ({}));
      const contacts = Array.isArray(parsed?.contacts) ? parsed.contacts : [];
      collected.push(...contacts);
      if (contacts.length < CONTACT_SEARCH_PAGE_LIMIT) break;
    }
    return { ok: true };
  };

  let attempt = await runPages();
  if (!attempt.ok && (attempt.status === 400 || attempt.status === 422) && !usedQueryFallback) {
    usedQueryFallback = true;
    mode = 'query';
    attempt = await runPages();
  }
  if (!attempt.ok) return { ok: false as const, status: attempt.status };

  if (collected.length === 0 && !usedQueryFallback) {
    mode = 'query';
    const second = await runPages();
    if (!second.ok) return { ok: false as const, status: second.status };
  }

  return { ok: true as const, contacts: collected, mode };
}

/** Authoritative per-contact location check before any write. */
async function ghlContactLocation(apiKey: string, contactId: string) {
  const res = await fetch(`${GHL_BASE_URL}/contacts/${encodeURIComponent(contactId)}`, {
    headers: ghlHeaders(apiKey),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const body = await res.json().catch(() => ({}));
  const contact = body?.contact ?? body;
  return {
    ok: true as const,
    contact,
    status: contactLocationStatus(contact, HPA_GHL_LOCATION_ID),
  };
}

type ResolvedContact =
  | { status: 'matched'; contactId: string }
  | { status: 'unmatched' | 'ambiguous' | 'location_mismatch' | 'location_unverified' | 'lookup_failed' };

async function resolveContactForHandle(apiKey: string, handle: string): Promise<ResolvedContact> {
  const lookup = await ghlContactsByPhone(apiKey, handle);
  if (!lookup.ok) return { status: 'lookup_failed' };
  const classified = classifyContactMatch(lookup.contacts, handle, HPA_GHL_LOCATION_ID);
  if (classified.status === 'matched') {
    // Second, authoritative confirmation straight from the contact record.
    const verified = await ghlContactLocation(apiKey, classified.contactId);
    if (!verified.ok) return { status: 'lookup_failed' };
    if (verified.status !== 'match') return { status: 'location_mismatch' };
    return { status: 'matched', contactId: classified.contactId };
  }
  if (classified.status !== 'location_unverified') return { status: classified.status };

  const confirmed: string[] = [];
  for (const id of classified.contactIds) {
    const verified = await ghlContactLocation(apiKey, id);
    if (!verified.ok) return { status: 'lookup_failed' };
    if (verified.status === 'match') confirmed.push(id);
  }
  if (confirmed.length === 1) return { status: 'matched', contactId: confirmed[0] };
  if (confirmed.length > 1) return { status: 'ambiguous' };
  return { status: 'location_mismatch' };
}

async function postInternalComment(apiKey: string, contactId: string, message: string) {
  const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(apiKey),
    // InternalComment only — never a deliverable channel.
    body: JSON.stringify({ type: 'InternalComment', contactId, message, mentions: [] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false as const, status: res.status, error: `ghl_${res.status}` };
  }
  return {
    ok: true as const,
    conversationId: body?.conversationId ?? body?.conversation?.id ?? null,
    messageId: body?.messageId ?? body?.msg?.id ?? body?.message?.id ?? null,
  };
}

/**
 * Look for an already-posted note carrying our marker. Returns the GHL message
 * id when found, `null` when definitely absent, `undefined` when we could not
 * determine it (in which case we must NOT blindly re-post).
 */
async function findPostedMarker(
  apiKey: string,
  contactId: string,
  marker: string,
): Promise<string | null | undefined> {
  const search = await fetch(
    `${GHL_BASE_URL}/conversations/search?locationId=${encodeURIComponent(HPA_GHL_LOCATION_ID)}&contactId=${encodeURIComponent(contactId)}&limit=20`,
    { headers: ghlHeaders(apiKey) },
  );
  if (!search.ok) return undefined;
  const body = await search.json().catch(() => ({}));
  const conversations = Array.isArray(body?.conversations) ? body.conversations : [];
  if (conversations.length === 0) return null;
  for (const conversation of conversations) {
    const id = conversation?.id;
    if (!id) continue;
    const res = await fetch(
      `${GHL_BASE_URL}/conversations/${encodeURIComponent(String(id))}/messages?limit=100`,
      { headers: ghlHeaders(apiKey) },
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

interface DeliveryOutcome {
  matched: number;
  skipped: number;
  failed: number;
  retriable: number;
  deferred: number;
}

async function deliverToParticipants(
  event: LinqGroupMessage,
  groupName: string | null,
  participants: string[],
  apiKey: string,
  owner: string,
  opts: { reconciled?: boolean } = {},
): Promise<DeliveryOutcome> {
  const out: DeliveryOutcome = { matched: 0, skipped: 0, failed: 0, retriable: 0, deferred: 0 };

  for (const handle of participants) {
    const resolved = await resolveContactForHandle(apiKey, handle);
    if (resolved.status === 'lookup_failed') {
      out.failed++;
      out.retriable++;
      console.warn(`[linq-bridge] contact lookup failed handle=${maskHandle(handle)}`);
      continue;
    }
    if (resolved.status !== 'matched') {
      out.skipped++;
      console.log(`[linq-bridge] participant ${resolved.status} handle=${maskHandle(handle)}`);
      continue;
    }

    const contactId = resolved.contactId;
    const marker = commentMarker(event.messageId, contactId);

    // Atomic claim: exactly one worker may hold a (message, contact) delivery.
    const { data: claimRows, error: claimError } = await admin.rpc('linq_claim_delivery', {
      p_message_id: event.messageId,
      p_contact_id: contactId,
      p_location_id: HPA_GHL_LOCATION_ID,
      p_chat_id: event.chatId,
      p_marker: marker,
      p_owner: owner,
      p_lease_seconds: DELIVERY_LEASE_SECONDS,
    });
    if (claimError) {
      out.failed++;
      out.retriable++;
      console.warn('[linq-bridge] claim failed');
      continue;
    }
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim?.claimed) {
      if (String(claim?.delivery_status) === 'posted') {
        out.matched++; // already logged — idempotent no-op
      } else {
        out.deferred++; // another worker holds a live lease
        out.retriable++;
      }
      continue;
    }
    const rowId = claim.delivery_id as string;
    const priorAttempts = Number(claim.attempts ?? 0);

    // A previous attempt of unknown outcome must be reconciled, not repeated.
    if (priorAttempts > 0 || claim.ghl_message_id) {
      const existing = await findPostedMarker(apiKey, contactId, marker);
      if (existing === undefined) {
        out.failed++;
        out.retriable++;
        await admin
          .from('linq_comment_deliveries')
          .update({ status: 'failed', last_error: 'marker_check_unavailable', lease_owner: null, lease_expires_at: null })
          .eq('id', rowId);
        continue;
      }
      if (existing) {
        out.matched++;
        await admin
          .from('linq_comment_deliveries')
          .update({
            status: 'posted',
            ghl_message_id: existing,
            posted_at: new Date().toISOString(),
            last_error: null,
            lease_owner: null,
            lease_expires_at: null,
          })
          .eq('id', rowId);
        continue;
      }
    }

    const comment = buildInternalComment({
      event,
      groupName,
      participants,
      contactId,
      reconciled: opts.reconciled,
    });
    const posted = await postInternalComment(apiKey, contactId, comment);
    if (posted.ok) {
      out.matched++;
      const { error: recordError } = await admin
        .from('linq_comment_deliveries')
        .update({
          status: 'posted',
          ghl_conversation_id: posted.conversationId,
          ghl_message_id: posted.messageId,
          posted_at: new Date().toISOString(),
          last_error: null,
          lease_owner: null,
          lease_expires_at: null,
        })
        .eq('id', rowId);
      if (recordError) {
        // The note exists in GHL; the marker lookup on the next pass will find
        // it and settle the row rather than posting it twice.
        console.warn('[linq-bridge] posted but failed to record delivery');
      }
    } else {
      out.failed++;
      if (posted.status >= 500 || posted.status === 429) out.retriable++;
      await admin
        .from('linq_comment_deliveries')
        .update({
          status: 'failed',
          attempts: priorAttempts + 1,
          last_error: posted.error,
          lease_owner: null,
          lease_expires_at: null,
        })
        .eq('id', rowId);
    }
  }

  return out;
}

type PipelineResult =
  | { kind: 'skipped'; reason: string; isGroup?: boolean }
  | { kind: 'failed'; code: string; httpStatus: number }
  | { kind: 'delivered'; outcome: DeliveryOutcome; participants: number };

/**
 * Shared gate + delivery pipeline used by the webhook and by reconciliation, so
 * both enforce group-only, org scope, owned-line presence, membership-at-time
 * and per-contact location identically.
 */
async function runPipeline(input: {
  event: LinqGroupMessage;
  config: any;
  token: string;
  apiKey: string;
  owner: string;
  reconciled?: boolean;
}): Promise<PipelineResult> {
  const { event, config, token, apiKey, owner } = input;

  const chat = await fetchLinqChat(event.chatId, token);
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

  const outcome = await deliverToParticipants(
    event,
    chat.displayName,
    participants,
    apiKey,
    owner,
    { reconciled: input.reconciled },
  );
  return { kind: 'delivered', outcome, participants: participants.length };
}

async function handleWebhook(req: Request, rawBody: string) {
  const { signing, token } = secrets();
  const missing: string[] = [];
  if (!signing) missing.push(LINQ_WEBHOOK_SECRET_ENV);
  if (!token) missing.push(LINQ_TOKEN_ENV);
  if (missing.length) {
    return json({ ok: false, code: 'configuration_error', missing_secrets: missing }, 503);
  }

  const verified = await verifyLinqSignature({
    secret: signing,
    webhookId: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signatureHeader: req.headers.get('webhook-signature'),
    rawBody,
  });
  if (!verified.ok) {
    console.warn(`[linq-bridge] signature rejected code=${verified.code}`);
    return json({ ok: false, code: 'signature_rejected', reason: verified.code }, 401);
  }

  let envelope: unknown = null;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, code: 'malformed_payload' }, 400);
  }

  const parsed = parseLinqEvent(envelope);
  const eventId =
    String((envelope as any)?.event_id ?? req.headers.get('webhook-id') ?? '').trim() ||
    crypto.randomUUID();
  const eventType = String((envelope as any)?.event_type ?? 'unknown');

  // Event ledger doubles as the webhook-level dedupe key.
  const { data: priorEvent } = await admin
    .from('linq_webhook_events')
    .select('id, status')
    .eq('linq_event_id', eventId)
    .maybeSingle();
  if (priorEvent && ['processed', 'skipped', 'disabled'].includes(String(priorEvent.status))) {
    return json({ ok: true, duplicate: true, status: priorEvent.status });
  }

  if (!parsed.ok) {
    await admin.from('linq_webhook_events').upsert(
      {
        linq_event_id: eventId,
        event_type: eventType,
        is_group: parsed.code === 'not_group' ? false : null,
        status: 'skipped',
        skipped_reason: parsed.code,
        processed_at: new Date().toISOString(),
      },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: true, skipped: parsed.code });
  }

  const event = parsed.event;
  const config = await loadConfig();
  const baseRow = {
    linq_event_id: eventId,
    event_type: event.eventType,
    linq_chat_id: event.chatId,
    linq_message_id: event.messageId,
    is_group: true,
  };

  if (!config || config.ingestion_enabled !== true) {
    await admin.from('linq_webhook_events').upsert(
      { ...baseRow, status: 'disabled', skipped_reason: 'ingestion_disabled', processed_at: new Date().toISOString() },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: true, skipped: 'ingestion_disabled' });
  }

  const target = await resolveHpaClient();
  if (!('client' in target)) {
    await admin.from('linq_webhook_events').upsert(
      { ...baseRow, status: 'failed', error: target.code },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: false, code: target.code, retriable: true }, 503);
  }

  const owner = `wh:${crypto.randomUUID()}`;
  const result = await runPipeline({
    event,
    config,
    token,
    apiKey: target.client.ghl_api_key,
    owner,
  });

  if (result.kind === 'skipped') {
    await admin.from('linq_webhook_events').upsert(
      {
        ...baseRow,
        ...(result.isGroup === false ? { is_group: false } : {}),
        status: 'skipped',
        skipped_reason: result.reason,
        processed_at: new Date().toISOString(),
      },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: true, skipped: result.reason });
  }
  if (result.kind === 'failed') {
    await admin.from('linq_webhook_events').upsert(
      { ...baseRow, status: 'failed', error: result.code },
      { onConflict: 'linq_event_id' },
    );
    // Retriable: Linq re-delivers, and every write is idempotent.
    return json({ ok: false, code: result.code, retriable: true }, result.httpStatus);
  }

  const outcome = result.outcome;
  await admin.from('linq_webhook_events').upsert(
    {
      ...baseRow,
      status: outcome.failed > 0 || outcome.deferred > 0 ? 'partial' : 'processed',
      participants_total: result.participants,
      participants_matched: outcome.matched,
      error: outcome.failed > 0 ? `${outcome.failed}_delivery_failures` : null,
      processed_at: outcome.failed > 0 || outcome.deferred > 0 ? null : new Date().toISOString(),
    },
    { onConflict: 'linq_event_id' },
  );
  await admin
    .from('linq_bridge_config')
    .update({ last_event_at: new Date().toISOString() })
    .eq('ghl_location_id', HPA_GHL_LOCATION_ID);

  console.log(
    `[linq-bridge] chat=${event.chatId} msg=${event.messageId} participants=${result.participants} matched=${outcome.matched} skipped=${outcome.skipped} failed=${outcome.failed} deferred=${outcome.deferred}`,
  );

  // Never silently 200 a dropped delivery: ask Linq to retry the whole event.
  if (outcome.retriable > 0) {
    return json({ ok: false, code: 'delivery_retriable', retriable: true, ...outcome, participants: result.participants }, 503);
  }
  return json({ ok: true, ...outcome, participants: result.participants });
}

/* ------------------------------------------------------------- operator ops */

/** Rebuild the full original note context from the authenticated Linq APIs. */
async function reconstructEvent(messageId: string, token: string, eventId: string, eventType?: string) {
  const message = await fetchLinqMessage(messageId, token);
  if (!message.ok) return { ok: false as const, code: `linq_message_${message.status}` };
  const chatId = String(message.message?.chat_id ?? '').trim();
  if (!chatId) return { ok: false as const, code: 'linq_message_chat_unknown' };
  const chat = await fetchLinqChat(chatId, token);
  if (!chat.ok) return { ok: false as const, code: `linq_chat_${chat.status}` };
  const built = buildEventFromResources({ message: message.message, chat: chat.chat, eventId, eventType });
  if (!built.ok) return { ok: false as const, code: built.code };
  return { ok: true as const, event: built.event };
}

async function handleOperator(req: Request, body: any) {
  const auth = await authorizeOperator(req, admin, createClient, body);
  if (!auth.ok) return json({ ok: false, code: auth.code, error: auth.error }, auth.status);

  const { signing, token } = secrets();
  const action = String(body?.action || 'status');

  if (action === 'status') {
    const config = await loadConfig();
    const target = await resolveHpaClient();
    const { data: recent } = await admin
      .from('linq_webhook_events')
      .select('status, skipped_reason, received_at, event_type, is_group, error')
      .order('received_at', { ascending: false })
      .limit(25);
    const { count: pending } = await admin
      .from('linq_comment_deliveries')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'failed']);
    return json({
      ok: true,
      config,
      secrets_present: { [LINQ_WEBHOOK_SECRET_ENV]: !!signing, [LINQ_TOKEN_ENV]: !!token },
      ghl_target: 'client' in target
        ? { client_name: target.client.name, location_id: target.client.ghl_location_id, credential_present: true }
        : { error: target.code },
      pending_or_failed_deliveries: pending ?? 0,
      recent_events: recent || [],
      linq_auth_note: LINQ_API_TOKEN_HEADER_NOTE,
    });
  }

  // Read-only probe: proves the stored HPA credential can search contacts in
  // the target location. Returns counts and flags only — never contact PII.
  if (action === 'verify_ghl_read') {
    const target = await resolveHpaClient();
    if (!('client' in target)) return json({ ok: false, code: target.code }, 503);
    const probe = String(body?.phone || OWNED_LINES_PROBE);
    const handle = toE164(probe) || OWNED_LINES_PROBE;
    const lookup = await ghlContactsByPhone(target.client.ghl_api_key, handle);
    if (!lookup.ok) {
      return json({ ok: false, code: 'ghl_read_failed', http_status: lookup.status }, 502);
    }
    const phoneMatches = lookup.contacts.filter((c: any) =>
      classifyContactMatch([c], handle, HPA_GHL_LOCATION_ID).status !== 'unmatched');
    const locations = new Set(
      lookup.contacts.map((c: any) => contactLocationStatus(c, HPA_GHL_LOCATION_ID)),
    );
    return json({
      ok: true,
      read_only: true,
      search_mode: lookup.mode,
      location_id: HPA_GHL_LOCATION_ID,
      contacts_returned: lookup.contacts.length,
      exact_e164_matches: phoneMatches.length,
      location_field_states: [...locations],
      client_name: target.client.name,
    });
  }

  if (action === 'set_ingestion') {
    const enabled = body?.enabled === true;
    if (enabled && (!signing || !token)) {
      return json({ ok: false, code: 'configuration_error', missing_secrets: [
        ...(signing ? [] : [LINQ_WEBHOOK_SECRET_ENV]),
        ...(token ? [] : [LINQ_TOKEN_ENV]),
      ] }, 503);
    }
    const { data, error } = await admin
      .from('linq_bridge_config')
      .update({ ingestion_enabled: enabled })
      .eq('ghl_location_id', HPA_GHL_LOCATION_ID)
      .select('ingestion_enabled')
      .maybeSingle();
    if (error) return json({ ok: false, code: 'update_failed' }, 500);
    return json({ ok: true, ingestion_enabled: data?.ingestion_enabled ?? enabled });
  }

  if (action === 'reconcile') {
    if (!signing || !token) return json({ ok: false, code: 'configuration_error' }, 503);
    const config = await loadConfig();
    if (!config || config.ingestion_enabled !== true) {
      // Reconciliation is a write path: it obeys the same ingestion gate.
      return json({ ok: false, code: 'ingestion_disabled' }, 409);
    }
    const target = await resolveHpaClient();
    if (!('client' in target)) return json({ ok: false, code: target.code }, 503);
    const apiKey = target.client.ghl_api_key;
    const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 100);
    const owner = `rc:${crypto.randomUUID()}`;

    let repaired = 0;
    let stillFailing = 0;
    let unrecoverable = 0;

    // 1. Retryable delivery rows, leased atomically so two reconcilers cannot
    //    post the same note. The note is rebuilt in full from the Linq APIs.
    const { data: rows, error: leaseError } = await admin.rpc('linq_claim_pending_deliveries', {
      p_owner: owner,
      p_limit: limit,
      p_lease_seconds: RECONCILE_LEASE_SECONDS,
    });
    if (leaseError) return json({ ok: false, code: 'lease_failed', retriable: true }, 503);

    const byMessage = new Map<string, any[]>();
    for (const row of rows || []) {
      const list = byMessage.get(row.linq_message_id) || [];
      list.push(row);
      byMessage.set(row.linq_message_id, list);
    }

    for (const [messageId, group] of byMessage) {
      const rebuilt = await reconstructEvent(messageId, token, `reconcile:${messageId}`);
      if (!rebuilt.ok) {
        const terminal = rebuilt.code.endsWith('_404') || rebuilt.code === 'not_group';
        for (const row of group) {
          await admin
            .from('linq_comment_deliveries')
            .update({
              status: terminal ? 'unrecoverable' : 'failed',
              last_error: rebuilt.code,
              lease_owner: null,
              lease_expires_at: null,
            })
            .eq('id', row.id);
        }
        if (terminal) unrecoverable += group.length;
        else stillFailing += group.length;
        continue;
      }

      const before = { repaired, stillFailing };
      const result = await runPipeline({
        event: rebuilt.event,
        config,
        token,
        apiKey,
        owner,
        reconciled: true,
      });
      if (result.kind === 'delivered') {
        repaired += result.outcome.matched;
        stillFailing += result.outcome.failed + result.outcome.deferred;
      } else if (result.kind === 'skipped') {
        // A gate now refuses the note: close the rows instead of writing.
        for (const row of group) {
          await admin
            .from('linq_comment_deliveries')
            .update({ status: 'unrecoverable', last_error: result.reason, lease_owner: null, lease_expires_at: null })
            .eq('id', row.id);
        }
        unrecoverable += group.length;
      } else {
        for (const row of group) {
          await admin
            .from('linq_comment_deliveries')
            .update({ status: 'failed', last_error: result.code, lease_owner: null, lease_expires_at: null })
            .eq('id', row.id);
        }
        stillFailing += group.length;
      }
      void before;
    }

    // 2. Events whose contact lookup failed before any delivery row existed.
    const { data: brokenEvents } = await admin
      .from('linq_webhook_events')
      .select('id, linq_event_id, event_type, linq_message_id, status')
      .in('status', ['failed', 'partial'])
      .not('linq_message_id', 'is', null)
      .order('received_at', { ascending: true })
      .limit(limit);

    let eventsReplayed = 0;
    let eventsStillFailing = 0;
    for (const evt of brokenEvents || []) {
      const rebuilt = await reconstructEvent(
        String(evt.linq_message_id),
        token,
        String(evt.linq_event_id),
        String(evt.event_type),
      );
      if (!rebuilt.ok) {
        eventsStillFailing++;
        await admin.from('linq_webhook_events').update({ error: rebuilt.code }).eq('id', evt.id);
        continue;
      }
      const result = await runPipeline({ event: rebuilt.event, config, token, apiKey, owner, reconciled: true });
      if (result.kind === 'delivered' && result.outcome.failed === 0 && result.outcome.deferred === 0) {
        eventsReplayed++;
        await admin
          .from('linq_webhook_events')
          .update({
            status: 'processed',
            participants_total: result.participants,
            participants_matched: result.outcome.matched,
            error: null,
            processed_at: new Date().toISOString(),
          })
          .eq('id', evt.id);
      } else if (result.kind === 'skipped') {
        await admin
          .from('linq_webhook_events')
          .update({ status: 'skipped', skipped_reason: result.reason, processed_at: new Date().toISOString() })
          .eq('id', evt.id);
      } else {
        eventsStillFailing++;
        await admin
          .from('linq_webhook_events')
          .update({ status: 'partial', error: result.kind === 'failed' ? result.code : 'delivery_failures' })
          .eq('id', evt.id);
      }
    }

    const anyOutstanding = stillFailing > 0 || eventsStillFailing > 0;
    return json(
      {
        ok: !anyOutstanding,
        deliveries_examined: (rows || []).length,
        repaired,
        still_failing: stillFailing,
        unrecoverable,
        events_examined: (brokenEvents || []).length,
        events_replayed: eventsReplayed,
        events_still_failing: eventsStillFailing,
        retriable: anyOutstanding,
      },
      anyOutstanding ? 503 : 200,
    );
  }

  return json({ ok: false, code: 'unknown_action' }, 400);
}

/** Probe handle for the read-only access check: one of our own lines. */
const OWNED_LINES_PROBE = '+14154980385';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const rawBody = await req.text();
    const isWebhook = !!req.headers.get('webhook-signature') || !!req.headers.get('webhook-id');
    if (isWebhook) return await handleWebhook(req, rawBody);
    let body: any = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return json({ ok: false, code: 'malformed_payload' }, 400);
    }
    return await handleOperator(req, body);
  } catch (e) {
    console.error('[linq-bridge] unhandled', (e as Error)?.name || 'error');
    return json({ ok: false, code: 'internal_error' }, 500);
  }
});
