import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { approval_id, title, client_name, priority, queue_type } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
    const CHANNEL = Deno.env.get("SLACK_APPROVALS_CHANNEL") || "";

    if (!LOVABLE_API_KEY || !SLACK_API_KEY || !CHANNEL) {
      console.log("Slack not fully configured; skipping approval notification", { approval_id });
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://reporting.highperformanceads.com/approvals?id=${approval_id}`;
    const text = `:rotating_light: *New P${priority} approval* — _${queue_type}_\n*${title}*\nClient: ${client_name}\n<${url}|Open Approvals Inbox>`;

    const res = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": SLACK_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: CHANNEL, text }),
    });
    const body = await res.text();
    if (!res.ok) console.error("Slack notify failed", res.status, body);

    return new Response(JSON.stringify({ ok: res.ok }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("approval-notify error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});