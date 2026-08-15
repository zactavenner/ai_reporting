// Reporting 5.0 — ordered daily run (6:00 AM America/Los_Angeles).
//
// Stage order is fixed and every stage is recorded on public.daily_report_runs:
//   1 sync        → Meta ad spend (yesterday + trailing 7 days), GHL contacts,
//                   calendar appointments, pipelines
//   2 normalize   → re-apply the repair predicates to newly synced rows
//   3 recalculate → daily_metrics from v_daily_funnel_day (yesterday + 7 days)
//   4 validate    → freshness, anomalies, reconciliation. Hard-fails the run.
//   5 report      → deterministic numbers read from the DB view only
//   6 deliver     → optional, idempotent (client_report_sends.idempotency_key)
//
// Numbers are NEVER computed by the model. The narrative may only summarise
// already-calculated values. The Google sheet is output-only, after validation.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INTERNAL_PASSWORD = 'HPA1234$';
const TZ = 'America/Los_Angeles';
const RUN_HOUR_LOCAL = 6;
const TRAILING_DAYS = 7;

type Body = {
  password?: string;
  client_id?: string;
  report_date?: string;
  dry_run?: boolean;
  deliver?: boolean;
  force?: boolean;
  skip_sync?: boolean;
  source?: string;
};

const laDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const laHour = (d = new Date()) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d));

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const body: Body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const password = body.password ?? url.searchParams.get('password') ?? undefined;
  if (password !== INTERNAL_PASSWORD) return json({ error: 'unauthorized' }, 401);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const sb = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // DST-safe gate: cron fires at 13:00 and 14:00 UTC; only the invocation that
  // lands on local hour 06 proceeds.
  const fromCron = body.source === 'cron';
  if (fromCron && !body.force) {
    const hour = laHour();
    if (hour !== RUN_HOUR_LOCAL) {
      return json({ ok: true, skipped: true, reason: `local hour ${hour} != ${RUN_HOUR_LOCAL}`, tz: TZ });
    }
  }

  const reportDate = body.report_date || addDays(laDate(), -1);
  const windowStart = addDays(reportDate, -(TRAILING_DAYS - 1));
  const dryRun = body.dry_run === true || body.deliver === false;
  const deliver = body.deliver === true && !body.dry_run;

  let clientsQ = sb.from('clients').select('id, name, status').in('status', ['active', 'onboarding']);
  if (body.client_id) clientsQ = sb.from('clients').select('id, name, status').eq('id', body.client_id);
  const { data: clients, error: clientsErr } = await clientsQ;
  if (clientsErr) return json({ error: clientsErr.message }, 500);

  const invoke = async (fn: string, payload: Record<string, unknown>) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    return { ok: res.ok, status: res.status, body: parsed };
  };

  const results: any[] = [];

  for (const client of clients ?? []) {
    const stages: any[] = [];
    const stage = (name: string, status: string, detail: unknown) =>
      stages.push({ stage: name, status, at: new Date().toISOString(), detail });

    // Idempotent run key: one row per (client_id, report_date).
    const { data: existingRun } = await sb
      .from('daily_report_runs')
      .select('id, delivered_at, status')
      .eq('client_id', client.id)
      .eq('report_date', reportDate)
      .maybeSingle();

    if (existingRun?.status === 'running' && !body.force) {
      results.push({ client: client.name, skipped: 'run already in progress' });
      continue;
    }

    const { data: runRow, error: runErr } = await sb
      .from('daily_report_runs')
      .upsert({
        client_id: client.id,
        report_date: reportDate,
        status: 'running',
        dry_run: dryRun,
        stages: [],
        error: null,
        started_at: new Date().toISOString(),
        finished_at: null,
      }, { onConflict: 'client_id,report_date' })
      .select('id, delivered_at')
      .single();

    if (runErr || !runRow) {
      results.push({ client: client.name, error: runErr?.message || 'could not open run' });
      continue;
    }

    const finish = async (status: string, extra: Record<string, unknown>) => {
      await sb.from('daily_report_runs').update({
        status,
        stages,
        finished_at: new Date().toISOString(),
        ...extra,
      }).eq('id', runRow.id);
    };

    try {
      // ── 1. SYNC ───────────────────────────────────────────────────────────
      if (body.skip_sync) {
        stage('sync', 'skipped', { reason: 'skip_sync' });
      } else {
        const meta = await invoke('sync-meta-ad-spend', {
          mode: 'manual', client_id: client.id, days_back: TRAILING_DAYS + 1,
        });
        const ghl = await invoke('sync-ghl-contacts', {
          client_id: client.id, syncType: 'all', sinceDateDays: 14,
        });
        const cal = await invoke('sync-calendar-appointments', { clientId: client.id });
        const pipe = await invoke('sync-ghl-pipelines', { client_id: client.id, mode: 'list' });
        stage('sync', meta.ok ? 'ok' : 'error', {
          meta: meta.status, ghl: ghl.status, calendar: cal.status, pipelines: pipe.status,
        });
      }

      // ── 2. NORMALIZE / REPAIR ────────────────────────────────────────────
      const { data: repaired, error: repairErr } = await sb.rpc('repair_client_reporting_rows', {
        p_client_id: client.id,
      });
      stage('normalize', repairErr ? 'error' : 'ok', repairErr ? { error: repairErr.message } : repaired);

      // ── 3. RECALCULATE ───────────────────────────────────────────────────
      const recalc = await invoke('recalculate-daily-metrics', {
        client_id: client.id, start_date: windowStart, end_date: reportDate,
      });
      stage('recalculate', recalc.ok ? 'ok' : 'error', { status: recalc.status });

      // ── 4. VALIDATE ──────────────────────────────────────────────────────
      const { data: funnelRows, error: funnelErr } = await sb
        .from('v_daily_funnel_day')
        .select('*')
        .eq('client_id', client.id)
        .gte('date', windowStart)
        .lte('date', reportDate)
        .order('date');
      if (funnelErr) throw new Error(`funnel read failed: ${funnelErr.message}`);

      const day = (funnelRows ?? []).find((r: any) => r.date === reportDate) || null;

      const { data: freshRows } = await sb
        .from('v_daily_funnel_freshness')
        .select('*')
        .eq('client_id', client.id)
        .maybeSingle();

      const { count: spendRowCount } = await sb
        .from('ad_spend_daily')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .eq('date', reportDate);

      const anomalies: any[] = [];
      if (!spendRowCount) {
        anomalies.push({ code: 'meta_no_rows', severity: 'critical',
          message: `No ad_spend_daily rows for ${reportDate}; a zero row is not proof the sync completed.` });
      }
      if (day && Number(day.spend) === 0 && Number(day.leads_total) > 0) {
        anomalies.push({ code: 'zero_spend_with_leads', severity: 'warning',
          message: 'Spend is zero while leads exist — Meta sync likely incomplete.' });
      }
      if (day && Number(day.booked_at_missing_count) > 0) {
        anomalies.push({ code: 'missing_booked_at', severity: 'warning',
          message: `${day.booked_at_missing_count} appointment(s) have no CRM creation timestamp.` });
      }
      if (day && Number(day.discovery_unclassified) > 0) {
        anomalies.push({ code: 'unclassified_attendance', severity: 'warning',
          message: `${day.discovery_unclassified} past discovery appointment(s) still pending a show/no-show status; excluded from shows.` });
      }
      if (freshRows && Number(freshRows.calls_false_showed) > 0) {
        anomalies.push({ code: 'false_showed_present', severity: 'critical',
          message: `${freshRows.calls_false_showed} call(s) marked showed without a showed/completed status.` });
      }
      if (freshRows && Number(freshRows.commitments_missing_committed_at) > 0) {
        anomalies.push({ code: 'commitments_unknown_date', severity: 'info',
          message: `${freshRows.commitments_missing_committed_at} commitment record(s) have no CRM commitment timestamp and are excluded from daily commitments.` });
      }

      const { data: dm } = await sb
        .from('daily_metrics')
        .select('ad_spend, leads, calls, showed_calls, funded_dollars')
        .eq('client_id', client.id)
        .eq('date', reportDate)
        .maybeSingle();

      const reconciliation = {
        view_spend: Number(day?.spend || 0),
        daily_metrics_spend: Number(dm?.ad_spend || 0),
        view_leads: Number(day?.leads_total || 0),
        daily_metrics_leads: Number(dm?.leads || 0),
        view_discovery_showed: Number(day?.discovery_showed || 0),
        daily_metrics_showed: Number(dm?.showed_calls || 0),
        matches:
          Number(day?.spend || 0) === Number(dm?.ad_spend || 0) &&
          Number(day?.leads_total || 0) === Number(dm?.leads || 0) &&
          Number(day?.discovery_showed || 0) === Number(dm?.showed_calls || 0),
      };
      if (!reconciliation.matches) {
        anomalies.push({ code: 'reconciliation_mismatch', severity: 'critical',
          message: 'daily_metrics does not match v_daily_funnel_day for the report date.' });
      }

      const validationPassed = !anomalies.some((a) => a.severity === 'critical');
      stage('validate', validationPassed ? 'ok' : 'failed', { anomalies, reconciliation });

      // ── 5. REPORT (deterministic, DB-sourced) ────────────────────────────
      const report = {
        client: { id: client.id, name: client.name },
        report_date: reportDate,
        timezone: TZ,
        window: { start: windowStart, end: reportDate },
        freshness: {
          meta_last_synced_at: freshRows?.meta_last_synced_at ?? null,
          meta_last_date: freshRows?.meta_last_date ?? null,
          meta_rows_for_report_date: spendRowCount ?? 0,
          ghl_last_synced_at: freshRows?.ghl_last_synced_at ?? null,
          calls_last_synced_at: freshRows?.calls_last_synced_at ?? null,
          leads_last_created_at: freshRows?.leads_last_created_at ?? null,
        },
        funnel: {
          ads: {
            spend: Number(day?.spend || 0),
            impressions: Number(day?.impressions || 0),
            clicks: Number(day?.clicks || 0),
            ctr: Number(day?.ctr || 0),
            meta_reported_leads: Number(day?.meta_leads || 0),
            cost_per_lead: Number(day?.cost_per_lead || 0),
          },
          leads: {
            total: Number(day?.leads_total || 0),
            qualified: Number(day?.leads_qualified || 0),
            bad: Number(day?.leads_bad || 0),
            pending_review: Number(day?.leads_pending || 0),
          },
          discovery_calls: {
            booked: Number(day?.discovery_booked || 0),
            eligible: Number(day?.discovery_eligible || 0),
            showed: Number(day?.discovery_showed || 0),
            noshow: Number(day?.discovery_noshow || 0),
            unclassified: Number(day?.discovery_unclassified || 0),
            show_rate: day?.discovery_show_rate ?? null,
            cost_per_showed: Number(day?.cost_per_showed || 0),
          },
          reconnect_calls: {
            booked: Number(day?.reconnect_booked || 0),
            eligible: Number(day?.reconnect_eligible || 0),
            showed: Number(day?.reconnect_showed || 0),
            noshow: Number(day?.reconnect_noshow || 0),
            show_rate: day?.reconnect_show_rate ?? null,
          },
          commitments: {
            count: Number(day?.commitments || 0),
            dollars: Number(day?.commitment_dollars || 0),
          },
          funded_wire: {
            count: Number(day?.funded_count || 0),
            dollars: Number(day?.funded_dollars || 0),
            cost_per_funded: Number(day?.cost_per_funded || 0),
          },
        },
        trailing_7_days: (funnelRows ?? []).map((r: any) => ({
          date: r.date, spend: Number(r.spend), leads: Number(r.leads_total),
          discovery_booked: Number(r.discovery_booked), discovery_showed: Number(r.discovery_showed),
          show_rate: r.discovery_show_rate, funded_dollars: Number(r.funded_dollars),
        })),
        anomalies,
        reconciliation,
        validation_passed: validationPassed,
      };
      stage('report', 'ok', { keys: Object.keys(report.funnel) });

      // ── 6. DELIVER (idempotent, opt-in) ──────────────────────────────────
      let delivery: any = { attempted: false };
      if (!deliver) {
        delivery = { attempted: false, reason: dryRun ? 'dry_run' : 'deliver flag not set' };
        stage('deliver', 'skipped', delivery);
      } else if (!validationPassed) {
        delivery = { attempted: false, reason: 'validation failed' };
        stage('deliver', 'skipped', delivery);
      } else if (runRow.delivered_at && !body.force) {
        delivery = { attempted: false, reason: 'already delivered for this report_date' };
        stage('deliver', 'skipped', delivery);
      } else {
        const { data: recipients } = await sb
          .from('client_report_recipients')
          .select('*')
          .eq('client_id', client.id)
          .eq('active', true)
          .is('unsubscribed_at', null)
          .contains('cadences', ['daily']);

        const sent: any[] = [];
        for (const r of recipients ?? []) {
          for (const channel of (r.channels ?? []) as string[]) {
            if (channel === 'email' && !r.email) continue;
            if (channel === 'sms' && !r.phone_e164) continue;
            const idem = `${client.id}:daily:${reportDate}:${r.id}:${channel}`;
            const { data: prior } = await sb
              .from('client_report_sends')
              .select('id, status')
              .eq('idempotency_key', idem)
              .maybeSingle();
            if (prior?.status === 'sent') { sent.push({ recipient: r.id, channel, skipped: 'already sent' }); continue; }

            const text = renderText(report);
            const { data: logRow } = await sb
              .from('client_report_sends')
              .upsert({
                client_id: client.id, recipient_id: r.id, cadence: 'daily', channel,
                period_start: reportDate, period_end: reportDate,
                status: 'pending', idempotency_key: idem,
                payload: { report_date: reportDate },
              }, { onConflict: 'idempotency_key' })
              .select('id')
              .single();

            const send = await invoke('send-ghl-message', {
              password: INTERNAL_PASSWORD, channel,
              to_email: r.email, to_phone: r.phone_e164, name: r.name,
              subject: `${client.name} · Daily performance · ${reportDate}`,
              html: renderHtml(client.name, report), text,
            });
            if (send.ok) {
              await sb.from('client_report_sends').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', logRow!.id);
              sent.push({ recipient: r.id, channel, ok: true });
            } else {
              await sb.from('client_report_sends').update({ status: 'failed', error: JSON.stringify(send.body).slice(0, 500) }).eq('id', logRow!.id);
              sent.push({ recipient: r.id, channel, error: send.status });
            }
          }
        }
        delivery = { attempted: true, sent };
        stage('deliver', 'ok', delivery);
      }

      await finish(validationPassed ? 'completed' : 'validation_failed', {
        metrics: report.funnel,
        anomalies,
        freshness: report.freshness,
        reconciliation,
        report_json: report,
        validation_passed: validationPassed,
        delivered_at: delivery.attempted && (delivery.sent ?? []).some((s: any) => s.ok)
          ? new Date().toISOString()
          : (runRow.delivered_at ?? null),
        delivery_channels: delivery.sent ?? [],
      });

      results.push({
        client: client.name, client_id: client.id, report_date: reportDate,
        validation_passed: validationPassed, anomalies, reconciliation,
        delivery, dry_run: dryRun, report,
      });
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      stage('error', 'error', { message: msg });
      await finish('error', { error: msg });
      results.push({ client: client.name, error: msg });
    }
  }

  return json({ ok: true, report_date: reportDate, tz: TZ, dry_run: dryRun, delivered: deliver, results });
});

