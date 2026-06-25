import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INTERNAL_PASSWORD = "HPA1234$";
const BRAND = { green: "#0B2B26", gold: "#C5A55A", cream: "#FAF6EE", ink: "#0F1A18" };

function pctDelta(curr: number, prev: number): { pct: number; dir: "up" | "down" | "flat" } {
  if (!prev) return { pct: curr ? 100 : 0, dir: curr ? "up" : "flat" };
  const pct = ((curr - prev) / prev) * 100;
  return { pct, dir: pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat" };
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const num = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => `${n.toFixed(1)}%`;

function periodWindows(cadence: "weekly" | "monthly", ref = new Date()) {
  const end = new Date(ref);
  const start = new Date(ref);
  const prevEnd = new Date(ref);
  const prevStart = new Date(ref);
  if (cadence === "weekly") {
    start.setDate(end.getDate() - 7);
    prevEnd.setDate(end.getDate() - 7);
    prevStart.setDate(end.getDate() - 14);
  } else {
    start.setMonth(end.getMonth() - 1);
    prevEnd.setMonth(end.getMonth() - 1);
    prevStart.setMonth(end.getMonth() - 2);
  }
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd) };
}

async function fetchKpis(supabase: any, clientId: string, start: string, end: string) {
  const { data } = await supabase.rpc("get_client_source_metrics", { p_start_date: start, p_end_date: end });
  const row = (data || []).find((r: any) => r.client_id === clientId) || {};
  const { data: spendRows } = await supabase
    .from("daily_metrics")
    .select("spend")
    .eq("client_id", clientId)
    .gte("date", start)
    .lte("date", end);
  const spend = (spendRows || []).reduce((a: number, r: any) => a + Number(r.spend || 0), 0);
  const leads = Number(row.total_leads || 0);
  const calls = Number(row.total_calls || 0);
  const showed = Number(row.showed_calls || 0);
  const fundedDollars = Number(row.funded_dollars || 0);
  return {
    spend,
    leads,
    cpl: leads ? spend / leads : 0,
    calls,
    showed,
    showRate: calls ? (showed / calls) * 100 : 0,
    fundedDollars,
    coc: fundedDollars ? (spend / fundedDollars) * 100 : 0,
  };
}

