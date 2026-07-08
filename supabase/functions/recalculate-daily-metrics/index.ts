import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void } | undefined;

/**
 * METRIC DATE BASIS:
 * - leads / leads_created: counted by leads.created_at (GHL dateAdded)
 * - calls / calls_scheduled: counted by calls.booked_at (when appointment was created)
 * - showed_calls / calls_showed: counted by calls.scheduled_at (actual appointment date when they showed)
 * - funded_investors / funded_on_day: counted by funded_investors.funded_at (stage change date)
 * - commitments / commitments_on_day: counted by funded_investors.funded_at where commitment_amount > 0
 * - ad_spend: summed from meta_ad_daily_insights by client_id + date (already in account TZ from Meta)
 *
 * DATE BUCKETING:
 * - All UTC timestamps are bucketed into the Meta ad account's timezone (from meta_ad_accounts.timezone_name).
 * - Fallback: 'UTC'.
 */

/**
 * Compute the UTC [start, end) bounds for a calendar day expressed in a given IANA timezone.
 * Uses Intl.DateTimeFormat to derive the UTC offset at noon of that local day (noon avoids
 * DST-transition edge cases affecting midnight specifically).
 */
function getLocalDayUTCBounds(dateStr: string, tz: string): { dayStart: string; dayNext: string } {
  if (tz === "UTC") {
    return {
      dayStart: `${dateStr}T00:00:00.000Z`,
      dayNext: new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() + 86400_000).toISOString(),
    };
  }
  // Reference point: noon UTC on the same calendar date
  const noonUTC = new Date(`${dateStr}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(noonUTC);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const [yr, mo, dy, hr, mn, sc] = [
    get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"),
  ];
  // UTC offset at the reference point: noonUTC = localNoon + offsetMs → offsetMs = noonUTC - localNoon(as UTC)
  const localNoonAsUTC = Date.UTC(yr, mo, dy, hr, mn, sc);
  const offsetMs = noonUTC.getTime() - localNoonAsUTC;
  // Local midnight on dateStr → UTC
  const [y, m, d] = dateStr.split("-").map(Number);
  const localMidnightUTC = Date.UTC(y, m - 1, d, 0, 0, 0) + offsetMs;
  return {
    dayStart: new Date(localMidnightUTC).toISOString(),
    dayNext: new Date(localMidnightUTC + 86400_000).toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let startDate: string;
  let endDate: string;
  let clientId: string | null = null;

  try {
    const body = await req.json();
    // Accept both snake_case and camelCase keys
    clientId = body.client_id || body.clientId || null;

    const sd = body.start_date || body.startDate;
    const ed = body.end_date || body.endDate;
    if (sd && ed) {
      startDate = sd;
      endDate = ed;
    } else {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      startDate = yesterday.toISOString().split("T")[0];
      endDate = today.toISOString().split("T")[0];
    }
  } catch {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    startDate = yesterday.toISOString().split("T")[0];
    endDate = today.toISOString().split("T")[0];
  }

  console.log(`[recalculate-daily-metrics] Range: ${startDate} to ${endDate}, client: ${clientId || "all"}`);

  // Get active clients (include meta_ad_account_id so we can resolve timezone)
  let clientsQuery = supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .in("status", ["active", "onboarding"]);

  if (clientId) {
    clientsQuery = clientsQuery.eq("id", clientId);
  }

  const { data: clients, error: clientsError } = await clientsQuery;
  if (clientsError || !clients) {
    console.error("Failed to fetch clients:", clientsError);
    return new Response(JSON.stringify({ success: false, error: "Failed to fetch clients" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const doRecalc = async () => {
    const summary: Array<{ clientId: string; name: string; daysUpdated: number; errors: string[] }> = [];

    for (const client of clients) {
      const clientResult = { clientId: client.id, name: client.name, daysUpdated: 0, errors: [] as string[] };

      // ── Resolve account timezone ──
      let clientTz = "UTC";
      if (client.meta_ad_account_id) {
        const { data: adAccount } = await supabase
          .from("meta_ad_accounts")
          .select("timezone_name")
          .eq("ad_account_id", client.meta_ad_account_id)
          .maybeSingle();
        clientTz = adAccount?.timezone_name || "UTC";
      }
      console.log(`[recalculate-daily-metrics] ${client.name} timezone: ${clientTz}`);

      const current = new Date(startDate + "T00:00:00Z");
      const end = new Date(endDate + "T00:00:00Z");

      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];

        // Compute UTC boundaries for this local calendar day in the account timezone
        const { dayStart, dayNext } = getLocalDayUTCBounds(dateStr, clientTz);

        try {
          // ── Leads: by created_at ──
          const { count: leadsCount } = await supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("client_id", client.id)
            .eq("is_spam", false)
            .gte("created_at", dayStart)
            .lt("created_at", dayNext);

          const { count: nullSpamCount } = await supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("client_id", client.id)
            .is("is_spam", null)
            .gte("created_at", dayStart)
            .lt("created_at", dayNext);

          const { count: spamCount } = await supabase
            .from("leads")
            .select("*", { count: "exact", head: true })
            .eq("client_id", client.id)
            .eq("is_spam", true)
            .gte("created_at", dayStart)
            .lt("created_at", dayNext);

          const totalValidLeads = (leadsCount || 0) + (nullSpamCount || 0);

          // ── Calls booked: by booked_at (non-reconnect) ──
          const { count: callsCount } = await supabase
            .from("calls")
            .select("*", { count: "exact", head: true })
            .eq("client_id", client.id)
            .neq("is_reconnect", true)
            .gte("booked_at", dayStart)
            .lt("booked_at", dayNext);

          // ── Showed calls: by scheduled_at (actual appointment date) ──
          const { count: showedCount } = await supabase
            .from("calls")
            .select("*", { count: "exact", head: true })
            .eq("client_id", client.id)
            .eq("showed", true)
            .neq("is_reconnect", true)
            .gte("scheduled_at", dayStart)
            .lt("scheduled_at", dayNext);

          // ── Calls scheduled for that day: by scheduled_at ──
          const { count: callsScheduledCount } = await supabase
            .from("calls")
            .select("*", { count: "exact", head: true })
            .eq("client_id", client.id)
            .neq("is_reconnect", true)
            .gte("scheduled_at", dayStart)
            .lt("scheduled_at", dayNext);

          // ── Reconnect calls by booked_at ──
          const { count: reconnectCount } = await supabase
            .from("calls")
            .select("*", { count: "exact", head: true })
            .eq("client_id", client.id)
            .eq("is_reconnect", true)
            .gte("booked_at", dayStart)
            .lt("booked_at", dayNext);

          // ── Reconnect showed by scheduled_at ──
          const { count: reconnectShowedCount } = await supabase
            .from("calls")
            .select("*", { count: "exact", head: true })
            .eq("client_id", client.id)
            .eq("is_reconnect", true)
            .eq("showed", true)
            .gte("scheduled_at", dayStart)
            .lt("scheduled_at", dayNext);

          // ── Funded investors: by funded_at (stage change date) ──
          const { data: fundedData, count: fundedCount } = await supabase
            .from("funded_investors")
            .select("funded_amount, commitment_amount", { count: "exact" })
            .eq("client_id", client.id)
            .gte("funded_at", dayStart)
            .lt("funded_at", dayNext);

          const fundedDollars = (fundedData || []).reduce((sum: number, f: any) => {
            const amount = f.funded_amount && f.funded_amount > 0 ? f.funded_amount : f.commitment_amount || 0;
            return sum + amount;
          }, 0);
          const commitmentDollars = (fundedData || []).reduce((sum: number, f: any) => sum + (f.commitment_amount || 0), 0);
          const commitmentCount = (fundedData || []).filter((f: any) => f.commitment_amount && f.commitment_amount > 0).length;

          // ── Ad spend: from meta_ad_daily_insights (date already in account TZ from Meta) ──
          const { data: spendRows } = await supabase
            .from("meta_ad_daily_insights")
            .select("spend")
            .eq("client_id", client.id)
            .eq("date", dateStr);
          const adSpend = (spendRows ?? []).reduce((s: number, r: any) => s + (Number(r.spend) || 0), 0);

          // UPSERT — CRM columns + ad_spend from Meta insights
          const { error: upsertError } = await supabase
            .from("daily_metrics")
            .upsert(
              {
                client_id: client.id,
                date: dateStr,
                leads: totalValidLeads,
                spam_leads: spamCount || 0,
                calls: callsCount || 0,
                showed_calls: showedCount || 0,
                reconnect_calls: reconnectCount || 0,
                reconnect_showed: reconnectShowedCount || 0,
                funded_investors: fundedCount || 0,
                funded_dollars: fundedDollars,
                commitments: commitmentCount,
                commitment_dollars: commitmentDollars,
                leads_created: totalValidLeads,
                calls_scheduled: callsScheduledCount || 0,
                calls_showed: showedCount || 0,
                commitments_on_day: commitmentCount,
                funded_on_day: fundedCount || 0,
                ad_spend: adSpend,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "client_id,date", ignoreDuplicates: false }
            );

          if (upsertError) {
            clientResult.errors.push(`${dateStr}: ${upsertError.message}`);
          } else {
            clientResult.daysUpdated++;
          }
        } catch (err) {
          clientResult.errors.push(`${dateStr}: ${err instanceof Error ? err.message : "Unknown"}`);
        }

        current.setUTCDate(current.getUTCDate() + 1);
      }

      console.log(`[recalculate-daily-metrics] ${client.name}: ${clientResult.daysUpdated} days updated, ${clientResult.errors.length} errors`);
      summary.push(clientResult);
    }

    const totalUpdated = summary.reduce((s, c) => s + c.daysUpdated, 0);
    const totalErrors = summary.reduce((s, c) => s + c.errors.length, 0);
    console.log(`[recalculate-daily-metrics] Complete: ${totalUpdated} days across ${clients.length} clients, ${totalErrors} errors`);
    return { success: true, summary, totalUpdated, totalErrors };
  };

  // Use background processing for large date ranges to avoid timeouts
  const startD = new Date(startDate);
  const endD = new Date(endDate);
  const dayCount = Math.round((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const isLargeRange = dayCount > 7 || (clients.length > 1 && dayCount > 3);

  if (isLargeRange && typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(doRecalc());
    return new Response(
      JSON.stringify({
        success: true,
        message: `Recalculation started in background for ${clients.length} client(s) over ${dayCount} days (${startDate} to ${endDate})`,
        background: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } else {
    const result = await doRecalc();
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
