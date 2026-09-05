/* linq-bridge */
/**
 * linq-bridge — receives signed Linq iMessage webhooks and appends the group
 * conversation to each matched HPA GHL contact as an InternalComment note.
 *
 * Hard guarantees:
 *  - Fails closed when LINQ_WEBHOOK_SECRET or LINQ_API_TOKEN is absent.
 *  - Ingestion is additionally gated by linq_bridge_config.ingestion_enabled,
 *    which ships DISABLED.
 *  - Writes only to GHL location ZcPPQTHBxBWlnM1WyjvU, using that client's
 *    existing server-side credential, and only after verifying the location.
 *  - Only `InternalComment` is ever posted. No SMS, no email, no contact create.
 *  - Group chats only; 1:1 chats are skipped with an operational status.
 *  - Durable idempotency per (linq_message_id, ghl_contact_id) so retried
 *    deliveries never duplicate a comment; failures stay retryable.
 *  - No raw message text, participant PII or credentials in console output.
 *
 * Operator surface (existing agency auth via authorizeOperator):
 *   { action: 'status' }              -> config + recent operational counters
 *   { action: 'set_ingestion', enabled: boolean }
 *   { action: 'reconcile', limit?: number } -> retry pending/failed deliveries
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders as sdkCors } from 'npm:@supabase/supabase-js@2/cors';
import { authorizeOperator } from '../_shared/operatorAuth.ts';
import {
  HPA_GHL_LOCATION_ID,
  LINQ_API_BASE,
  LINQ_API_TOKEN_HEADER_NOTE,
  LINQ_ORG_ID,
  LINQ_TOKEN_ENV,
  LINQ_WEBHOOK_SECRET_ENV,
  buildInternalComment,
  classifyContactMatch,
  isOwnedLine,
  maskHandle,
  parseLinqEvent,
  selectExternalParticipants,
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

async function fetchLinqChat(chatId: string, token: string) {
  const res = await fetch(`${LINQ_API_BASE}/chats/${encodeURIComponent(chatId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const body = await res.json().catch(() => null);
  const chat = body?.chat ?? body?.data ?? body;
  return {
    ok: true as const,
    displayName: chat?.display_name ? String(chat.display_name) : null,
    handles: Array.isArray(chat?.handles) ? chat.handles : [],
    isGroup: chat?.is_group,
    organizationId: chat?.organization_id ? String(chat.organization_id) : null,
  };
}

/* -------------------------------------------------------------------- GHL */

