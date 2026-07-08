import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const INTERNAL_PASSWORD = "HPA1234$";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const ZAC_PHONE = "+19167097345";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function money(n: number) { return `$${Math.round(n).toLocaleString()}`; }

// 🟢 at or under target, 🟡 up to 20% over, 🔴 more than 20% over
// If target missing or metric is 0, returns "⚪"
function light(actual: number, target: number | null | undefined, lowerIsBetter = true): string {
  if (!target || target <= 0) return "⚪";
  if (!actual || actual <= 0) return "⚪";
  const ratio = actual / target;
  if (lowerIsBetter) {
    if (ratio <= 1) return "🟢";
    if (ratio <= 1.2) return "🟡";
    return "🔴";
  } else {
    if (ratio >= 1) return "🟢";
    if (ratio >= 0.8) return "🟡";
    return "🔴";
  }
}

// Returns formatted "$X (Δ+$Y / +Z%)" vs target. Lower-is-better cost metrics.
function kpiCell(actual: number, target: number | null | undefined): string {
  const light_ = light(actual, target);
  const val = money(actual);
  if (!target || target <= 0) return `${light_}${val}`;
  const delta = actual - target;
  const pct = target > 0 ? Math.round((delta / target) * 100) : 0;
  const sign = delta >= 0 ? "+" : "-";
  return `${light_}${val} (tgt ${money(target)} ${sign}${money(Math.abs(delta))}/${delta >= 0 ? "+" : ""}${pct}%)`;
}

async function fetchWindow(sb: any, clientId: string, start: string, end: string) {
  const { data } = await sb
    .from("daily_metrics")
    .select("ad_spend,leads,calls,showed_calls,funded_investors,funded_dollars")
    .eq("client_id", clientId)
    .gte("date", start)
    .lte("date", end);
  const rows = data || [];
  const t = rows.reduce((a: any, r: any) => ({
    spend: a.spend + Number(r.ad_spend || 0),
    leads: a.leads + Number(r.leads || 0),
    calls: a.calls + Number(r.calls || 0),
    showed: a.showed + Number(r.showed_calls || 0),
    funded: a.funded + Number(r.funded_investors || 0),
    fundedDollars: a.fundedDollars + Number(r.funded_dollars || 0),
  }), { spend: 0, leads: 0, calls: 0, showed: 0, funded: 0, fundedDollars: 0 });
  return {
    ...t,
    cpl: t.leads ? t.spend / t.leads : 0,
    cpbc: t.calls ? t.spend / t.calls : 0,
    cps: t.showed ? t.spend / t.showed : 0,
    cpf: t.funded ? t.spend / t.funded : 0,
    coc: t.fundedDollars ? (t.spend / t.fundedDollars) * 100 : 0,
  };
}

async function ghlSend(toPhone: string, message: string) {
  const token = Deno.env.get("AGENCY_GHL_PIT_TOKEN") || Deno.env.get("AGENCY_GHL_API_KEY");
  const locationId = Deno.env.get("AGENCY_GHL_LOCATION_ID");
  if (!token || !locationId) throw new Error("GHL agency credentials missing");

  // upsert contact
  const upRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ locationId, phone: toPhone, firstName: "Zac" }),
  });
  const upText = await upRes.text();
  if (!upRes.ok) throw new Error(`GHL upsert ${upRes.status}: ${upText.slice(0, 200)}`);
  const upJson = JSON.parse(upText);
  const contactId = upJson?.contact?.id || upJson?.id;
  if (!contactId) throw new Error("contact upsert failed");

  const msgRes = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ contactId, type: "SMS", message, toNumber: toPhone }),
  });
  const msgText = await msgRes.text();
  if (!msgRes.ok) throw new Error(`GHL send ${msgRes.status}: ${msgText.slice(0, 200)}`);
  return JSON.parse(msgText);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.password !== INTERNAL_PASSWORD) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Optional date override (defaults: yesterday)
    const refDate = body?.date ? new Date(body.date) : new Date();
    if (!body?.date) refDate.setUTCDate(refDate.getUTCDate() - 1);
    const yest = ymd(refDate);
    const start7 = new Date(refDate); start7.setUTCDate(start7.getUTCDate() - 6);
    const s7 = ymd(start7);

    const { data: clients } = await sb
      .from("clients")
      .select("id,name")
      .eq("status", "active")
      .order("name");

    const { data: targets } = await sb
      .from("client_kpi_targets")
      .select("client_id,target_cpl,target_cps,target_cpbc,target_cost_per_funded");
    const tMap = new Map((targets || []).map((t: any) => [t.client_id, t]));

    const lines: string[] = [];
    lines.push(`HPA Daily · ${yest}`);
    lines.push(`(Y=yesterday, 7=7d rolling · 🟢≤tgt 🟡≤+20% 🔴>+20% ⚪no tgt)`);
    lines.push("");

    let totalSpendY = 0, totalLeadsY = 0, totalFundedY = 0;

    for (const c of clients || []) {
      const tgt: any = tMap.get(c.id) || {};
      const [y, w] = await Promise.all([
        fetchWindow(sb, c.id, yest, yest),
        fetchWindow(sb, c.id, s7, yest),
      ]);
      if (!y.spend && !y.leads && !w.spend && !w.leads) continue; // skip idle clients

      totalSpendY += y.spend;
      totalLeadsY += y.leads;
      totalFundedY += y.fundedDollars;

      lines.push(`• ${c.name}`);
      lines.push(`  Y spend ${money(y.spend)} · ${y.leads}L · ${y.calls}C · Fnd ${money(y.fundedDollars)}`);
      lines.push(`    CPL ${kpiCell(y.cpl, tgt.target_cpl)}`);
      lines.push(`    CPBC ${kpiCell(y.cpbc, tgt.target_cpbc)}`);
      lines.push(`    CPS ${kpiCell(y.cps, tgt.target_cps)}`);
      lines.push(`    CPF ${kpiCell(y.cpf, tgt.target_cost_per_funded)}`);
      lines.push(`  7d spend ${money(w.spend)} · ${w.leads}L · ${w.calls}C · Fnd ${money(w.fundedDollars)}`);
      lines.push(`    CPL ${kpiCell(w.cpl, tgt.target_cpl)}`);
      lines.push(`    CPBC ${kpiCell(w.cpbc, tgt.target_cpbc)}`);
      lines.push(`    CPS ${kpiCell(w.cps, tgt.target_cps)}`);
      lines.push(`    CPF ${kpiCell(w.cpf, tgt.target_cost_per_funded)}`);
    }

    lines.splice(2, 0, `Agency Y: ${money(totalSpendY)} spend · ${totalLeadsY} leads · ${money(totalFundedY)} funded`);

    const message = lines.join("\n");

    let sendResult: any = null;
    let sendError: string | null = null;
    try {
      sendResult = await ghlSend(ZAC_PHONE, message);
    } catch (e: any) {
      sendError = String(e?.message || e);
    }

    // Log to cron_run_log
    await sb.rpc("log_cron_run", {
      p_job_name: "daily-kpi-sms",
      p_status: sendError ? "error" : "success",
      p_status_code: sendError ? 500 : 200,
      p_response_body: message.slice(0, 2000),
      p_error_message: sendError,
      p_duration_ms: null,
    }).then(() => {}).catch(() => {});

    return new Response(JSON.stringify({
      ok: !sendError,
      to: ZAC_PHONE,
      date: yest,
      length: message.length,
      message,
      sendResult,
      sendError,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});