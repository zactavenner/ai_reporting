import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const DEFAULT_CHANNEL = "C079MMNEKK6"; // #sales-reporting

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let channel = DEFAULT_CHANNEL;
    try {
      const body = await req.json();
      if (body?.channel) channel = body.channel;
    } catch {}

    // Pull sync health view (already aggregates last_meta/last_ghl per client)
    const { data: clients } = await supabase
      .from("client_sync_health")
      .select("client_id, client_name, has_ghl_credentials, meta_ad_account_id, last_meta_success_at, last_ghl_success_at, last_ghl_error, meta_hours_since_success, ghl_hours_since_success, overall_health");

    if (!clients?.length) {
      return new Response(JSON.stringify({ success: true, message: "No clients" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    const ghlIssues: string[] = [];
    const metaIssues: string[] = [];

    for (const c of clients) {
      if (c.has_ghl_credentials) {
        const hours = c.ghl_hours_since_success != null ? Math.round(c.ghl_hours_since_success) : -1;
        if (hours < 0) ghlIssues.push(`• *${c.client_name}* — never synced`);
        else if (hours > 25) {
          const errPart = c.last_ghl_error ? ` _(${String(c.last_ghl_error).substring(0, 80)})_` : "";
          ghlIssues.push(`• *${c.client_name}* — ${hours}h stale${errPart}`);
        }
      }
      if (c.meta_ad_account_id) {
        const hours = c.meta_hours_since_success != null ? Math.round(c.meta_hours_since_success) : -1;
        if (hours < 0) metaIssues.push(`• *${c.client_name}* — never synced`);
        else if (hours > 25) metaIssues.push(`• *${c.client_name}* — ${hours}h stale`);
      }
    }

    // Check master sync ran today
    const dayAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const { data: masterRuns } = await supabase
      .from("sync_runs")
      .select("started_at")
      .eq("function_name", "daily-master-sync")
      .eq("source", "master")
      .gte("started_at", dayAgo)
      .limit(1);

    const masterMissing = !masterRuns?.length;

    // Recent reconciliation results with low match rate
    const today = new Date().toISOString().split("T")[0];
    const { data: recon } = await supabase
      .from("ghl_reconciliation_results")
      .select("client_id, local_lead_count, ghl_contact_count, matched_count, notes")
      .eq("reconciliation_date", today);

    const reconIssues: string[] = [];
    for (const r of recon || []) {
      if (r.ghl_contact_count > 0) {
        const ratio = r.matched_count / r.ghl_contact_count;
        if (ratio < 0.95) {
          const client = clients.find((c: any) => c.client_id === r.client_id);
          if (client) reconIssues.push(`• *${client.client_name}* — ${(ratio * 100).toFixed(1)}% match (${r.matched_count}/${r.ghl_contact_count})`);
        }
      }
    }

    // Build message
    const totalIssues = ghlIssues.length + metaIssues.length + reconIssues.length + (masterMissing ? 1 : 0);
    let message: string;
    if (totalIssues === 0) {
      message = `✅ *Sync Health — Daily Digest*\nAll ${clients.length} clients synced within 24h. No errors.`;
    } else {
      message = `⚠️ *Sync Health — Daily Digest*\n${totalIssues} issue${totalIssues === 1 ? "" : "s"} detected across ${clients.length} clients.`;
      if (masterMissing) message += `\n\n🚨 *Master cron did NOT fire in last 25h*`;
      if (ghlIssues.length) message += `\n\n*GHL sync issues (${ghlIssues.length}):*\n${ghlIssues.slice(0, 15).join("\n")}${ghlIssues.length > 15 ? `\n_…+${ghlIssues.length - 15} more_` : ""}`;
      if (metaIssues.length) message += `\n\n*Meta sync issues (${metaIssues.length}):*\n${metaIssues.slice(0, 10).join("\n")}${metaIssues.length > 10 ? `\n_…+${metaIssues.length - 10} more_` : ""}`;
      if (reconIssues.length) message += `\n\n*Reconciliation mismatches (${reconIssues.length}):*\n${reconIssues.slice(0, 10).join("\n")}`;
    }

    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
    if (!LOVABLE_API_KEY || !SLACK_API_KEY) {
      console.warn("[sync-failure-digest] Slack not configured — digest:\n" + message);
      return new Response(JSON.stringify({ success: true, message, slack_sent: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const slackRes = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": SLACK_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text: message, unfurl_links: false }),
    });
    const slackResult = await slackRes.json();

    return new Response(
      JSON.stringify({ success: true, slack_ok: slackResult.ok, slack_error: slackResult.error, total_issues: totalIssues }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[sync-failure-digest] error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});