async function ghlContactsByPhone(apiKey: string, phone: string) {
  const res = await fetch(`${GHL_BASE_URL}/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ locationId: HPA_GHL_LOCATION_ID, phone, pageLimit: 10, page: 1 }),
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const body = await res.json().catch(() => ({}));
  const contacts = Array.isArray(body?.contacts) ? body.contacts : [];
  return { ok: true as const, contacts };
}

async function postInternalComment(apiKey: string, contactId: string, message: string) {
  const res = await fetch(`${GHL_BASE_URL}/conversations/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    // InternalComment only — never a deliverable channel.
    body: JSON.stringify({ type: 'InternalComment', contactId, message, mentions: [] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false as const, status: res.status, error: `ghl_${res.status}` };
  }
  return { ok: true as const, conversationId: body?.conversationId ?? null };
}

/* ------------------------------------------------------------- processing */

async function deliverToParticipants(
  event: LinqGroupMessage,
  groupName: string | null,
  participants: string[],
  apiKey: string,
): Promise<{ matched: number; skipped: number; failed: number }> {
  const comment = buildInternalComment({ event, groupName, participants });
  let matched = 0;
  let skipped = 0;
  let failed = 0;

  for (const handle of participants) {
    const lookup = await ghlContactsByPhone(apiKey, handle);
    if (!lookup.ok) {
      failed++;
      console.warn(`[linq-bridge] contact lookup failed status=${lookup.status} handle=${maskHandle(handle)}`);
      continue;
    }
    const match = classifyContactMatch(lookup.contacts, handle);
    if (match.status !== 'matched') {
      skipped++;
      console.log(`[linq-bridge] participant ${match.status} handle=${maskHandle(handle)}`);
      continue;
    }

    // Durable claim: a duplicate webhook delivery cannot create a second row.
    const { data: claimed, error: claimError } = await admin
      .from('linq_comment_deliveries')
      .upsert(
        {
          linq_message_id: event.messageId,
          ghl_contact_id: match.contactId,
          ghl_location_id: HPA_GHL_LOCATION_ID,
          linq_chat_id: event.chatId,
          status: 'pending',
        },
        { onConflict: 'linq_message_id,ghl_contact_id', ignoreDuplicates: true },
      )
      .select('id, status')
      .maybeSingle();
    if (claimError) {
      failed++;
      continue;
    }

    let rowId = claimed?.id as string | undefined;
    if (!rowId) {
      const { data: existing } = await admin
        .from('linq_comment_deliveries')
        .select('id, status')
        .eq('linq_message_id', event.messageId)
        .eq('ghl_contact_id', match.contactId)
        .maybeSingle();
      if (existing?.status === 'posted') {
        matched++;
        continue; // already logged — idempotent no-op
      }
      rowId = existing?.id;
    }
    if (!rowId) {
      failed++;
      continue;
    }

    const posted = await postInternalComment(apiKey, match.contactId, comment);
    if (posted.ok) {
      matched++;
      await admin
        .from('linq_comment_deliveries')
        .update({
          status: 'posted',
          ghl_conversation_id: posted.conversationId,
          posted_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', rowId);
    } else {
      failed++;
      const { data: current } = await admin
        .from('linq_comment_deliveries')
        .select('attempts')
        .eq('id', rowId)
        .maybeSingle();
      await admin
        .from('linq_comment_deliveries')
        .update({
          status: 'failed',
          attempts: (current?.attempts ?? 0) + 1,
          last_error: posted.error,
        })
        .eq('id', rowId);
    }
  }

  return { matched, skipped, failed };
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
    return json({ ok: false, code: target.code }, 503);
  }

  const chat = await fetchLinqChat(event.chatId, token);
  if (!chat.ok) {
    await admin.from('linq_webhook_events').upsert(
      { ...baseRow, status: 'failed', error: `linq_chat_${chat.status}` },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: false, code: 'linq_chat_unavailable' }, 502);
  }
  if (chat.isGroup === false) {
    await admin.from('linq_webhook_events').upsert(
      { ...baseRow, is_group: false, status: 'skipped', skipped_reason: 'not_group', processed_at: new Date().toISOString() },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: true, skipped: 'not_group' });
  }
  if (chat.organizationId && chat.organizationId !== String(config.linq_org_id || LINQ_ORG_ID)) {
    await admin.from('linq_webhook_events').upsert(
      { ...baseRow, status: 'skipped', skipped_reason: 'organization_out_of_scope', processed_at: new Date().toISOString() },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: true, skipped: 'organization_out_of_scope' });
  }

  const handles = chat.handles.length
    ? chat.handles
    : event.participantHandles.map((handle) => ({ handle }));

  // One of our owned lines must be in the thread, otherwise it is not our chat.
  const ownedPresent = handles.some((h: any) => isOwnedLine(h?.handle)) || isOwnedLine(event.senderHandle);
  if (!ownedPresent) {
    await admin.from('linq_webhook_events').upsert(
      { ...baseRow, status: 'skipped', skipped_reason: 'no_owned_line_in_chat', processed_at: new Date().toISOString() },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: true, skipped: 'no_owned_line_in_chat' });
  }

  const participants = selectExternalParticipants(handles);
  if (participants.length === 0) {
    await admin.from('linq_webhook_events').upsert(
      { ...baseRow, status: 'skipped', skipped_reason: 'no_external_participants', processed_at: new Date().toISOString() },
      { onConflict: 'linq_event_id' },
    );
    return json({ ok: true, skipped: 'no_external_participants' });
  }

  const result = await deliverToParticipants(event, chat.displayName, participants, target.client.ghl_api_key);

  await admin.from('linq_webhook_events').upsert(
    {
      ...baseRow,
      status: result.failed > 0 ? 'partial' : 'processed',
      participants_total: participants.length,
      participants_matched: result.matched,
      error: result.failed > 0 ? `${result.failed}_delivery_failures` : null,
      processed_at: new Date().toISOString(),
    },
    { onConflict: 'linq_event_id' },
  );
  await admin
    .from('linq_bridge_config')
    .update({ last_event_at: new Date().toISOString() })
    .eq('ghl_location_id', HPA_GHL_LOCATION_ID);

  console.log(
    `[linq-bridge] chat=${event.chatId} msg=${event.messageId} participants=${participants.length} matched=${result.matched} skipped=${result.skipped} failed=${result.failed}`,
  );

  // Non-2xx would make Linq retry; partial failures are retried by reconcile.
  return json({ ok: true, ...result, participants: participants.length });
}

/* ------------------------------------------------------------- operator ops */

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
      .select('status, skipped_reason, received_at, event_type, is_group')
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
    const target = await resolveHpaClient();
    if (!('client' in target)) return json({ ok: false, code: target.code }, 503);
    const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 100);
    const { data: rows } = await admin
      .from('linq_comment_deliveries')
      .select('id, linq_message_id, ghl_contact_id, attempts')
      .in('status', ['pending', 'failed'])
      .order('updated_at', { ascending: true })
      .limit(limit);

    let repaired = 0;
    let stillFailing = 0;
    for (const row of rows || []) {
      // The comment body is rebuilt from the durable event ledger only; if the
      // source event is gone the row is closed as unrecoverable, never guessed.
      const { data: evt } = await admin
        .from('linq_webhook_events')
        .select('linq_chat_id, event_type, received_at')
        .eq('linq_message_id', row.linq_message_id)
        .maybeSingle();
      if (!evt) {
        await admin
          .from('linq_comment_deliveries')
          .update({ status: 'unrecoverable', last_error: 'source_event_missing' })
          .eq('id', row.id);
        continue;
      }
      const message = [
        '[Linq group text — logged automatically, reconciled]',
        `Group chat ${evt.linq_chat_id}`,
        `Event: ${evt.event_type} at ${evt.received_at}`,
        `Linq message ${row.linq_message_id}`,
      ].join('\n');
      const posted = await postInternalComment(target.client.ghl_api_key, row.ghl_contact_id, message);
      if (posted.ok) {
        repaired++;
        await admin
          .from('linq_comment_deliveries')
          .update({ status: 'posted', ghl_conversation_id: posted.conversationId, posted_at: new Date().toISOString(), last_error: null })
          .eq('id', row.id);
      } else {
        stillFailing++;
        await admin
          .from('linq_comment_deliveries')
          .update({ status: 'failed', attempts: (row.attempts ?? 0) + 1, last_error: posted.error })
          .eq('id', row.id);
      }
    }
    return json({ ok: true, examined: (rows || []).length, repaired, still_failing: stillFailing });
  }

  return json({ ok: false, code: 'unknown_action' }, 400);
}

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
