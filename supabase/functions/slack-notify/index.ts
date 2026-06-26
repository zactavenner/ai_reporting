import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  const SUPABASE_URL = Deno.env.get("ORIGINAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("ORIGINAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!LOVABLE_API_KEY || !SLACK_API_KEY) {
    return new Response(JSON.stringify({ error: "Slack not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { type, task, client_id, user_name, comment } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find all Slack channels mapped to this client
    const { data: mappings } = await supabase
      .from("slack_channel_mappings")
      .select("channel_id, channel_type")
      .eq("client_id", client_id);

    // Also check legacy channel mapping
    const { data: settings } = await supabase
      .from("client_settings")
      .select("slack_channel_id")
      .eq("client_id", client_id)
      .maybeSingle();

    const channels = new Set<string>();
    (mappings || []).forEach((m: any) => channels.add(m.channel_id));
    if (settings?.slack_channel_id) channels.add(settings.slack_channel_id);

    if (channels.size === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No Slack channels mapped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch client slug for public dashboard links
    const { data: clientInfo } = await supabase
      .from("clients")
      .select("slug, public_token")
      .eq("id", client_id)
      .maybeSingle();
    
    const slug = clientInfo?.slug || clientInfo?.public_token;
    const appUrl = Deno.env.get("APP_URL") || "https://reporting.highperformanceads.com";
    const taskLink = slug
      ? `${appUrl}/public/${slug}?task=${task.id}`
      : `${appUrl}/client/${client_id}?task=${task.id}`;
    let message = "";

    switch (type) {
      case "task_created":
        message = `📋 *New Task Created*\n\n*${task.title}*\n🎯 Priority: ${task.priority || "medium"}\n👤 By: ${user_name || "System"}\n🔗 <${taskLink}|View Task>`;
        break;

      case "task_updated":
        message = `🔄 *Task Updated*\n\n*${task.title}*\n📌 Status: ${task.status} → ${task.stage || task.status}\n👤 By: ${user_name || "System"}\n🔗 <${taskLink}|View Task>`;
        break;

      case "task_completed":
        message = `✅ *Task Completed*\n\n*${task.title}*\n👤 Completed by: ${user_name || "System"}\n🔗 <${taskLink}|View Task>`;
        break;

      case "task_comment":
        message = `💬 *New Comment on Task*\n\n*${task.title}*\n👤 ${user_name || "Someone"}: ${comment?.slice(0, 500) || ""}\n🔗 <${taskLink}|View Task>`;
        break;

      default:
        message = `📢 *Update for ${task?.title || "task"}*\n${JSON.stringify({ type, task: task?.title })}`;
    }

    // Post to all mapped channels
    const results = await Promise.allSettled(
      [...channels].map(async (channelId) => {
        const res = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": SLACK_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            channel: channelId,
            text: message,
            unfurl_links: false,
          }),
        });
        return res.json();
      })
    );

    // Log activity
    for (const channelId of channels) {
      await supabase.from("slack_activity_log").insert({
        client_id,
        channel_id: channelId,
        message_ts: `bot-${Date.now()}`,
        user_name: "HPA Bot",
        message_text: message,
        message_type: "bot_response",
        linked_task_id: task?.id || null,
      }).then(() => {}).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, channels_notified: channels.size }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("slack-notify error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
