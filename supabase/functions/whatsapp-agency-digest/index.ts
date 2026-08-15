// Reporting 5.0 — agency WhatsApp digest delivery.
//
// Internal-only (same secret as daily-report-run). Responsibilities:
//   sync_groups    → pull authoritative group subjects from the whatsmeow bridge
//   resolve_target → match ONE exact group subject and store the agency target
//   send_test      → single harmless routing test to the stored target
//   send_digest    → ONE consolidated digest for a report date (chunked if long)
//
// Guarantees: the group JID is never returned in a response or logged; a send is
// only ever marked `sent` when the bridge confirms it; delivery is idempotent on
// (target, cadence, digest_date, kind); bridge failures fall back to the durable
// whatsapp_send_queue which whatsapp-queue-drain retries with backoff.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeDailyReportRun } from '../_shared/dailyReportSecret.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

const CHUNK_LIMIT = 3500; // WhatsApp text messages cap out around 4096 chars.
const TZ = 'America/Los_Angeles';

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const redact = (jid: string) => `…${jid.slice(-6)}`;

type BridgeResult = { ok: boolean; status: number; body: any; error: string | null };

async function callBridge(path: string, method: 'GET' | 'POST', body?: unknown, timeoutMs = 15_000): Promise<BridgeResult> {
  const url = Deno.env.get('WHATSAPP_BRIDGE_URL');
  const token = Deno.env.get('WHATSAPP_BRIDGE_TOKEN');
  if (!url || !token) return { ok: false, status: 0, body: null, error: 'bridge not configured' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { ok: res.ok, status: res.status, body: parsed, error: res.ok ? null : `bridge ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: `bridge unreachable: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

function chunk(text: string, limit = CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const lines = text.split('\n');
  const out: string[] = [];
  let buf = '';
  for (const line of lines) {
    if ((buf + '\n' + line).length > limit && buf) { out.push(buf); buf = line; }
    else buf = buf ? `${buf}\n${line}` : line;
  }
  if (buf) out.push(buf);
  return out.map((c, i) => (out.length > 1 ? `(${i + 1}/${out.length})\n${c}` : c));
}

const money = (n: number) =>
  `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: Number(n) >= 100 ? 0 : 2 })}`;

/** Digest text is presentation only — every number comes from the stored run. */
function buildDigest(reportDate: string, runs: any[]): string {
  const head = [
    '*High Performance — Daily Agency Report*',
    `${reportDate} (${TZ})`,
  ];
  const totals = { spend: 0, leads: 0, booked: 0, showed: 0, reconnects: 0, commitments: 0, funded: 0, fundedDollars: 0 };
  const lines: string[] = [];
  const flagged: string[] = [];
  const missing: string[] = [];

  for (const run of runs) {
    const name = run.client_name || 'Unknown client';
    const f = run.report_json?.funnel;
    if (!f) { missing.push(`${name} — no report data`); continue; }
    const spend = Number(f.ads?.spend || 0);
    const leads = Number(f.leads?.total || 0);
    const cpl = Number(f.ads?.cost_per_lead || 0);
    const d = f.discovery_calls ?? {};
    const r = f.reconnect_calls ?? {};
    const c = f.commitments ?? {};
    const w = f.funded_wire ?? {};
    totals.spend += spend; totals.leads += leads;
    totals.booked += Number(d.booked || 0); totals.showed += Number(d.showed || 0);
    totals.reconnects += Number(r.booked || 0);
    totals.commitments += Number(c.count || 0);
    totals.funded += Number(w.count || 0); totals.fundedDollars += Number(w.dollars || 0);

    const critical = (run.anomalies ?? []).filter((a: any) => a.severity === 'critical');
    const warnings = (run.anomalies ?? []).filter((a: any) => a.severity === 'warning');
    const badge = run.validation_passed === false ? ' ⚠️ data not validated' : (critical.length ? ' ⚠️' : '');
    lines.push(
      `*${name}*${badge}\n` +
      `• Spend ${money(spend)} · Leads ${leads} · CPL ${leads ? money(cpl) : 'n/a'}\n` +
      `• Discovery ${d.booked ?? 0} booked / ${d.showed ?? 0} showed (${d.show_rate ?? 'n/a'}%)\n` +
      `• Reconnects ${r.booked ?? 0} booked / ${r.showed ?? 0} showed\n` +
      `• Commitments ${c.count ?? 0} (${money(c.dollars || 0)}) · Funded ${w.count ?? 0} (${money(w.dollars || 0)})`,
    );
    if (run.validation_passed === false || critical.length) {
      flagged.push(`• ${name}: ${(critical.length ? critical : warnings).slice(0, 3).map((a: any) => a.code).join(', ') || 'validation failed'}`);
    }
  }

  const body = [
    ...head,
    '',
    `*Agency totals* — Spend ${money(totals.spend)} · Leads ${totals.leads} · CPL ${totals.leads ? money(totals.spend / totals.leads) : 'n/a'}`,
    `Discovery ${totals.booked} booked / ${totals.showed} showed · Reconnects ${totals.reconnects} · Commitments ${totals.commitments} · Funded ${totals.funded} (${money(totals.fundedDollars)})`,
    '',
    ...(lines.length ? lines : ['No client reports were produced for this date.']),
  ];
  if (flagged.length) body.push('', '*Data quality flags*', ...flagged);
  if (missing.length) body.push('', '*No data*', ...missing.map((m) => `• ${m}`));
  body.push('', 'Numbers are DB-calculated. Flagged clients failed validation and should not be quoted externally.');
  return body.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json().catch(() => ({} as any));
  const url = new URL(req.url);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const presented = body.secret ?? req.headers.get('x-internal-secret') ?? url.searchParams.get('secret') ?? null;
  if (!(await authorizeDailyReportRun(sb, presented))) return json({ error: 'unauthorized' }, 401);

  const action = String(body.action ?? '');
  const sessionLabel = String(body.session_label ?? 'default');

  const syncGroups = async () => {
    const r = await callBridge('/groups', 'GET');
    if (!r.ok) {
      const unsupported = r.status === 404 || r.status === 405;
      return { ok: false, unsupported, status: r.status, error: r.error, synced: 0 };
    }
    const groups: any[] = Array.isArray(r.body?.groups) ? r.body.groups : [];
    const { data: session } = await sb.from('whatsapp_sessions').select('id').eq('label', sessionLabel).maybeSingle();
    let synced = 0;
    for (const g of groups) {
      if (!g?.jid || typeof g.subject !== 'string') continue;
      const { error } = await sb.from('whatsapp_groups').upsert({
        session_id: session?.id ?? null,
        session_label: sessionLabel,
        jid: g.jid,
        subject: g.subject,
        participant_count: Number(g.participant_count || 0) || null,
        is_announce: !!g.is_announce,
        subject_set_at: g.subject_set_at ?? null,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'session_label,jid' });
      if (!error) synced++;
    }
    return { ok: true, unsupported: false, status: r.status, error: null, synced, total: groups.length };
  };

  /** Sends the chunks; queues whatever the bridge would not confirm. */
  const sendChunks = async (target: any, chunks: string[], meta: Record<string, unknown>) => {
    const ids: string[] = [];
    const queued: string[] = [];
    let lastError: string | null = null;
    const { data: session } = await sb.from('whatsapp_sessions').select('id, status').eq('label', target.session_label).maybeSingle();
    for (let i = 0; i < chunks.length; i++) {
      const message = chunks[i];
      const r = await callBridge('/send', 'POST', { session_label: target.session_label, jid: target.destination, message }, 25_000);
      const waId = typeof r.body?.wa_message_id === 'string' ? r.body.wa_message_id : null;
      if (r.ok && waId) { ids.push(waId); continue; }
      lastError = r.error ?? 'bridge did not confirm the message id';
      const { data: q } = await sb.from('whatsapp_send_queue').insert({
        session_id: session?.id ?? null,
        jid: target.destination,
        message,
        source: 'agency_digest',
        status: 'pending',
        last_error: lastError,
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        metadata: { ...meta, chunk: i + 1, chunk_count: chunks.length },
      }).select('id').maybeSingle();
      if (q?.id) queued.push(q.id);
    }
    return { ids, queued, lastError };
  };

  /** Claim-then-send. The unique idempotency key makes the duplicate DST cron a no-op. */
  const deliver = async (opts: { target: any; cadence: string; digestDate: string; kind: string; text: string; force?: boolean }) => {
    const idem = `agency:${opts.cadence}:${opts.digestDate}:${opts.target.id}:${opts.kind}`;
    await sb.from('agency_digest_sends').upsert({
      target_id: opts.target.id, cadence: opts.cadence, digest_date: opts.digestDate,
      kind: opts.kind, idempotency_key: idem, status: 'pending',
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });

    const { data: row } = await sb.from('agency_digest_sends').select('*').eq('idempotency_key', idem).single();
    if (row.status === 'sent' && !opts.force) {
      return { delivered: false, skipped: 'already sent', send_id: row.id, status: 'sent' };
    }
    const claimQuery = sb.from('agency_digest_sends')
      .update({ status: 'sending', attempts: (row.attempts ?? 0) + 1 })
      .eq('id', row.id);
    const { data: claimed } = await (opts.force ? claimQuery : claimQuery.in('status', ['pending', 'failed', 'queued']))
      .select('id').maybeSingle();
    if (!claimed) return { delivered: false, skipped: `not claimable (status ${row.status})`, send_id: row.id, status: row.status };

    const chunks = chunk(opts.text);
    const { ids, queued, lastError } = await sendChunks(opts.target, chunks, { kind: opts.kind, digest_date: opts.digestDate, send_id: row.id });
    const status = ids.length === chunks.length ? 'sent' : (queued.length ? 'queued' : 'failed');
    await sb.from('agency_digest_sends').update({
      status,
      chunk_count: chunks.length,
      wa_message_ids: ids,
      queued_ids: queued,
      last_error: lastError,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      payload: { chunk_count: chunks.length, confirmed: ids.length, chars: opts.text.length },
    }).eq('id', row.id);
    return {
      delivered: status === 'sent', status, send_id: row.id,
      chunks: chunks.length, confirmed: ids.length, queued: queued.length,
      error: lastError,
    };
  };

  const getTarget = async () => {
    const { data } = await sb.from('agency_digest_targets')
      .select('*').eq('channel', 'whatsapp_group').eq('session_label', sessionLabel)
      .order('created_at').limit(1).maybeSingle();
    return data;
  };

  try {
    switch (action) {
      case 'sync_groups': {
        const s = await syncGroups();
        const { count } = await sb.from('whatsapp_groups').select('*', { count: 'exact', head: true }).eq('session_label', sessionLabel);
        return json({ ...s, stored_groups: count ?? 0 });
      }

      case 'resolve_target': {
        const subject = String(body.subject ?? '').trim();
        if (!subject) return json({ error: 'subject required' }, 400);
        const sync = await syncGroups();
        const { data: matches } = await sb.from('whatsapp_groups')
          .select('id, jid, subject, participant_count')
          .eq('session_label', sessionLabel).eq('subject', subject);
        if (!matches || matches.length === 0) {
          return json({ resolved: false, reason: 'no group with that exact subject', sync }, 200);
        }
        if (matches.length > 1) {
          return json({ resolved: false, reason: `${matches.length} groups share that exact subject — ambiguous`, sync }, 200);
        }
        const g = matches[0];
        const { data: target, error } = await sb.from('agency_digest_targets').upsert({
          name: subject,
          channel: 'whatsapp_group',
          destination: g.jid,
          session_label: sessionLabel,
          enabled: body.enabled === true,
          cadences: Array.isArray(body.cadences) && body.cadences.length ? body.cadences : ['daily'],
          resolved_at: new Date().toISOString(),
          notes: 'Resolved from bridge joined-group subjects.',
        }, { onConflict: 'channel,destination,session_label' }).select('id, name, enabled, cadences, session_label').single();
        if (error) return json({ error: error.message }, 500);
        return json({ resolved: true, target, participants: g.participant_count, sync });
      }

      case 'target_get': {
        const t = await getTarget();
        if (!t) return json({ target: null });
        return json({ target: { id: t.id, name: t.name, enabled: t.enabled, cadences: t.cadences, session_label: t.session_label, resolved_at: t.resolved_at, destination_hint: redact(t.destination) } });
      }

      case 'target_set_enabled': {
        const t = await getTarget();
        if (!t) return json({ error: 'no target resolved yet' }, 400);
        const { data } = await sb.from('agency_digest_targets')
          .update({ enabled: body.enabled === true }).eq('id', t.id)
          .select('id, name, enabled').single();
        return json({ target: data });
      }

      case 'send_test': {
        const t = await getTarget();
        if (!t) return json({ error: 'no target resolved yet' }, 400);
        const text = String(body.message ?? 'Reporting 5.0 test — WhatsApp daily report routing is connected. No client report was sent.');
        const res = await deliver({
          target: t, cadence: 'test', kind: 'routing_test',
          digestDate: body.digest_date || new Date().toISOString().slice(0, 10),
          text, force: body.force === true,
        });
        return json({ ...res, target_name: t.name, destination_hint: redact(t.destination) });
      }

      case 'send_digest': {
        const digestDate = String(body.digest_date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(digestDate)) return json({ error: 'digest_date (YYYY-MM-DD) required' }, 400);
        const cadence = String(body.cadence ?? 'daily');
        const t = await getTarget();
        if (!t) return json({ sent: false, reason: 'no agency WhatsApp target resolved' });
        if (!t.enabled && body.force !== true) return json({ sent: false, reason: 'target disabled' });
        if (!(t.cadences ?? []).includes(cadence) && body.force !== true) return json({ sent: false, reason: `target not subscribed to ${cadence}` });

        const { data: runs, error } = await sb
          .from('daily_report_runs')
          .select('client_id, report_json, anomalies, validation_passed, status, clients(name, status)')
          .eq('report_date', digestDate);
        if (error) return json({ error: error.message }, 500);
        const rows = (runs ?? [])
          .map((r: any) => ({ ...r, client_name: r.clients?.name, client_status: r.clients?.status }))
          .filter((r: any) => ['active', 'onboarding'].includes(r.client_status ?? ''))
          .sort((a: any, b: any) => Number(b.report_json?.funnel?.ads?.spend || 0) - Number(a.report_json?.funnel?.ads?.spend || 0));

        const text = buildDigest(digestDate, rows);
        const res = await deliver({ target: t, cadence, kind: 'daily_digest', digestDate, text, force: body.force === true });
        return json({ ...res, clients_included: rows.length, chars: text.length, target_name: t.name, destination_hint: redact(t.destination) });
      }

      case 'preview_digest': {
        const digestDate = String(body.digest_date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(digestDate)) return json({ error: 'digest_date (YYYY-MM-DD) required' }, 400);
        const { data: runs } = await sb
          .from('daily_report_runs')
          .select('client_id, report_json, anomalies, validation_passed, status, clients(name, status)')
          .eq('report_date', digestDate);
        const rows = (runs ?? [])
          .map((r: any) => ({ ...r, client_name: r.clients?.name, client_status: r.clients?.status }))
          .filter((r: any) => ['active', 'onboarding'].includes(r.client_status ?? ''));
        const text = buildDigest(digestDate, rows);
        return json({ digest_date: digestDate, clients_included: rows.length, chunks: chunk(text).length, text });
      }

      default:
        return json({ error: `unknown action "${action}"` }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});