/* linq-bridge */
/**
 * linq-bridge — receives signed Linq iMessage webhooks and appends the group
 * conversation to each matched HPA GHL contact as an InternalComment note.
 *
 * Hard guarantees:
 *  - Fails closed when LINQ_WEBHOOK_SECRET or LINQ_API_TOKEN is absent.
 *  - Ingestion is additionally gated by linq_bridge_config.ingestion_enabled,
 *    which ships DISABLED — webhook and reconcile alike.
 *  - Writes only to GHL location ZcPPQTHBxBWlnM1WyjvU, using that client's
 *    existing server-side credential, and only after verifying that the target
 *    contact's own locationId is that location.
 *  - Only `InternalComment` is ever posted. No SMS, no email, no contact create.
 *  - Group chats only; 1:1 chats are skipped with an operational status.
 *  - Per (message, contact) claims are leased atomically in Postgres
 *    (linq_claim_delivery), so concurrent deliveries can never both post the
 *    same note; stale leases are recovered automatically.
 *  - Every note carries a stable marker; before re-posting after an uncertain
 *    outcome the contact's thread is read for that marker, so a POST that
 *    succeeded but failed to record is reconciled instead of duplicated.
 *  - Transient failures return a retriable status; a dropped message is never
 *    silently 200'd.
 *  - No raw message text, participant PII or credentials in console output.
 *
 * Operator surface (existing agency auth via authorizeOperator):
 *   { action: 'status' }
 *   { action: 'verify_ghl_read', phone?: string }  -> read-only GHL access probe
 *   { action: 'set_ingestion', enabled: boolean }
 *   { action: 'reconcile', limit?: number }        -> replays leased deliveries
 *                                                     AND failed/partial events
 */
import { createClient } from 'npm:@supabase/supabase-js@2.115.0';
import { corsHeaders as sdkCors } from 'npm:@supabase/supabase-js@2.115.0/cors';
import { authorizeOperator } from '../_shared/operatorAuth.ts';
import {
  HPA_GHL_LOCATION_ID,
  LINQ_API_TOKEN_HEADER_NOTE,
  LINQ_TOKEN_ENV,
  LINQ_WEBHOOK_SECRET_ENV,
  OWNED_LINES,
  RECONCILE_LEASE_SECONDS,
  parseLinqEvent,
  verifyLinqSignature,
} from '../_shared/linqBridge.ts';
import {
  ghlReadProbe,
  reconstructEvent,
  runPipeline,
  type DeliveryClaim,
  type LinqDeps,
} from '../_shared/linqDelivery.ts';

const corsHeaders = {
  ...sdkCors,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
};

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

/** Wire the pure delivery core to the real database and network. */
function buildDeps(ghlApiKey: string, linqToken: string): LinqDeps {
  return {
    fetch: (...args) => fetch(...(args as Parameters<typeof fetch>)),
    ghlApiKey,
    linqToken,
    async claimDelivery(input) {
      const { data, error } = await admin.rpc('linq_claim_delivery', {
        p_message_id: input.messageId,
        p_contact_id: input.contactId,
        p_location_id: HPA_GHL_LOCATION_ID,
        p_chat_id: input.chatId,
        p_marker: input.marker,
        p_owner: input.owner,
        p_lease_seconds: input.leaseSeconds,
      });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      const claim: DeliveryClaim = {
        claimed: row.claimed === true,
        deliveryId: row.delivery_id ?? null,
        status: row.delivery_status ?? null,
        attempts: Number(row.attempts ?? 0),
        ghlMessageId: row.ghl_message_id ?? null,
      };
      return claim;
    },
    async updateDelivery(deliveryId, patch) {
      const { error } = await admin.from('linq_comment_deliveries').update(patch).eq('id', deliveryId);
      return { ok: !error };
    },
    log: (line) => console.log(line),
  };
}

/* ------------------------------------------------------------------ webhook */

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

  const deps = buildDeps(target.client.ghl_api_key, token);
  const result = await runPipeline(deps, { event, config, owner: `wh:${crypto.randomUUID()}` });

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
  const outstanding = outcome.failed > 0 || outcome.deferred > 0;
  await admin.from('linq_webhook_events').upsert(
    {
      ...baseRow,
      status: outstanding ? 'partial' : 'processed',
      participants_total: result.participants,
      participants_matched: outcome.matched,
      error: outcome.failed > 0 ? `${outcome.failed}_delivery_failures` : null,
      processed_at: outstanding ? null : new Date().toISOString(),
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
    return json(
      { ok: false, code: 'delivery_retriable', retriable: true, ...outcome, participants: result.participants },
      503,
    );
  }
  return json({ ok: true, ...outcome, participants: result.participants });
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

  // Read-only probe: proves the stored HPA credential can search contacts in the
  // target location. Returns counts and flags only — never contact PII.
  if (action === 'verify_ghl_read') {
    const target = await resolveHpaClient();
    if (!('client' in target)) return json({ ok: false, code: target.code }, 503);
    const deps = buildDeps(target.client.ghl_api_key, token);
    const probe = await ghlReadProbe(deps, String(body?.phone || OWNED_LINES[0]));
    if (!probe.ok) return json({ ...probe, client_name: target.client.name }, 502);
    return json({ ...probe, client_name: target.client.name });
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
    const deps = buildDeps(target.client.ghl_api_key, token);
    const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 100);
    const owner = `rc:${crypto.randomUUID()}`;

    let repaired = 0;
    let stillFailing = 0;
    let unrecoverable = 0;

    // 1. Retryable delivery rows, leased atomically so two reconcilers cannot
    //    post the same note. Notes are rebuilt in full from the Linq APIs.
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

    const closeRows = async (group: any[], status: string, error: string) => {
      for (const row of group) {
        await admin
          .from('linq_comment_deliveries')
          .update({ status, last_error: error, lease_owner: null, lease_expires_at: null })
          .eq('id', row.id);
      }
    };

    for (const [messageId, group] of byMessage) {
      const rebuilt = await reconstructEvent(deps, messageId, `reconcile:${messageId}`);
      if (!rebuilt.ok) {
        const terminal = rebuilt.code.endsWith('_404') || rebuilt.code === 'not_group';
        await closeRows(group, terminal ? 'unrecoverable' : 'failed', rebuilt.code);
        if (terminal) unrecoverable += group.length;
        else stillFailing += group.length;
        continue;
      }

      const result = await runPipeline(deps, { event: rebuilt.event, config, owner, reconciled: true });
      if (result.kind === 'delivered') {
        repaired += result.outcome.matched;
        stillFailing += result.outcome.failed + result.outcome.deferred;
      } else if (result.kind === 'skipped') {
        // A gate now refuses the note: close the rows instead of writing.
        await closeRows(group, 'unrecoverable', result.reason);
        unrecoverable += group.length;
      } else {
        await closeRows(group, 'failed', result.code);
        stillFailing += group.length;
      }
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
        deps,
        String(evt.linq_message_id),
        String(evt.linq_event_id),
        String(evt.event_type),
      );
      if (!rebuilt.ok) {
        eventsStillFailing++;
        await admin.from('linq_webhook_events').update({ error: rebuilt.code }).eq('id', evt.id);
        continue;
      }
      const result = await runPipeline(deps, { event: rebuilt.event, config, owner, reconciled: true });
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
