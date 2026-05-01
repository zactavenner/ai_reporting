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

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
    if (!SLACK_API_KEY) throw new Error("SLACK_API_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { taskId, clientId } = await req.json();
    if (!taskId || !clientId) throw new Error("taskId and clientId are required");

    // KILL SWITCH: only allow Slack notifications for Blue Capital clients
    const { data: clientCheck } = await supabase
      .from("clients").select("name").eq("id", clientId).maybeSingle();
    const isBlueCapital = (clientCheck?.name || "").toLowerCase().includes("blue capital");
    if (!isBlueCapital) {
      console.log(`send-task-review-slack skipped: ${clientCheck?.name || clientId} is not Blue Capital`);
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "client_not_blue_capital" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch task
    const { data: task, error: taskErr } = await supabase
      .from("tasks").select("*").eq("id", taskId).single();
    if (taskErr) throw new Error(`Failed to fetch task: ${taskErr.message}`);

    // Fetch slack channel from client_settings
    const { data: settings } = await supabase
      .from("client_settings")
      .select("slack_review_channel_id")
      .eq("client_id", clientId)
      .maybeSingle();

    const channelId = settings?.slack_review_channel_id;
    if (!channelId) {
      return new Response(
        JSON.stringify({ success: false, reason: "No Slack channel configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch assignees
    const { data: assignees = [] } = await supabase
      .from("task_assignees")
      .select("member:agency_members(name), pod:agency_pods(name)")
      .eq("task_id", taskId);

    const assigneeNames: string[] = [];
    for (const a of assignees || []) {
      if ((a as any).member?.name) assigneeNames.push((a as any).member.name);
      if ((a as any).pod?.name) assigneeNames.push(`${(a as any).pod.name} (Pod)`);
    }
    if (assigneeNames.length === 0 && task.assigned_to) {
      const { data: member } = await supabase
        .from("agency_members").select("name").eq("id", task.assigned_to).maybeSingle();
      if (member?.name) assigneeNames.push(member.name);
    }

    // Fetch last comment
    const { data: lastCommentArr = [] } = await supabase
      .from("task_comments").select("*").eq("task_id", taskId)
      .order("created_at", { ascending: false }).limit(1);
    const lastComment = lastCommentArr?.[0] || null;

    // Format due date
    const dueDateStr = task.due_date
      ? new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "No due date";

    // Build blocks
    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: "📋 Task Ready for Review", emoji: true } },
      { type: "divider" },
      { type: "section", text: { type: "mrkdwn", text: `*Task Title:*\n${task.title}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Task Description:*\n${task.description || "_No description_"}` } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Due Date:*\n${dueDateStr}` },
          { type: "mrkdwn", text: `*Assigned To:*\n${assigneeNames.length > 0 ? assigneeNames.join(", ") : "Unassigned"}` },
        ],
      },
    ];

    if (lastComment) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*💬 Last Comment:*\n*${lastComment.author_name}:* ${lastComment.content}` },
      });
    }

    // Look up Nathan Silsbee's Slack user ID to mention him
    const NATHAN_EMAIL = "nathan.silsbee@gmail.com";
    let nathanMention = "";
    try {
      const lookupRes = await fetch(`${SLACK_GATEWAY_URL}/users.lookupByEmail?email=${encodeURIComponent(NATHAN_EMAIL)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": SLACK_API_KEY,
        },
      });
      const lookupData = await lookupRes.json();
      if (lookupData.ok && lookupData.user?.id) {
        nathanMention = `<@${lookupData.user.id}>`;
        blocks.push({ type: "divider" });
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `cc ${nathanMention}` },
        });
      } else {
        console.warn("Could not find Nathan's Slack user:", JSON.stringify(lookupData));
      }
    } catch (lookupErr) {
      console.warn("Failed to look up Nathan's Slack user:", lookupErr);
    }

    // Send via connector gateway
    const slackRes = await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": SLACK_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        text: `📋 Task Ready for Review: ${task.title} ${nathanMention}`,
        blocks,
      }),
    });

    const slackData = await slackRes.json();
    if (!slackRes.ok || !slackData.ok) {
      throw new Error(`Slack API call failed [${slackRes.status}]: ${JSON.stringify(slackData)}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending Slack review notification:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
