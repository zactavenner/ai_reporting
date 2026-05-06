import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const CHANNEL_NAME = "6-task-updates";
const PUBLIC_TASKS_URL = "https://reporting.highperformanceads.com/taskurl";

let cachedChannelId: string | null = null;

async function resolveChannelId(LOVABLE_API_KEY: string, SLACK_API_KEY: string): Promise<string | null> {
  if (cachedChannelId) return cachedChannelId;
  let cursor = "";
  do {
    const url = `${SLACK_GATEWAY_URL}/conversations.list?limit=200&types=public_channel,private_channel${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": SLACK_API_KEY,
      },
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`conversations.list: ${data.error}`);
    const match = data.channels?.find((c: any) => c.name === CHANNEL_NAME);
    if (match) {
      cachedChannelId = match.id;
      return cachedChannelId;
    }
    cursor = data.response_metadata?.next_cursor || "";
  } while (cursor);
  return null;
}

function buildMessage(payload: any): string {
  const { event, task, user_name, error, moved_to_stuck, errors, scanned } = payload;
  switch (event) {
    case "task_created":
      return `📋 *Task Created* — *${task?.title ?? "Untitled"}*\n👤 By: ${user_name || "System"}${task?.priority ? ` • Priority: ${task.priority}` : ""}${task?.due_date ? ` • Due: ${task.due_date}` : ""}`;
    case "task_completed":
      return `✅ *Task Completed* — *${task?.title ?? "Untitled"}*\n👤 By: ${user_name || "System"}`;
    case "task_overdue_stuck":
      return `⚠️ *Task Auto-Moved to Stuck (overdue 48h+)* — *${task?.title ?? "Untitled"}*\n📅 Due: ${task?.due_date || "n/a"}${task?.account_manager ? `\n👤 Account Manager added: ${task.account_manager}` : ""}\n🔗 <${PUBLIC_TASKS_URL}|View Stuck & Overdue Tasks>`;
    case "watchdog_summary":
      return `🕒 *Overdue Watchdog Run* — Scanned ${scanned ?? 0}, moved to Stuck: ${moved_to_stuck ?? 0}${(moved_to_stuck ?? 0) > 0 || errors?.length ? `\n🔗 <${PUBLIC_TASKS_URL}|View Stuck & Overdue Tasks>` : ""}${errors?.length ? `\n❌ Errors (${errors.length}):\n${errors.slice(0, 5).map((e: string) => `• ${e}`).join("\n")}` : ""}`;
    case "watchdog_error":
      return `🚨 *Overdue Watchdog ERROR*\n\`\`\`${(error || "unknown").toString().slice(0, 1500)}\`\`\`\n🔗 <${PUBLIC_TASKS_URL}|View Stuck & Overdue Tasks>`;
    default:
      return `📢 *Task Feed*: ${JSON.stringify(payload).slice(0, 800)}`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  if (!LOVABLE_API_KEY || !SLACK_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Slack not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await req.json();
    const channelId = await resolveChannelId(LOVABLE_API_KEY, SLACK_API_KEY);
    if (!channelId) {
      return new Response(JSON.stringify({ ok: false, error: `Channel #${CHANNEL_NAME} not found` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = buildMessage(payload);
    const res = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": SLACK_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: channelId, text, unfurl_links: false }),
    });
    const data = await res.json();
    return new Response(JSON.stringify({ ok: data.ok, channel: channelId, slack: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("slack-task-feed error:", err);
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});