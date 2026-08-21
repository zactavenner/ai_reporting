// Agency Daily Reporting 5.0 — secured coordinator.
//
// Runs between 04:00 and 05:00 America/Los_Angeles (DST-safe: the cron fires
// every 2 minutes across UTC 11–13 and only the local-window ticks act) and
// reports YESTERDAY in that timezone.
//
// Responsibilities per tick:
//   1. open / reuse the durable agency_daily_report_runs row for the date
//   2. enrol every ACTIVE client into agency_daily_report_clients
//   3. reconcile statuses from public.daily_report_runs
//   4. dispatch daily-report-run for pending / retryable clients, max 3 at once
//   5. stop dispatching at 04:50; reconcile until terminal or hard-stop at 05:00
//   6. hand ONE consolidated SMS to agency-ghl-report-send (idempotent)
//
// No secret, credential or phone number is ever logged or returned.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeDailyReportRun } from '../_shared/dailyReportSecret.ts';
import {
  TZ, laDate, laHour, yesterdayLa,
  chunkSms, buildAgencyMessage, agencyScheduleState, workerRunIsCurrent,
  SEND_WINDOW_START_HOUR, SEND_WINDOW_END_HOUR,
} from '../_shared/agencyReport.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

const WINDOW_START_HOUR = SEND_WINDOW_START_HOUR;
const WINDOW_END_HOUR = SEND_WINDOW_END_HOUR;
const MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 3; // initial dispatch + at most two retries
const TERMINAL = ['completed', 'validation_failed', 'error', 'timed_out'];

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Res = { ok: boolean; status: number; body: any };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body = await req.json().catch(() => ({} as any));
  const url = new URL(req.url);
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const presented = body.secret ?? req.headers.get('x-internal-secret') ?? url.searchParams.get('secret') ?? null;
  if (!(await authorizeDailyReportRun(sb, presented))) return json({ error: 'unauthorized' }, 401);

  const dryRun = body.dry_run === true;
  const now = new Date();
  const schedule = agencyScheduleState(now);
  const minuteOfDay = schedule.minute;
  const inWindow = schedule.can_act;

  // The local-time gate has no bypass. Only an authenticated dry run may look
  // at another date outside the window.
  if (!inWindow && !dryRun) {
    return json({ ok: true, skipped: true, reason: `local hour ${laHour(now)} outside ${WINDOW_START_HOUR}-${WINDOW_END_HOUR}`, tz: TZ });
  }

  const reportDate = dryRun && typeof body.report_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.report_date)
    ? body.report_date
    : yesterdayLa(now);

  const pastFinalize = schedule.past_finalize_cutoff;
  const pastDeadline = schedule.past_deadline;

  const invoke = async (fn: string, payload: Record<string, unknown>, timeoutMs = 60_000): Promise<Res> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let parsed: any = text;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
      return { ok: res.ok, status: res.status, body: parsed };
    } catch (e) {
      return { ok: false, status: 0, body: { error: String((e as Error)?.message || e) } };
    } finally {
      clearTimeout(timer);
    }
  };

  // Authenticated, no-send end-to-end readiness mode. It runs one real client
  // worker synchronously (all pulls + validation), then exercises the GHL
  // contact/chunk route with dry_run=true. It never writes an agency run or
  // sends an SMS, and is intentionally bounded to one explicitly named client.
  if (dryRun && body.execute_workers === true) {
    const clientId = typeof body.client_id === 'string' ? body.client_id : null;
    if (!clientId) return json({ error: 'client_id is required when execute_workers=true' }, 400);
    const workerCall = await invoke('daily-report-run', {
      secret: presented,
      client_id: clientId,
      report_date: reportDate,
      deliver: false,
      dry_run: true,
      background: false,
      force: true,
      source: 'agency_coordinator_readiness',
    }, 420_000);
    const { data: client } = await sb.from('clients').select('id, name').eq('id', clientId).maybeSingle();
    const { data: worker } = await sb.from('daily_report_runs')
      .select('client_id, status, validation_passed, error, report_json, anomalies, started_at, finished_at')
      .eq('client_id', clientId)
      .eq('report_date', reportDate)
      .maybeSingle();
    if (!workerCall.ok || !worker) {
      return json({
        ok: false, dry_run: true, sent: false, report_date: reportDate,
        worker_http_status: workerCall.status, error: worker?.error ?? workerCall.body?.error ?? 'worker produced no audit row',
      }, 502);
    }
    const ledger = [{
      client_id: clientId,
      client_name: client?.name ?? null,
      status: worker.status,
      last_error: worker.error ?? null,
    }];
    const built = buildAgencyMessage(reportDate, ledger, new Map([[clientId, worker]]));
    const route = await invoke('agency-ghl-report-send', {
      secret: presented,
      dry_run: true,
      report_date: reportDate,
      cadence: 'daily',
      kind: 'daily_report',
      text: built.text,
    }, 45_000);
    return json({
      ok: worker.validation_passed === true && route.ok,
      dry_run: true,
      sent: false,
      report_date: reportDate,
      worker: {
        status: worker.status,
        validation_passed: worker.validation_passed,
        started_at: worker.started_at,
        finished_at: worker.finished_at,
        anomalies: worker.anomalies,
      },
      counts: built.counts,
      chars: built.text.length,
      chunks: chunkSms(built.text).length,
      readiness: route.body,
      preview: built.text,
    }, worker.validation_passed === true && route.ok ? 200 : 422);
  }

  try {
    /* ── 1. durable agency run ─────────────────────────────────────────────── */
    const { data: agencyRun, error: runErr } = await sb
      .from('agency_daily_report_runs')
      .upsert({ report_date: reportDate }, { onConflict: 'report_date', ignoreDuplicates: true })
      .select('id, status, started_at, collection_started_at, finalized_at, tick_count, delivery')
      .maybeSingle();
    let run = agencyRun;
    if (!run) {
      const { data: existing } = await sb
        .from('agency_daily_report_runs')
        .select('id, status, started_at, collection_started_at, finalized_at, tick_count, delivery')
        .eq('report_date', reportDate)
        .maybeSingle();
      run = existing ?? null;
    }
    if (runErr && !run) return json({ error: runErr.message }, 500);
    if (!run) return json({ error: 'could not open agency run' }, 500);

    // Deterministic idempotency: once finalized, later ticks are no-ops.
    if (run.finalized_at && !dryRun) {
      return json({ ok: true, already_finalized: true, report_date: reportDate, status: run.status });
    }

    if (!dryRun) {
      if (!run.collection_started_at) {
        run.collection_started_at = new Date().toISOString();
      }
      await sb.from('agency_daily_report_runs')
        .update({
          tick_count: (run.tick_count ?? 0) + 1,
          collection_started_at: run.collection_started_at,
        })
        .eq('id', run.id);
    }

    /* ── 2. enrol ACTIVE clients ───────────────────────────────────────────── */
    const { data: clients, error: clientsErr } = await sb
      .from('clients')
      .select('id, name')
      .eq('status', 'active')
      .order('name');
    if (clientsErr) return json({ error: clientsErr.message }, 500);
    const clientList = clients ?? [];

    if (!dryRun && clientList.length) {
      await sb.from('agency_daily_report_clients').upsert(
        clientList.map((c) => ({
          agency_run_id: run!.id, client_id: c.id, client_name: c.name, report_date: reportDate,
        })),
        { onConflict: 'agency_run_id,client_id', ignoreDuplicates: true },
      );
    }

    let { data: ledger } = await sb
      .from('agency_daily_report_clients')
      .select('id, client_id, client_name, status, attempts, validation_passed, last_error, dispatched_at')
      .eq('agency_run_id', run.id);
    let rows = ledger ?? [];

    // A dry run writes nothing, so synthesise the ledger from the live active
    // client list to exercise realistic message size and chunking.
    if (dryRun && rows.length === 0) {
      rows = clientList.map((c) => ({
        id: c.id, client_id: c.id, client_name: c.name, status: 'pending',
        attempts: 0, validation_passed: null, last_error: null, dispatched_at: null,
      })) as any;
    }

    /* ── 3. reconcile from the per-client worker ledger ─────────────────────── */
    const { data: workerRuns } = await sb
      .from('daily_report_runs')
      .select('client_id, status, validation_passed, error, report_json, anomalies, started_at')
      .eq('report_date', reportDate)
      // A completed row from an earlier manual/legacy attempt is not evidence
      // that this agency run performed a fresh pull.
      .gte('started_at', run.collection_started_at ?? run.started_at);
    const byClient = new Map<string, any>();
    const currentBoundary = run.collection_started_at ?? run.started_at;
    for (const w of workerRuns ?? []) {
      if (workerRunIsCurrent(w.started_at, currentBoundary)) byClient.set(w.client_id, w);
    }

    if (!dryRun) {
      for (const row of rows) {
        const w = byClient.get(row.client_id);
        if (!w) continue;
        let status = row.status;
        if (w.status === 'completed') status = 'completed';
        else if (w.status === 'validation_failed') status = 'validation_failed';
        else if (w.status === 'error') status = 'error';
        if (status !== row.status) {
          await sb.from('agency_daily_report_clients').update({
            status,
            validation_passed: w.validation_passed ?? null,
            last_error: w.error ?? null,
            completed_at: TERMINAL.includes(status) ? new Date().toISOString() : null,
          }).eq('id', row.id);
          row.status = status;
          row.validation_passed = w.validation_passed ?? null;
        }
      }
    }

    /* ── 4. bounded dispatch ───────────────────────────────────────────────── */
    // A dispatched client is retryable only once its worker attempt is provably
    // gone (no run row) or stuck (still `running` well past the stall window).
    const STALL_MS = 8 * 60_000;
    const isStuck = (r: any) => {
      const w = byClient.get(r.client_id);
      const age = r.dispatched_at ? Date.now() - new Date(r.dispatched_at).getTime() : Infinity;
      if (!w) return age > 60_000;
      return w.status === 'running' && age > STALL_MS;
    };
    const dispatchable = rows.filter((r) =>
      !TERMINAL.includes(r.status) &&
      (r.attempts ?? 0) < MAX_ATTEMPTS &&
      (r.status === 'pending' || (r.status === 'dispatched' && isStuck(r))));

    const dispatched: string[] = [];
    if (!dryRun && !pastFinalize && dispatchable.length) {
      const batch = dispatchable.slice(0, MAX_CONCURRENT);
      await Promise.all(batch.map(async (r) => {
        const res = await invoke('daily-report-run', {
          secret: presented,
          client_id: r.client_id,
          report_date: reportDate,
          deliver: false,
          background: true,
          force: (r.attempts ?? 0) > 0,
          source: 'agency_coordinator',
        }, 30_000);
        await sb.from('agency_daily_report_clients').update({
          status: res.ok ? 'dispatched' : 'pending',
          attempts: (r.attempts ?? 0) + 1,
          dispatched_at: new Date().toISOString(),
          last_error: res.ok ? null : `dispatch failed (${res.status})`,
        }).eq('id', r.id);
        if (res.ok) dispatched.push(r.client_id);
      }));
    }

    /* ── 5. status roll-up ─────────────────────────────────────────────────── */
    const { data: fresh } = await sb
      .from('agency_daily_report_clients')
      .select('id, client_id, client_name, status, attempts, validation_passed, last_error, dispatched_at')
      .eq('agency_run_id', run.id);
    let current = dryRun ? rows : (fresh?.length ? fresh : rows);
    const outstanding = current.filter((r) => !TERMINAL.includes(r.status));

    if (pastDeadline && !dryRun && outstanding.length) {
      await sb.from('agency_daily_report_clients')
        .update({ status: 'timed_out', last_error: 'not terminal by 05:00 local deadline', completed_at: new Date().toISOString() })
        .in('id', outstanding.map((r) => r.id));
      current = current.map((r) => (TERMINAL.includes(r.status) ? r : { ...r, status: 'timed_out' }));
    }

    const stillOutstanding = current.filter((r) => !TERMINAL.includes(r.status));
    // At 04:50 dispatch stops, but reconciliation continues until everything
    // is terminal or the 05:00 hard deadline is reached.
    const shouldFinalize = dryRun || stillOutstanding.length === 0 || pastDeadline;

    if (!shouldFinalize) {
      return json({
        ok: true, report_date: reportDate, tz: TZ, phase: 'in_progress',
        clients_total: current.length,
        outstanding: stillOutstanding.length,
        dispatched: dispatched.length,
        local_time: `${laDate(now)} ${String(laHour(now)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`,
      });
    }

    /* ── 6. build the consolidated message ─────────────────────────────────── */
    const built = buildAgencyMessage(reportDate, current, byClient);
    const chunks = chunkSms(built.text);

    let delivery: any = { attempted: false, reason: dryRun ? 'dry_run' : null, chunks: chunks.length };
    if (dryRun) {
      const check = await invoke('agency-ghl-report-send', {
        secret: presented, dry_run: true, report_date: reportDate,
        cadence: 'daily', kind: 'daily_report', text: built.text,
      }, 45_000);
      delivery = { attempted: false, dry_run: true, chunks: chunks.length, readiness: check.body };
    } else {
      const send = await invoke('agency-ghl-report-send', {
        secret: presented, report_date: reportDate,
        cadence: 'daily', kind: 'daily_report', text: built.text,
      }, 90_000);
      delivery = {
        attempted: true, ok: send.ok, status: send.body?.status ?? null,
        sent: send.body?.sent === true, chunks: send.body?.chunk_count ?? chunks.length,
        confirmed: send.body?.confirmed ?? 0, error: send.body?.error ?? null,
        skipped: send.body?.skipped ?? null,
      };
    }

    const status = built.counts.failed > 0 || stillOutstanding.length > 0
      ? (built.counts.valid > 0 ? 'degraded' : 'failed')
      : (delivery.attempted && !delivery.sent ? 'degraded' : 'completed');

    if (!dryRun) {
      const deliveryConfirmed = delivery.sent === true;
      await sb.from('agency_daily_report_runs').update({
        status,
        // A failed delivery is retryable on the next 2-minute scheduler tick.
        // Only a provider-confirmed send permanently finalizes the run.
        finalized_at: deliveryConfirmed ? new Date().toISOString() : null,
        clients_total: current.length,
        clients_valid: built.counts.valid,
        clients_unavailable: built.counts.unavailable,
        clients_failed: built.counts.failed,
        delivery,
        audit: { chars: built.text.length, chunks: chunks.length, audit_notes: built.audit },
        last_error: deliveryConfirmed ? null : (delivery.error ?? 'delivery not provider-confirmed'),
      }).eq('id', run.id);
    }

    console.log('[agency-daily-report-coordinator]', JSON.stringify({
      report_date: reportDate, status, clients: current.length,
      valid: built.counts.valid, unavailable: built.counts.unavailable, failed: built.counts.failed,
      delivered: delivery.sent === true, dry_run: dryRun,
    }));

    return json({
      ok: true, report_date: reportDate, tz: TZ, phase: dryRun || delivery.sent === true ? 'finalized' : 'delivery_retry_pending',
      status, counts: built.counts, clients_total: current.length,
      chunks: chunks.length, chars: built.text.length,
      delivery, dry_run: dryRun,
      preview: dryRun ? built.text : undefined,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
