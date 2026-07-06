import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { approval_id } = await req.json();
    if (!approval_id) {
      return new Response(JSON.stringify({ error: "approval_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error } = await supabase
      .from("approval_queue")
      .select("id, queue_type, preview_payload, client_id, audit_log_id, status")
      .eq("id", approval_id)
      .maybeSingle();
    if (error || !row) throw new Error(error?.message || "approval not found");

    if (!["approved", "edited_approved"].includes(row.status)) {
      return new Response(JSON.stringify({ executed: false, reason: "not approved" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = (row.preview_payload || {}) as any;
    let result: any = { executed: false, reason: "executor not yet implemented for this type" };

    try {
      if (row.queue_type === "message") {
        if (payload.channel === "slack" && payload.slack_channel && payload.body) {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/slack-send-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ channel: payload.slack_channel, text: payload.body }),
          });
          result = { executed: r.ok, channel: "slack", status: r.status };
        } else if (payload.channel === "sms" && payload.to && payload.body) {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/send-sms-imessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ to: payload.to, message: payload.body, client_id: row.client_id }),
          });
          result = { executed: r.ok, channel: "sms", status: r.status };
        } else {
          result = { executed: false, reason: "message payload missing channel/body" };
        }
      } else if (row.queue_type === "report") {
        if (payload.report_id) {
          const { error: upErr } = await supabase
            .from("daily_reports")
            .update({ status: "published", published_at: new Date().toISOString() } as any)
            .eq("id", payload.report_id);
          result = upErr
            ? { executed: false, reason: upErr.message }
            : { executed: true, report_id: payload.report_id };
        } else {
          result = { executed: false, reason: "report payload missing report_id" };
        }
      }
    } catch (e) {
      result = { executed: false, reason: String(e) };
    }

    console.log("execute-approved-action", { approval_id, queue_type: row.queue_type, result });

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("execute-approved-action error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});