// ── Presentation only. Every number below is already computed by the DB. ────
function renderText(report: any): string {
  const f = report.funnel;
  return [
    `${report.client.name} · ${report.report_date} (${report.timezone})`,
    `Spend $${f.ads.spend} · Leads ${f.leads.total} (Q ${f.leads.qualified} / bad ${f.leads.bad} / pending ${f.leads.pending_review}) · CPL $${f.ads.cost_per_lead}`,
    `Discovery booked ${f.discovery_calls.booked} · showed ${f.discovery_calls.showed}/${f.discovery_calls.eligible} (${f.discovery_calls.show_rate ?? 'n/a'}%) · no-show ${f.discovery_calls.noshow}`,
    `Reconnect booked ${f.reconnect_calls.booked} · showed ${f.reconnect_calls.showed}/${f.reconnect_calls.eligible}`,
    `Commitments ${f.commitments.count} ($${f.commitments.dollars}) · Funded ${f.funded_wire.count} ($${f.funded_wire.dollars})`,
  ].join('\n');
}

function renderHtml(clientName: string, report: any): string {
  const f = report.funnel;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font:13px Inter,Arial">${label}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font:600 13px Inter,Arial;text-align:right">${value}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#FAF6EE;padding:24px;font-family:Inter,Arial">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e0d3;border-radius:14px;overflow:hidden">
      <div style="background:#0B2B26;color:#fff;padding:20px 22px">
        <div style="font:11px Inter,Arial;color:#C5A55A;letter-spacing:.12em;text-transform:uppercase">Daily performance</div>
        <div style="font:600 22px 'Playfair Display',Georgia,serif;margin-top:4px">${clientName}</div>
        <div style="font:12px Inter,Arial;color:#d6cfbe;margin-top:4px">${report.report_date} · ${report.timezone}</div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${row('Ad spend', `$${f.ads.spend}`)}
        ${row('Impressions / clicks', `${f.ads.impressions} / ${f.ads.clicks}`)}
        ${row('CTR', `${f.ads.ctr}%`)}
        ${row('Leads (qualified / bad / pending)', `${f.leads.total} (${f.leads.qualified} / ${f.leads.bad} / ${f.leads.pending_review})`)}
        ${row('Cost per lead', `$${f.ads.cost_per_lead}`)}
        ${row('Discovery booked', `${f.discovery_calls.booked}`)}
        ${row('Discovery showed / eligible', `${f.discovery_calls.showed} / ${f.discovery_calls.eligible}`)}
        ${row('Discovery show rate', `${f.discovery_calls.show_rate ?? 'n/a'}%`)}
        ${row('Discovery no-shows', `${f.discovery_calls.noshow}`)}
        ${row('Reconnect showed / eligible', `${f.reconnect_calls.showed} / ${f.reconnect_calls.eligible}`)}
        ${row('Commitments', `${f.commitments.count} · $${f.commitments.dollars}`)}
        ${row('Funded wires', `${f.funded_wire.count} · $${f.funded_wire.dollars}`)}
      </table>
      <div style="padding:14px 22px;font:11px/1.6 Inter,Arial;color:#8a8170">
        Reconciliation ${report.reconciliation.matches ? 'matched' : 'MISMATCH'} · ${report.anomalies.length} anomaly flag(s).
        Targeted returns are not guaranteed. Investments carry risk of loss. Not an offer or solicitation.
      </div>
    </div>
  </body></html>`;
}
