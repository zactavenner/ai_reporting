import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SLACK_GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";
const AI_GATEWAY = "https://openrouter.ai/api/v1/chat/completions";

async function slackGet(
  path: string,
  params: Record<string, string>,
  LOVABLE_API_KEY: string,
  SLACK_API_KEY: string,
) {
  const response = await fetch(`${SLACK_GATEWAY_URL}/${path}?${new URLSearchParams(params).toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": SLACK_API_KEY,
    },
  });

  const data = await response.json();
  return { response, data };
}

async function slackPost(
  path: string,
  body: Record<string, unknown>,
  LOVABLE_API_KEY: string,
  SLACK_API_KEY: string,
) {
  const response = await fetch(`${SLACK_GATEWAY_URL}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": SLACK_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return { response, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  const SUPABASE_URL = Deno.env.get("ORIGINAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("ORIGINAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!SLACK_API_KEY) {
    return new Response(JSON.stringify({ error: "SLACK_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { client_id, channel_id, limit = 100, auto_create_tasks = true } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get channels to sync
    let channelsToSync: { channel_id: string; client_id: string; auto_create_tasks: boolean; channel_name: string | null }[] = [];

    if (channel_id && client_id) {
      channelsToSync = [{ channel_id, client_id, auto_create_tasks, channel_name: null }];
    } else if (client_id) {
      const { data: mappings } = await supabase
        .from("slack_channel_mappings")
        .select("channel_id, client_id, auto_create_tasks, channel_name")
        .eq("client_id", client_id)
        .eq("monitor_messages", true);
      channelsToSync = (mappings || []) as any;
    } else {
      // Sync all monitored channels
      const { data: mappings } = await supabase
        .from("slack_channel_mappings")
        .select("channel_id, client_id, auto_create_tasks, channel_name")
        .eq("monitor_messages", true);
      channelsToSync = (mappings || []) as any;
    }

    if (channelsToSync.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No channels to sync", synced: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalMessages = 0;
    let tasksCreated = 0;
    const results: any[] = [];

    for (const ch of channelsToSync) {
      try {
        // Get the latest message timestamp we already have for this channel
        const { data: latestLog } = await supabase
          .from("slack_activity_log")
          .select("message_ts")
          .eq("channel_id", ch.channel_id)
          .order("message_ts", { ascending: false })
          .limit(1)
          .maybeSingle();

        // Fetch messages from Slack via gateway
        const params: Record<string, string> = {
          channel: ch.channel_id,
          limit: String(Math.min(limit, 200)),
        };
        if (latestLog?.message_ts) {
          params.oldest = latestLog.message_ts;
        }

        let { response: historyRes, data: historyData } = await slackGet(
          "conversations.history",
          params,
          LOVABLE_API_KEY,
          SLACK_API_KEY,
        );

        if (historyData?.error === "not_in_channel" || historyData?.error === "channel_not_found") {
          const { data: joinData } = await slackPost(
            "conversations.join",
            { channel: ch.channel_id },
            LOVABLE_API_KEY,
            SLACK_API_KEY,
          );

          if (joinData?.ok) {
            ({ response: historyRes, data: historyData } = await slackGet(
              "conversations.history",
              params,
              LOVABLE_API_KEY,
              SLACK_API_KEY,
            ));
          } else {
            console.error(`Failed to join channel ${ch.channel_id}:`, joinData);
          }
        }

        if (!historyRes.ok || !historyData?.ok) {
          console.error(`Failed to fetch history for ${ch.channel_id}:`, historyRes.status, historyData);
          results.push({
            channel_id: ch.channel_id,
            error: historyData?.error || `HTTP ${historyRes.status}`,
          });
          continue;
        }
        const messages = (historyData.messages || []).filter(
          (m: any) => !m.bot_id && !m.subtype && m.text?.trim().length >= 3
        );

        // Get user info cache
        const userIds = [...new Set(messages.map((m: any) => m.user).filter(Boolean))];
        const userCache: Record<string, string> = {};
        for (const uid of userIds) {
          try {
            const userRes = await fetch(`${SLACK_GATEWAY_URL}/users.info?user=${uid}`, {
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "X-Connection-Api-Key": SLACK_API_KEY,
              },
            });
            if (userRes.ok) {
              const userData = await userRes.json();
              userCache[uid] = userData.user?.real_name || userData.user?.name || uid;
            }
          } catch { userCache[uid] = uid; }
        }

        // Log messages
        const newMessages: any[] = [];
        for (const msg of messages) {
          // Skip if we already have this exact message
          if (latestLog?.message_ts && parseFloat(msg.ts) <= parseFloat(latestLog.message_ts)) continue;

          const userName = userCache[msg.user] || msg.user || "Unknown";

          const { error: logErr } = await supabase.from("slack_activity_log").upsert({
            client_id: ch.client_id,
            channel_id: ch.channel_id,
            message_ts: msg.ts,
            thread_ts: msg.thread_ts || null,
            user_id: msg.user || null,
            user_name: userName,
            message_text: msg.text,
            message_type: msg.files ? "file_share" : "message",
          }, { onConflict: "channel_id,message_ts" });

          if (!logErr) {
            newMessages.push({ ...msg, user_name: userName });
            totalMessages++;
          }
        }

        // AI analysis for task creation
        if (ch.auto_create_tasks && auto_create_tasks && newMessages.length > 0) {
          const batchText = newMessages
            .map(m => `[${m.user_name}]: ${m.text}`)
            .join("\n");

          const aiRes = await fetch(AI_GATEWAY, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "nvidia/nemotron-3-ultra:free",
        models: ["nvidia/nemotron-3-ultra:free", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
              messages: [
                {
                  role: "system",
                  content: `You analyze batches of Slack messages for a marketing agency. Identify actionable tasks, requests, and action items.

Rules:
- Only flag messages that are clear requests, tasks, or deliverable asks
- Casual conversation, greetings, status updates, simple questions → skip
- Look for: "can you", "please", "need to", "let's", "TODO", deadlines, deliverable requests, approval requests
- Group related messages into single tasks
- Return an array of tasks to create. If no tasks found, return empty array.`,
                },
                { role: "user", content: `Analyze these messages:\n\n${batchText}` },
              ],
              tools: [{
                type: "function",
                function: {
                  name: "extract_tasks",
                  description: "Extract actionable tasks from messages",
                  parameters: {
                    type: "object",
                    properties: {
                      tasks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string", description: "Clear task title, max 80 chars" },
                            description: { type: "string", description: "Task details from the messages" },
                            priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
                            source_user: { type: "string", description: "Who requested it" },
                          },
                          required: ["title", "description", "priority"],
                        },
                      },
                    },
                    required: ["tasks"],
                    additionalProperties: false,
                  },
                },
              }],
              tool_choice: { type: "function", function: { name: "extract_tasks" } },
            }),
          });

          if (aiRes.ok) {
            const aiData = await aiRes.json();
            try {
              const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
              if (tc) {
                const parsed = JSON.parse(tc.function.arguments);
                for (const task of (parsed.tasks || [])) {
                  const { data: newTask, error: taskErr } = await supabase.from("tasks").insert({
                    title: task.title,
                    description: `${task.description}\n\n📨 Source: Slack sync (${ch.channel_name || ch.channel_id})\n👤 Requested by: ${task.source_user || "Unknown"}`,
                    client_id: ch.client_id,
                    priority: task.priority || "medium",
                    status: "todo",
                  }).select("id").single();

                  if (!taskErr && newTask) {
                    tasksCreated++;

                    // Auto-assign every Slack-extracted task
                    try {
                      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ai-auto-assign-task`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                          apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
                        },
                        body: JSON.stringify({ taskId: newTask.id }),
                      }).catch((e) => console.warn('slack auto-assign failed', e));
                    } catch (e) { console.warn('slack auto-assign threw', e); }

                    // Post confirmation to Slack
                    await fetch(`${SLACK_GATEWAY_URL}/chat.postMessage`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${LOVABLE_API_KEY}`,
                        "X-Connection-Api-Key": SLACK_API_KEY,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        channel: ch.channel_id,
                        text: `📋 *Task auto-created from channel sync:* ${task.title}\n🎯 Priority: ${task.priority}`,
                        unfurl_links: false,
                      }),
                    });
                  }
                }
              }
            } catch (e) { console.error("AI task extraction parse error:", e); }
          }
        }

        results.push({
          channel_id: ch.channel_id,
          channel_name: ch.channel_name,
          messages_synced: newMessages.length,
          tasks_created: tasksCreated,
        });
      } catch (chErr) {
        console.error(`Error syncing channel ${ch.channel_id}:`, chErr);
        results.push({ channel_id: ch.channel_id, error: String(chErr) });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      total_messages: totalMessages,
      tasks_created: tasksCreated,
      channels: results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("slack-sync-channels error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
