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
//   5. finalize once everything is terminal, at 04:50, or hard-stop at 05:00
//   6. hand ONE consolidated SMS to agency-ghl-report-send (idempotent)
//
// No secret, credential or phone number is ever logged or returned.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { authorizeDailyReportRun } from '../_shared/dailyReportSecret.ts';
import {
  TZ, laDate, laHour, laMinutesOfDay, yesterdayLa, inLocalWindow,
  chunkSms, money, buildIndicators, type Windows,
} from '../_shared/agencyReport.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
};

const WINDOW_START_HOUR = 4;
const WINDOW_END_HOUR = 5;
/** 04:50 — stop dispatching and finalize with whatever is terminal. */
const FINALIZE_MINUTE = WINDOW_START_HOUR * 60 + 50;
/** 05:00 — hard deadline; anything unfinished is timed out and reported. */
const DEADLINE_MINUTE = WINDOW_END_HOUR * 60;
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
  const inWindow = inLocalWindow(now, WINDOW_START_HOUR, WINDOW_END_HOUR);

  // The local-time gate has no bypass. Only an authenticated dry run may look
  // at another date outside the window.
  if (!inWindow && !dryRun) {
    return json({ ok: true, skipped: true, reason: `local hour ${laHour(now)} outside ${WINDOW_START_HOUR}-${WINDOW_END_HOUR}`, tz: TZ });
  }

  const reportDate = dryRun && typeof body.report_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.report_date)
    ? body.report_date
    : yesterdayLa(now);

  const minuteOfDay = laMinutesOfDay(now);
  const pastFinalize = inWindow ? minuteOfDay >= FINALIZE_MINUTE : true;
  const pastDeadline = inWindow ? minuteOfDay >= DEADLINE_MINUTE : true;

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

  try {
    /* ── 1. durable agency run ─────────────────────────────────────────────── */
    const { data: agencyRun, error: runErr } = await sb
      .from('agency_daily_report_runs')
      .upsert({ report_date: reportDate }, { onConflict: 'report_date', ignoreDuplicates: true })
      .select('id, status, finalized_at, tick_count, delivery')
      .maybeSingle();
    let run = agencyRun;
    if (!run) {
      const { data: existing } = await sb
        .from('agency_daily_report_runs')
        .select('id, status, finalized_at, tick_count, delivery')
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
      await sb.from('agency_daily_report_runs')
        .update({ tick_count: (run.tick_count ?? 0) + 1 })
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
      .select('client_id, status, validation_passed, error, report_json, anomalies')
      .eq('report_date', reportDate);
    const byClient = new Map<string, any>();
    for (const w of workerRuns ?? []) byClient.set(w.client_id, w);

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
    const shouldFinalize = dryRun || stillOutstanding.length === 0 || pastFinalize || pastDeadline;

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
      await sb.from('agency_daily_report_runs').update({
        status,
        finalized_at: new Date().toISOString(),
        clients_total: current.length,
        clients_valid: built.counts.valid,
        clients_unavailable: built.counts.unavailable,
        clients_failed: built.counts.failed,
        delivery,
        audit: { chars: built.text.length, chunks: chunks.length, audit_notes: built.audit },
        last_error: delivery.error ?? null,
      }).eq('id', run.id);
    }

    console.log('[agency-daily-report-coordinator]', JSON.stringify({
      report_date: reportDate, status, clients: current.length,
      valid: built.counts.valid, unavailable: built.counts.unavailable, failed: built.counts.failed,
      delivered: delivery.sent === true, dry_run: dryRun,
    }));

    return json({
      ok: true, report_date: reportDate, tz: TZ, phase: 'finalized',
      status, counts: built.counts, clients_total: current.length,
      chunks: chunks.length, chars: built.text.length,
      delivery, dry_run: dryRun,
      preview: dryRun ? built.text : undefined,
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

/* ── message construction (presentation only) ──────────────────────────────── */

interface Counts { valid: number; unavailable: number; failed: number }

function pace(ind: any): string {
  return ind?.emoji ?? '⚪';
}

function buildAgencyMessage(
  reportDate: string,
  ledger: Array<{ client_id: string; client_name: string | null; status: string; last_error: string | null }>,
  byClient: Map<string, any>,
): { text: string; counts: Counts; audit: string[] } {
  const counts: Counts = { valid: 0, unavailable: 0, failed: 0 };
  const audit: string[] = [];
  const blocks: string[] = [];

  const totals = { spend: 0, leads: 0, qualified: 0, booked: 0, eligible: 0, showed: 0, commitments: 0, commitmentDollars: 0, funded: 0, fundedDollars: 0 };

  const enriched = ledger.map((row) => {
    const w = byClient.get(row.client_id);
    const windows: Windows | null = w?.report_json?.windows ?? null;
    return { row, w, windows, spend: Number(windows?.['1']?.totals?.spend ?? 0) };
  }).sort((a, b) => b.spend - a.spend);

  for (const { row, w, windows } of enriched) {
    const name = row.client_name || 'Unknown client';
    // `pending` / `dispatched` means the worker has not finished — that is an
    // explicit unavailable, not a failure and never a zero.
    if (row.status === 'pending' || row.status === 'dispatched') {
      counts.unavailable++;
      audit.push(`${name}: report not complete (${row.status})`);
      blocks.push(`${name}\n• ⚪ report not complete`);
      continue;
    }
    if (row.status === 'error' || row.status === 'timed_out' || !w) {
      counts.failed++;
      audit.push(`${name}: ${row.status}${row.last_error ? ` — ${row.last_error.slice(0, 80)}` : ''}`);
      blocks.push(`${name}\n• ⚪ no validated data (${row.status})`);
      continue;
    }
    if (!windows) {
      counts.unavailable++;
      audit.push(`${name}: report produced without window aggregation`);
      blocks.push(`${name}\n• ⚪ metrics unavailable`);
      continue;
    }
    const validated = w.validation_passed === true && row.status === 'completed';
    if (validated) counts.valid++; else counts.unavailable++;

    const d = windows['1'];
    const avail = w.report_json?.metric_availability ?? {};
    const ind = w.report_json?.indicators ?? buildIndicators(windows);
    const n = (v: number | null, ok = true) => (ok && v !== null ? String(v) : 'n/a');

    totals.spend += d.totals.spend;
    totals.leads += d.totals.leads;
    totals.qualified += d.totals.qualified;
    totals.booked += d.totals.booked;
    totals.eligible += d.totals.eligible;
    totals.showed += d.totals.showed;
    totals.commitments += d.totals.commitments;
    totals.commitmentDollars += d.totals.commitment_dollars;
    totals.funded += d.totals.funded;
    totals.fundedDollars += d.totals.funded_dollars;

    const trio = (metric: string) =>
      `${pace(ind?.[metric]?.['7'])}${pace(ind?.[metric]?.['14'])}${pace(ind?.[metric]?.['30'])}`;

    blocks.push([
      `${name}${validated ? '' : ' ⚠️ unvalidated'}`,
      `• Spend ${avail.spend === false ? 'n/a' : money(d.totals.spend)} · Leads ${n(d.totals.leads, avail.leads !== false)} ${trio('leads')} · CPL ${avail.cpl === false ? 'n/a' : money(d.costs.cpl)} ${trio('cpl')}`,
      `• Booked ${n(d.totals.booked, avail.booked !== false)} ${trio('booked')} · Showed ${n(d.totals.showed, avail.show_rate !== false)}/${n(d.totals.eligible, avail.show_rate !== false)} (${d.rates.show_rate ?? 'n/a'}%) ${trio('show_rate')}`,
      `• Commit ${n(d.totals.commitments, avail.commitments !== false)} (${money(d.totals.commitment_dollars)}) ${trio('commitments')} · Funded ${n(d.totals.funded, avail.funded !== false)} (${money(d.totals.funded_dollars)}) ${trio('funded')}`,
      `• 7/14/30d avg leads ${windows['7'].per_day.leads ?? 'n/a'} / ${windows['14'].per_day.leads ?? 'n/a'} / ${windows['30'].per_day.leads ?? 'n/a'}`,
    ].join('\n'));

    const criticals = (w.anomalies ?? []).filter((a: any) => a.severity === 'critical').map((a: any) => a.code);
    if (criticals.length) audit.push(`${name}: ${criticals.slice(0, 3).join(', ')}`);
  }

  const head = [
    `HPA Agency Daily Report · ${reportDate} (${TZ})`,
    `Portfolio — Spend ${money(totals.spend)} · Leads ${totals.leads} · CPL ${totals.leads ? money(totals.spend / totals.leads) : 'n/a'}`,
    `Booked ${totals.booked} · Showed ${totals.showed}/${totals.eligible} (${totals.eligible ? Math.round((totals.showed / totals.eligible) * 1000) / 10 : 'n/a'}%) · Commit ${totals.commitments} (${money(totals.commitmentDollars)}) · Funded ${totals.funded} (${money(totals.fundedDollars)})`,
    `Clients: ${counts.valid} validated · ${counts.unavailable} partial/unavailable · ${counts.failed} failed`,
    `Pacing 🟢 better / 🔴 worse / ⚪ n-a vs 7d·14d·30d daily average`,
  ].join('\n');

  const footer = [
    'Audit',
    ...(audit.length ? audit.slice(0, 12).map((a) => `• ${a}`) : ['• none']),
    'Unvalidated or n/a values are missing/failed sources, not zeros.',
  ].join('\n');

  return { text: [head, ...blocks, footer].join('\n\n'), counts, audit };
}
