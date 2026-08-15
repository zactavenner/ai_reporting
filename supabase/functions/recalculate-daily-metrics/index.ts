import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void } | undefined;

/**
 * Reporting 5.0 — daily_metrics is now a MATERIALISATION of public.v_daily_funnel_day.
 *
 * Rules (all enforced in SQL, see normalize_appointment_status / call_is_showed /
 * call_is_eligible / lead_quality_normalize):
 *  - leads               → leads.created_at, America/Los_Angeles buckets
 *  - calls (booked)      → calls.booked_at ONLY (never scheduled_at)
 *  - showed / no-show    → calls.scheduled_at, and only a real showed/completed CRM status
 *  - show rate           → showed / eligible (past, not cancelled/rescheduled/invalid)
 *  - commitments         → funded_investors.committed_at with commitment_amount > 0
 *  - funded              → funded_investors.funded_at with is_verified_funded AND funded_amount > 0
 *  - spend/impressions/clicks/ctr → public.ad_spend_daily (source of truth)
 *
 * Legacy daily_metrics columns are all still written so existing consumers keep working.
 */

const laToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* defaults below */ }

  const clientId: string | null = body.client_id || body.clientId || null;
  const yesterday = addDays(laToday(), -1);
  const startDate: string = body.start_date || body.startDate || yesterday;
  const endDate: string = body.end_date || body.endDate || yesterday;

  console.log(`[recalculate-daily-metrics] ${startDate} → ${endDate}, client: ${clientId || "all"}`);

  let clientsQuery = supabase.from("clients").select("id, name").in("status", ["active", "onboarding"]);
  if (clientId) clientsQuery = supabase.from("clients").select("id, name").eq("id", clientId);
  const { data: clients, error: clientsError } = await clientsQuery;

  if (clientsError || !clients) {
    return new Response(JSON.stringify({ success: false, error: clientsError?.message || "Failed to fetch clients" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const doRecalc = async () => {
    const summary: Array<{ clientId: string; name: string; daysUpdated: number; errors: string[] }> = [];

    for (const client of clients) {
      const result = { clientId: client.id, name: client.name, daysUpdated: 0, errors: [] as string[] };

      const { data: rows, error: viewErr } = await supabase
        .from("v_daily_funnel_day")
        .select("*")
        .eq("client_id", client.id)
        .gte("date", startDate)
        .lte("date", endDate);

      if (viewErr) {
        result.errors.push(viewErr.message);
        summary.push(result);
        continue;
      }

      const byDate = new Map<string, any>();
      for (const r of rows || []) byDate.set(r.date, r);

      for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
        const r = byDate.get(d) || {};
        const leadsTotal = Number(r.leads_total || 0);
        const leadsBad = Number(r.leads_bad || 0);
        const discoveryBooked = Number(r.discovery_booked || 0);
        const discoveryShowed = Number(r.discovery_showed || 0);
        const discoveryEligible = Number(r.discovery_eligible || 0);
        const reconnectBooked = Number(r.reconnect_booked || 0);
        const reconnectShowed = Number(r.reconnect_showed || 0);
        const commitments = Number(r.commitments || 0);
        const commitmentDollars = Number(r.commitment_dollars || 0);
        const fundedCount = Number(r.funded_count || 0);
        const fundedDollars = Number(r.funded_dollars || 0);
        const spend = Number(r.spend || 0);

        const { error: upsertError } = await supabase
          .from("daily_metrics")
          .upsert({
            client_id: client.id,
            date: d,
            // acquisition
            leads: leadsTotal,
            spam_leads: leadsBad,
            leads_created: leadsTotal,
            ad_spend: spend,
            impressions: Number(r.impressions || 0),
            clicks: Number(r.clicks || 0),
            ctr: Number(r.ctr || 0),
            // calls
            calls: discoveryBooked,
            calls_scheduled: discoveryEligible,
            showed_calls: discoveryShowed,
            calls_showed: discoveryShowed,
            reconnect_calls: reconnectBooked,
            reconnect_showed: reconnectShowed,
            // revenue
            commitments,
            commitments_on_day: commitments,
            commitment_dollars: commitmentDollars,
            funded_investors: fundedCount,
            funded_on_day: fundedCount,
            funded_dollars: fundedDollars,
            updated_at: new Date().toISOString(),
          }, { onConflict: "client_id,date", ignoreDuplicates: false });

        if (upsertError) result.errors.push(`${d}: ${upsertError.message}`);
        else result.daysUpdated++;
      }

      console.log(`[recalculate-daily-metrics] ${client.name}: ${result.daysUpdated} days, ${result.errors.length} errors`);
      summary.push(result);
    }

    const totalUpdated = summary.reduce((s, c) => s + c.daysUpdated, 0);
    const totalErrors = summary.reduce((s, c) => s + c.errors.length, 0);
    return { success: true, summary, totalUpdated, totalErrors, startDate, endDate };
  };

  const dayCount = Math.round(
    (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86400000,
  ) + 1;
  const isLargeRange = dayCount > 14 || (clients.length > 3 && dayCount > 7);

  if (isLargeRange && typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(doRecalc());
    return new Response(JSON.stringify({
      success: true, background: true,
      message: `Recalculation started for ${clients.length} client(s) over ${dayCount} days (${startDate} → ${endDate})`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const result = await doRecalc();
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
