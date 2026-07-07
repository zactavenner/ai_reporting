import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTERNAL_PASSWORD = "HPA1234$";

function nowInTz(tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    hour12: false,
    day: "numeric",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: wdMap[get("weekday")],
    hour: Number(get("hour")),
    day: Number(get("day")),
    ymd: `${get("year")}-${get("month").padStart(2, "0")}-${get("day").padStart(2, "0")}`,
  };
}

function fmtUSD(n: number) { return "$" + Math.round(n).toLocaleString(); }
function fmtInt(n: number) { return Math.round(n).toLocaleString(); }
function fmtPct(n: number | null) { return n === null || !isFinite(n) ? "—" : n.toFixed(1) + "%"; }

function buildDigestHtml(opts: {
  clientName: string;
  cadence: "weekly" | "monthly";
  periodStart: string;
  periodEnd: string;
  highlights: Array<{ label: string; value: string; sub?: string }>;
  publicUrl?: string;
}) {
  const cells = opts.highlights.map((h) => `
    <td style="padding:8px;width:33%;vertical-align:top;">
      <div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;background:#ffffff;">
        <div style="font-size:10px;letter-spacing:1.4px;color:#6b7280;text-transform:uppercase;font-weight:600;">${h.label}</div>
        <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:6px;font-family:Georgia,serif;">${h.value}</div>
        ${h.sub ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">${h.sub}</div>` : ""}
      </div>
    </td>`).join("");
  const rows: string[] = [];
  for (let i = 0; i < opts.highlights.length; i += 3) {
    const slice = opts.highlights.slice(i, i + 3).map((h) => `
      <td style="padding:8px;width:33%;vertical-align:top;">
        <div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;background:#ffffff;">
          <div style="font-size:10px;letter-spacing:1.4px;color:#6b7280;text-transform:uppercase;font-weight:600;">${h.label}</div>
          <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:6px;font-family:Georgia,serif;">${h.value}</div>
          ${h.sub ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">${h.sub}</div>` : ""}
        </div>
      </td>`).join("");
    rows.push(`<tr>${slice}</tr>`);
  }
  const cta = opts.publicUrl
    ? `<a href="${opts.publicUrl}" style="display:inline-block;margin-top:8px;padding:10px 16px;border-radius:10px;background:#0B2B26;color:#fff;text-decoration:none;font-weight:600;font-size:13px;">Open Full Dashboard</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:720px;margin:0 auto;">
      <tr><td style="padding:8px 8px 16px 8px;">
        <div style="font-size:11px;letter-spacing:2px;color:#6b7280;text-transform:uppercase;font-weight:600;">${opts.cadence === "weekly" ? "Weekly Recap" : "Monthly Recap"}</div>
        <div style="font-size:26px;font-weight:700;margin-top:4px;font-family:Georgia,serif;">${opts.clientName} — Stat Sheet</div>
        <div style="font-size:13px;color:#475569;margin-top:4px;">${opts.periodStart} → ${opts.periodEnd}</div>
      </td></tr>
      <tr><td>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows.join("")}</table>
      </td></tr>
      <tr><td style="padding:16px 8px 8px 8px;">${cta}</td></tr>
      <tr><td style="padding:24px 8px 8px 8px;font-size:11px;color:#6b7280;">
        — High Performance Ads
      </td></tr>
    </table>
  </body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const forceClientId: string | undefined = body.client_id;
    const dryRun: boolean = !!body.dry_run;
    const ignoreSchedule: boolean = !!body.ignore_schedule; // for manual "run now"

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const origin = body.origin || "https://reporting.highperformanceads.com";

    let sq = supabase
      .from("client_settings")
      .select("client_id, stats_report_recipients, stats_report_weekly_enabled, stats_report_frequency, stats_report_day_of_week, stats_report_day_of_month, stats_report_hour_local, stats_report_timezone")
      .eq("stats_report_weekly_enabled", true);
    if (forceClientId) sq = sq.eq("client_id", forceClientId);
    const { data: settings, error: sErr } = await sq;
    if (sErr) throw sErr;

    const clientIds = (settings || []).map((s: any) => s.client_id);
    const { data: clients } = await supabase.from("clients").select("id,name,public_token").in("id", clientIds);
    const clientMap = new Map<string, any>((clients || []).map((c: any) => [c.id, c]));

    const results: any[] = [];

    for (const s of settings || []) {
      const client = clientMap.get(s.client_id);
      if (!client) continue;
      const recips: string[] = (s.stats_report_recipients || []).filter(
        (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim().toLowerCase())
      );
      if (!recips.length) { results.push({ client_id: s.client_id, skipped: "no recipients" }); continue; }

      const cadence: "weekly" | "monthly" = s.stats_report_frequency === "monthly" ? "monthly" : "weekly";
      const tz = s.stats_report_timezone || "America/Los_Angeles";
      const now = nowInTz(tz);
      const targetHour = s.stats_report_hour_local ?? 8;

      let dueNow = ignoreSchedule || !!forceClientId;
      if (!dueNow) {
        if (now.hour !== targetHour) { results.push({ client_id: s.client_id, skipped: `hour ${now.hour} != ${targetHour}` }); continue; }
        if (cadence === "weekly" && now.weekday !== (s.stats_report_day_of_week ?? 1)) {
          results.push({ client_id: s.client_id, skipped: `weekday ${now.weekday}` }); continue;
        }
        if (cadence === "monthly" && now.day !== (s.stats_report_day_of_month ?? 1)) {
          results.push({ client_id: s.client_id, skipped: `day ${now.day}` }); continue;
        }
        dueNow = true;
      }

      // Period = last 7 or 28 days ending yesterday
      const spanDays = cadence === "weekly" ? 7 : 28;
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (spanDays - 1));
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const periodStart = iso(startDate);
      const periodEnd = iso(endDate);

      // Idempotency: one send per client+cadence+period+email
      const perRecipientKeys = recips.map((email) => ({ email, key: `stats-sched:${s.client_id}:${cadence}:${periodStart}:${email.toLowerCase()}` }));
      const { data: existing } = await supabase
        .from("client_report_sends")
        .select("idempotency_key,status")
        .in("idempotency_key", perRecipientKeys.map((r) => r.key));
      const alreadySent = new Set((existing || []).filter((e: any) => e.status === "sent").map((e: any) => e.idempotency_key));

      const toSend = perRecipientKeys.filter((r) => !alreadySent.has(r.key));
      if (!toSend.length) { results.push({ client_id: s.client_id, skipped: "already sent for period" }); continue; }

      // Rollup metrics from daily_metrics
      const { data: dm } = await supabase
        .from("daily_metrics")
        .select("ad_spend, leads, calls, showed_calls, funded_investors, funded_dollars, impressions, clicks")
        .eq("client_id", s.client_id)
        .gte("date", periodStart)
        .lte("date", periodEnd);
      const t = (dm || []).reduce((a: any, r: any) => ({
        spend: a.spend + Number(r.ad_spend || 0),
        leads: a.leads + Number(r.leads || 0),
        calls: a.calls + Number(r.calls || 0),
        showed: a.showed + Number(r.showed_calls || 0),
        funded: a.funded + Number(r.funded_investors || 0),
        funded$: a.funded$ + Number(r.funded_dollars || 0),
        impressions: a.impressions + Number(r.impressions || 0),
        clicks: a.clicks + Number(r.clicks || 0),
      }), { spend: 0, leads: 0, calls: 0, showed: 0, funded: 0, funded$: 0, impressions: 0, clicks: 0 });

      const highlights = [
        { label: "Ad Spend", value: fmtUSD(t.spend) },
        { label: "Leads", value: fmtInt(t.leads), sub: t.leads > 0 ? `${fmtUSD(t.spend / t.leads)} / lead` : "—" },
        { label: "Calls Booked", value: fmtInt(t.calls), sub: t.calls > 0 ? `${fmtUSD(t.spend / t.calls)} / call` : "—" },
        { label: "Showed", value: fmtInt(t.showed), sub: t.calls > 0 ? fmtPct((t.showed / t.calls) * 100) + " show rate" : "—" },
        { label: "Funded", value: fmtInt(t.funded), sub: fmtUSD(t.funded$) },
        { label: "Cost of Capital", value: t.funded$ > 0 ? fmtPct((t.spend / t.funded$) * 100) : "—" },
      ];

      const publicUrl = client.public_token ? `${origin}/public/${client.public_token}` : undefined;
      const html = buildDigestHtml({
        clientName: client.name,
        cadence,
        periodStart,
        periodEnd,
        highlights,
        publicUrl,
      });
      const subject = `${client.name} — ${cadence === "weekly" ? "Weekly" : "Monthly"} performance recap (${periodStart} → ${periodEnd})`;

      for (const { email, key } of toSend) {
        if (dryRun) {
          results.push({ client_id: s.client_id, email, dry_run: true, key });
          continue;
        }
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/send-ghl-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              password: INTERNAL_PASSWORD,
              channel: "email",
              to_email: email,
              name: client.name,
              subject,
              html,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `send failed ${res.status}`);
          await supabase.from("client_report_sends").insert({
            client_id: s.client_id,
            cadence,
            channel: "email",
            period_start: periodStart,
            period_end: periodEnd,
            status: "sent",
            idempotency_key: key,
            ghl_message_id: data?.messageId || null,
            ghl_contact_id: data?.contactId || null,
            sent_at: new Date().toISOString(),
            payload: { subject, source: "dispatch-sheet-stats" },
          });
          results.push({ client_id: s.client_id, email, ok: true });
        } catch (e: any) {
          const msg = e?.message || String(e);
          await supabase.from("client_report_sends").insert({
            client_id: s.client_id,
            cadence,
            channel: "email",
            period_start: periodStart,
            period_end: periodEnd,
            status: "failed",
            error: msg,
            idempotency_key: key,
            payload: { subject, source: "dispatch-sheet-stats" },
          });
          results.push({ client_id: s.client_id, email, error: msg });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});