function renderEmailHtml(client: any, period: string, curr: any, prev: any, top: any, reportUrl: string, unsubUrl: string) {
  const kpi = (label: string, value: string, currN: number, prevN: number, lowerIsBetter = false) => {
    const d = pctDelta(currN, prevN);
    const good = lowerIsBetter ? d.dir === "down" : d.dir === "up";
    const color = d.dir === "flat" ? "#94a3b8" : good ? "#16a34a" : "#dc2626";
    const arrow = d.dir === "up" ? "▲" : d.dir === "down" ? "▼" : "—";
    return `<td style="padding:14px 12px;border:1px solid #e5e0d3;background:#fff;border-radius:10px;vertical-align:top;width:33%">
      <div style="font:11px/1 Inter,Arial,sans-serif;color:#6b6358;letter-spacing:.08em;text-transform:uppercase">${label}</div>
      <div style="font:600 22px/1.2 'Playfair Display',Georgia,serif;color:${BRAND.ink};margin-top:6px">${value}</div>
      <div style="font:11px/1 Inter,Arial,sans-serif;color:${color};margin-top:6px">${arrow} ${Math.abs(d.pct).toFixed(1)}% vs prior</div>
    </td>`;
  };
  const topBlock = top
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border:1px solid #e5e0d3;border-radius:12px;background:#fff">
        <tr>
          ${top.thumbnail_url ? `<td width="120" style="padding:14px"><img src="${top.thumbnail_url}" width="100" style="border-radius:8px;display:block"/></td>` : ""}
          <td style="padding:14px">
            <div style="font:11px/1 Inter,Arial,sans-serif;color:${BRAND.gold};letter-spacing:.08em;text-transform:uppercase">Top performer · ${top.scope}</div>
            <div style="font:600 16px/1.3 'Playfair Display',Georgia,serif;color:${BRAND.ink};margin-top:4px">${(top.name || "Unnamed").slice(0, 80)}</div>
            <div style="font:13px/1.5 Inter,Arial,sans-serif;color:#4b5563;margin-top:6px">CPL ${money(Number(top.cost_per_lead || 0))} · Funded ${money(Number(top.funded_dollars || 0))}</div>
          </td>
        </tr>
      </table>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:${BRAND.cream};font-family:Inter,Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:32px 16px">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px">
          <tr><td style="padding:8px 4px 20px">
            <table width="100%"><tr>
              <td>${client.logo_url ? `<img src="${client.logo_url}" height="36" style="display:block"/>` : `<div style="font:600 18px 'Playfair Display',Georgia,serif;color:${BRAND.green}">${client.name}</div>`}</td>
              <td align="right" style="font:11px Inter,Arial,sans-serif;color:#6b6358;letter-spacing:.08em;text-transform:uppercase">${period}</td>
            </tr></table>
          </td></tr>
          <tr><td style="background:${BRAND.green};color:#fff;padding:28px 26px;border-radius:14px">
            <div style="font:11px Inter,Arial,sans-serif;color:${BRAND.gold};letter-spacing:.12em;text-transform:uppercase">Performance Recap</div>
            <div style="font:600 28px/1.2 'Playfair Display',Georgia,serif;margin-top:6px">${client.name}</div>
            <div style="font:13px/1.5 Inter,Arial,sans-serif;color:#d6cfbe;margin-top:8px">${period} · prepared by High Performance Ads</div>
          </td></tr>
          <tr><td style="padding:18px 0 6px;font:11px Inter,Arial,sans-serif;color:#6b6358;letter-spacing:.08em;text-transform:uppercase">Acquisition</td></tr>
          <tr><td><table width="100%" cellpadding="0" cellspacing="6"><tr>
            ${kpi("Spend", money(curr.spend), curr.spend, prev.spend, true)}
            ${kpi("Leads", num(curr.leads), curr.leads, prev.leads)}
            ${kpi("CPL", money(curr.cpl), curr.cpl, prev.cpl, true)}
          </tr></table></td></tr>
          <tr><td style="padding:18px 0 6px;font:11px Inter,Arial,sans-serif;color:#6b6358;letter-spacing:.08em;text-transform:uppercase">Sales</td></tr>
          <tr><td><table width="100%" cellpadding="0" cellspacing="6"><tr>
            ${kpi("Calls booked", num(curr.calls), curr.calls, prev.calls)}
            ${kpi("Showed", num(curr.showed), curr.showed, prev.showed)}
            ${kpi("Show rate", pct(curr.showRate), curr.showRate, prev.showRate)}
          </tr></table></td></tr>
          <tr><td style="padding:18px 0 6px;font:11px Inter,Arial,sans-serif;color:#6b6358;letter-spacing:.08em;text-transform:uppercase">Revenue</td></tr>
          <tr><td><table width="100%" cellpadding="0" cellspacing="6"><tr>
            ${kpi("Funded", money(curr.fundedDollars), curr.fundedDollars, prev.fundedDollars)}
            ${kpi("Cost of capital", pct(curr.coc), curr.coc, prev.coc, true)}
            <td style="padding:14px 12px;border:1px solid #e5e0d3;background:#fff;border-radius:10px;width:33%"></td>
          </tr></table></td></tr>
          <tr><td>${topBlock}</td></tr>
          <tr><td align="center" style="padding:28px 0 8px">
            <a href="${reportUrl}" style="display:inline-block;background:${BRAND.green};color:#fff;padding:14px 28px;border-radius:999px;font:600 14px Inter,Arial,sans-serif;text-decoration:none;letter-spacing:.04em">View full report →</a>
          </td></tr>
          <tr><td style="padding:24px 4px 8px;font:11px/1.6 Inter,Arial,sans-serif;color:#8a8170">
            Targeted returns are not guaranteed. Investments carry risk of loss. Past performance is not indicative of future results. Not an offer or solicitation. Subject to SEC/FINRA regulation.
          </td></tr>
          <tr><td style="padding:6px 4px 0;font:11px Inter,Arial,sans-serif;color:#8a8170">
            <a href="${unsubUrl}" style="color:#8a8170;text-decoration:underline">Unsubscribe</a> · High Performance Ads
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function renderSms(client: any, period: string, curr: any, prev: any, reportUrl: string) {
  const cplD = pctDelta(curr.cpl, prev.cpl);
  const cplArrow = cplD.dir === "down" ? "↓" : cplD.dir === "up" ? "↑" : "→";
  const leadD = pctDelta(curr.leads, prev.leads);
  const leadArrow = leadD.dir === "up" ? "↑" : leadD.dir === "down" ? "↓" : "→";
  const msg = `${client.name} · ${period}\nLeads ${num(curr.leads)} ${leadArrow}${Math.abs(leadD.pct).toFixed(0)}% · CPL ${money(curr.cpl)} ${cplArrow}${Math.abs(cplD.pct).toFixed(0)}%\nFunded ${money(curr.fundedDollars)} · CoC ${pct(curr.coc)}\nFull report: ${reportUrl}`;
  return msg.slice(0, 300);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    if (body?.password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { client_id, cadence } = body;
    if (!client_id || !["weekly", "monthly"].includes(cadence)) {
      return new Response(JSON.stringify({ error: "client_id + cadence required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client, error: cErr } = await supabase.from("clients").select("id,name,logo_url,public_token,slug").eq("id", client_id).single();
    if (cErr || !client) throw new Error("client not found");

    const w = periodWindows(cadence);
    const [curr, prev, topRes] = await Promise.all([
      fetchKpis(supabase, client_id, w.start, w.end),
      fetchKpis(supabase, client_id, w.prevStart, w.prevEnd),
      supabase.rpc("get_top_performers", { p_client_ids: [client_id] }),
    ]);
    const top = (topRes.data || []).find((r: any) => r.scope === "ad") || (topRes.data || [])[0];

    const origin = body.origin || "https://aireporting.lovable.app";
    const reportUrl = `${origin}/public/${client.public_token || client.slug}`;
    const period = cadence === "weekly" ? `Week of ${w.start}` : `Month ending ${w.end}`;

    return new Response(JSON.stringify({
      client,
      cadence,
      period,
      period_start: w.start,
      period_end: w.end,
      kpis: curr,
      prior: prev,
      top,
      reportUrl,
      renderEmailHtml: (unsubUrl: string) => null, // placeholder
      html: renderEmailHtml(client, period, curr, prev, top, reportUrl, `${origin}/unsubscribe?token=__UNSUB__`),
      sms: renderSms(client, period, curr, prev, reportUrl),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});