// Agency Daily Reporting 5.0 — dedicated GHL SMS sender.
//
// This is the ONLY delivery path for the agency daily report SMS. It does not
// call send-ghl-message (whose plaintext caller password is deliberately not
// used here); it authenticates with authorizeDailyReportRun and talks to the
// GHL API directly using the agency PIT token.
//
// Durability contract:
//   - one agency_report_sends row per idempotency key
//     (destination / report_date / cadence / kind)
//   - one agency_report_send_chunks row per chunk, unique on (send_id, chunk_index)
//   - a retry only sends chunks that are not already provider-confirmed
//   - the send is marked `sent` only when EVERY chunk is provider-confirmed
//
// Tokens, location ids and phone numbers are never logged or returned.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeDailyReportRun } from '../_shared/dailyReportSecret.ts';
import { chunkSms, yesterdayLa } from '../_shared/agencyReport.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const KINDS = ['daily_report', 'routing_test'] as const;
type Kind = (typeof KINDS)[number];

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const mask = (v: string | null | undefined) =>
  !v ? null : `${v.slice(0, 3)}•••${v.slice(-2)}`;

const sha256 = async (value: string): Promise<string> => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json().catch(() => ({} as any));
  const url = new URL(req.url);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const presented = body.secret ?? req.headers.get('x-internal-secret') ?? url.searchParams.get('secret') ?? null;
  if (!(await authorizeDailyReportRun(sb, presented))) return json({ error: 'unauthorized' }, 401);

  const dryRun = body.dry_run === true;
  const cadence = typeof body.cadence === 'string' ? body.cadence : 'daily';
  const kind: Kind = KINDS.includes(body.kind) ? body.kind : 'daily_report';
  const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.report_date ?? '')) ? body.report_date : yesterdayLa();

  const token = Deno.env.get('AGENCY_GHL_PIT_TOKEN') || Deno.env.get('AGENCY_GHL_API_KEY') || '';
  const locationId = Deno.env.get('AGENCY_GHL_LOCATION_ID') || '';

  try {
    /* ── destination ────────────────────────────────────────────────────────── */
    const { data: dest } = await sb
      .from('agency_report_destinations')
      .select('id, name, channel, phone_e164, contact_name, cadences, active')
      .eq('channel', 'sms')
      .eq('active', true)
      .contains('cadences', [cadence])
      .order('created_at')
      .limit(1)
      .maybeSingle();

    const configuration = {
      ghl_token_present: !!token,
      ghl_location_present: !!locationId,
      destination_found: !!dest,
      destination_name: dest?.name ?? null,
      destination_phone: mask(dest?.phone_e164),
      cadence,
      kind,
    };

    if (!dest) return json({ ok: false, skipped: 'no_active_sms_destination', configuration }, dryRun ? 200 : 424);
    if (!token || !locationId) {
      return json({ ok: false, skipped: 'ghl_not_configured', configuration }, dryRun ? 200 : 424);
    }

    /* ── message ────────────────────────────────────────────────────────────── */
    const text = kind === 'routing_test'
      ? `TEST — HPA Agency Daily Reporting routing check (${reportDate}). This is a TEST message and contains no performance metrics. No action needed.`
      : String(body.text ?? '').trim();
    if (!text) return json({ ok: false, error: 'empty_message', configuration }, 400);

    const chunks = chunkSms(text);

    /* ── idempotent send row ────────────────────────────────────────────────── */
    const idempotencyKey = `${dest.id}:${reportDate}:${cadence}:${kind}`;
    const { data: existing } = await sb
      .from('agency_report_sends')
      .select('id, status, chunk_count, sent_chunk_count, sent_at')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existing?.status === 'sent') {
      return json({
        ok: true, sent: true, already_sent: true, status: 'sent',
        send_id: existing.id, chunk_count: existing.chunk_count,
        confirmed: existing.sent_chunk_count, idempotency_key: idempotencyKey, configuration,
      });
    }

    if (dryRun) {
      // Validate the contact lookup/upsert path without sending anything.
      let contactOk = false; let contactError: string | null = null;
      try {
        const contactId = await upsertContact(token, locationId, dest.phone_e164!, dest.contact_name || 'Zac');
        contactOk = !!contactId;
      } catch (e) {
        contactError = String((e as Error)?.message || e).slice(0, 200);
      }
      return json({
        ok: contactOk, dry_run: true, sent: false,
        chunk_count: chunks.length,
        chunk_chars: chunks.map((c) => c.length),
        chars: text.length,
        idempotency_key: idempotencyKey,
        contact_path_ok: contactOk, contact_error: contactError,
        prior_status: existing?.status ?? null,
        configuration,
      });
    }

    let sendId = existing?.id ?? null;
    if (!sendId) {
      const { data: created, error: insErr } = await sb
        .from('agency_report_sends')
        .insert({
          destination_id: dest.id, report_date: reportDate, cadence,
          status: 'sending', idempotency_key: idempotencyKey,
          payload: { kind, chars: text.length, chunk_count: chunks.length },
          chunk_count: chunks.length, queued_at: new Date().toISOString(),
        })
        .select('id')
        .maybeSingle();
      if (insErr || !created) {
        const { data: raced } = await sb.from('agency_report_sends')
          .select('id, status').eq('idempotency_key', idempotencyKey).maybeSingle();
        if (!raced) return json({ ok: false, error: insErr?.message ?? 'send row insert failed' }, 500);
        if (raced.status === 'sent') return json({ ok: true, sent: true, already_sent: true, send_id: raced.id, configuration });
        sendId = raced.id;
      } else {
        sendId = created.id;
      }
    } else {
      await sb.from('agency_report_sends')
        .update({ status: 'sending', chunk_count: chunks.length, error: null })
        .eq('id', sendId);
    }

    const chunkPayload = await Promise.all(chunks.map(async (c, i) => ({
      send_id: sendId,
      chunk_index: i,
      chunk_count: chunks.length,
      chars: c.length,
      message_text: c,
      message_hash: await sha256(c),
    })));
    await sb.from('agency_report_send_chunks').upsert(
      chunkPayload,
      { onConflict: 'send_id,chunk_index', ignoreDuplicates: true },
    );

    const { data: chunkRows } = await sb
      .from('agency_report_send_chunks')
      .select('id, chunk_index, status, provider_message_id, message_text, message_hash, claimed_at')
      .eq('send_id', sendId)
      .order('chunk_index');

    if ((chunkRows?.length ?? 0) !== chunks.length) {
      throw new Error(`chunk ledger mismatch: expected ${chunks.length}, found ${chunkRows?.length ?? 0}`);
    }

    for (const row of chunkRows ?? []) {
      const expected = chunkPayload[row.chunk_index];
      if (!expected) throw new Error(`unexpected chunk index ${row.chunk_index}`);
      if (row.message_hash && row.message_hash !== expected.message_hash) {
        throw new Error(`idempotency conflict: chunk ${row.chunk_index} content changed`);
      }
      if (!row.message_hash) {
        await sb.from('agency_report_send_chunks').update({
          message_text: expected.message_text,
          message_hash: expected.message_hash,
        }).eq('id', row.id).is('message_hash', null);
        row.message_text = expected.message_text;
        row.message_hash = expected.message_hash;
      }
    }

    const contactId = await upsertContact(token, locationId, dest.phone_e164!, dest.contact_name || 'Zac');
    if (!contactId) throw new Error('contact upsert returned no id');

    const messageIds: string[] = [];
    let confirmed = 0; let failure: string | null = null;

    for (const row of chunkRows ?? []) {
      if (row.status === 'sent' && row.provider_message_id) {
        confirmed++; messageIds.push(row.provider_message_id);
        continue; // a partial retry never re-sends a confirmed chunk
      }
      const chunkText = row.message_text ?? chunks[row.chunk_index];
      if (chunkText === undefined) continue;
      // Atomic per-chunk claim. A concurrent invocation cannot send the same
      // unconfirmed chunk unless the prior claim has been stale for 3 minutes.
      const claimToken = crypto.randomUUID();
      const staleBefore = new Date(Date.now() - 3 * 60_000).toISOString();
      const { data: claimed, error: claimError } = await sb
        .from('agency_report_send_chunks')
        .update({ status: 'sending', claim_token: claimToken, claimed_at: new Date().toISOString(), error: null })
        .eq('id', row.id)
        .neq('status', 'sent')
        .or(`claimed_at.is.null,claimed_at.lt.${staleBefore}`)
        .select('id')
        .maybeSingle();
      if (claimError || !claimed) {
        failure = claimError?.message ?? `chunk ${row.chunk_index} is already claimed`;
        break;
      }
      try {
        const messageId = await sendSms(token, contactId, dest.phone_e164!, chunkText);
        await sb.from('agency_report_send_chunks').update({
          status: 'sent', provider_message_id: messageId, error: null,
          sent_at: new Date().toISOString(), claim_token: null, claimed_at: null,
        }).eq('id', row.id).eq('claim_token', claimToken);
        confirmed++; messageIds.push(messageId);
      } catch (e) {
        failure = String((e as Error)?.message || e).slice(0, 300);
        await sb.from('agency_report_send_chunks').update({
          status: 'failed', error: failure, claim_token: null, claimed_at: null,
        }).eq('id', row.id).eq('claim_token', claimToken);
        break; // preserve ordering; the next run resumes from this chunk
      }
    }

    // Re-read the authoritative ledger so a concurrent invocation that
    // completed between our snapshot and claim attempt cannot be overwritten
    // from `sent` back to `failed`.
    const { data: finalChunkRows } = await sb.from('agency_report_send_chunks')
      .select('status, provider_message_id')
      .eq('send_id', sendId);
    confirmed = (finalChunkRows ?? []).filter((r) => r.status === 'sent' && !!r.provider_message_id).length;
    messageIds.splice(0, messageIds.length, ...(finalChunkRows ?? [])
      .filter((r) => r.status === 'sent' && !!r.provider_message_id)
      .map((r) => r.provider_message_id));
    const allConfirmed = confirmed === chunks.length && chunks.length > 0;
    await sb.from('agency_report_sends').update({
      status: allConfirmed ? 'sent' : 'failed',
      sent_chunk_count: confirmed,
      wa_message_ids: messageIds,
      error: allConfirmed ? null : (failure ?? 'not all chunks confirmed'),
      sent_at: allConfirmed ? new Date().toISOString() : null,
    }).eq('id', sendId);

    console.log('[agency-ghl-report-send]', JSON.stringify({
      report_date: reportDate, cadence, kind,
      chunk_count: chunks.length, confirmed, sent: allConfirmed,
    }));

    return json({
      ok: allConfirmed, sent: allConfirmed, status: allConfirmed ? 'sent' : 'failed',
      send_id: sendId, chunk_count: chunks.length, confirmed,
      idempotency_key: idempotencyKey, error: allConfirmed ? null : failure, configuration,
    }, allConfirmed ? 200 : 502);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});

/* ── GHL primitives ────────────────────────────────────────────────────────── */

async function ghl(token: string, path: string, init: RequestInit) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!res.ok) throw new Error(`GHL ${res.status}: ${String(raw).slice(0, 300)}`);
  return data;
}

async function upsertContact(token: string, locationId: string, phone: string, name: string): Promise<string | null> {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  const data = await ghl(token, '/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify({
      locationId, phone, firstName: firstName || 'Zac',
      lastName: rest.join(' ') || undefined,
    }),
  });
  return data?.contact?.id || data?.id || null;
}

async function sendSms(token: string, contactId: string, phone: string, message: string): Promise<string> {
  const data = await ghl(token, '/conversations/messages', {
    method: 'POST',
    body: JSON.stringify({ type: 'SMS', contactId, message, toNumber: phone }),
  });
  const id = data?.messageId || data?.msgId || data?.id;
  if (!id) throw new Error('GHL accepted the request but returned no message id');
  return String(id);
}
