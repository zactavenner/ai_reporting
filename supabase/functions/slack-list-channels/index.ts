import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  if (!SLACK_API_KEY) {
    return new Response(JSON.stringify({ error: "SLACK_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const allChannels: any[] = [];
    const seenIds = new Set<string>();
    let cursor: string | undefined;

    // Paginate through all channels from conversations.list
    do {
      const params = new URLSearchParams({
        types: "public_channel,private_channel",
        limit: "200",
        exclude_archived: "true",
      });
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(`${GATEWAY_URL}/conversations.list?${params}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": SLACK_API_KEY,
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        const slackError = String(data?.error || `http_${response.status}`);
        const authError = ["token_revoked", "invalid_auth", "not_authed", "account_inactive", "token_expired"].includes(slackError);
        console.error(`Slack conversations.list failed [${response.status}]: ${JSON.stringify(data)}`);
        if (authError) {
          // Degrade gracefully: the Slack connection needs to be reconnected.
          return new Response(
            JSON.stringify({
              channels: [],
              slack_error: slackError,
              needs_reconnect: true,
              message: "Slack connection is no longer authorized. Reconnect Slack to load channels.",
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw new Error(`Slack API failed [${response.status}]: ${JSON.stringify(data)}`);
      }

      for (const ch of data.channels || []) {
        seenIds.add(ch.id);
        allChannels.push({
          id: ch.id,
          name: ch.name,
          is_private: ch.is_private,
          num_members: ch.num_members,
          topic: ch.topic?.value || "",
        });
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // Also discover channels from slack_activity_log that weren't in conversations.list
    // (e.g. Slack Connect channels hosted by other orgs)
    const SUPABASE_URL = Deno.env.get("ORIGINAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_KEY = Deno.env.get("ORIGINAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    if (SUPABASE_URL && SUPABASE_KEY) {
      const { createClient } = await import("npm:@supabase/supabase-js@2");
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      
      // Get distinct channel IDs from activity log
      const { data: activityChannels } = await supabase
        .from("slack_activity_log")
        .select("channel_id")
        .limit(500);
      
      // Also get channel IDs from mappings
      const { data: mappedChannels } = await supabase
        .from("slack_channel_mappings")
        .select("channel_id, channel_name");

      const knownChannelIds = new Set<string>();
      for (const ac of activityChannels || []) knownChannelIds.add(ac.channel_id);
      for (const mc of mappedChannels || []) knownChannelIds.add(mc.channel_id);

      // For any channel ID not in conversations.list, try conversations.info
      const missingIds = [...knownChannelIds].filter(id => !seenIds.has(id));
      
      for (const channelId of missingIds) {
        try {
          // Try to join first (needed for Slack Connect channels)
          await fetch(`${GATEWAY_URL}/conversations.join`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": SLACK_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ channel: channelId }),
          });

          const infoRes = await fetch(`${GATEWAY_URL}/conversations.info?channel=${channelId}`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": SLACK_API_KEY,
              "Content-Type": "application/json",
            },
          });
          const infoData = await infoRes.json();
          if (infoData.ok && infoData.channel && !infoData.channel.is_archived) {
            seenIds.add(channelId);
            allChannels.push({
              id: infoData.channel.id,
              name: infoData.channel.name,
              is_private: infoData.channel.is_private || false,
              num_members: infoData.channel.num_members || 0,
              topic: infoData.channel.topic?.value || "",
            });
          }
        } catch (err) {
          console.error(`Failed to fetch info for channel ${channelId}:`, err);
        }
      }
    }

    // Sort alphabetically
    allChannels.sort((a, b) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ channels: allChannels }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error listing Slack channels:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
