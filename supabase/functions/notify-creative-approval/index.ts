import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';
const FALLBACK_CHANNEL = 'hpa-bluecapital-tasks';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!LOVABLE_API_KEY || !SLACK_API_KEY) {
      console.warn('Slack credentials not configured, skipping notification');
      return new Response(JSON.stringify({ success: false, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { creativeId } = await req.json();

    if (!creativeId) {
      return new Response(JSON.stringify({ error: 'creativeId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load creative + client info
    const { data: creative, error: creativeErr } = await supabase
      .from('creatives')
      .select('id, title, type, platform, file_url, headline, body_copy, client_id')
      .eq('id', creativeId)
      .single();

    if (creativeErr || !creative) {
      throw new Error(`Creative not found: ${creativeErr?.message}`);
    }

    const { data: client } = await supabase
      .from('clients')
      .select('name, public_token')
      .eq('id', creative.client_id)
      .single();

    // Resolve target channel: prefer per-client mapped channel, fall back to default.
    const { data: mappings } = await supabase
      .from('slack_channel_mappings')
      .select('channel_id, channel_name, channel_type')
      .eq('client_id', creative.client_id);

    let targetChannelId: string | null = null;
    let targetChannelName: string | null = null;
    if (mappings && mappings.length > 0) {
      // Priority: creatives > approvals > tasks > general > first available
      const priority = ['creatives', 'approvals', 'tasks', 'general'];
      let chosen = null;
      for (const t of priority) {
        chosen = mappings.find((m: any) => (m.channel_type || '').toLowerCase() === t);
        if (chosen) break;
      }
      chosen = chosen || mappings[0];
      targetChannelId = chosen.channel_id;
      targetChannelName = chosen.channel_name;
    }

    // If no per-client mapping, look up the fallback channel by name.
    // Resolve channel ID by name (paginated)
    let channelId: string | null = null;
    let resolvedChannelName = targetChannelName || `#${FALLBACK_CHANNEL}`;
    if (targetChannelId) {
      channelId = targetChannelId;
      console.log(`Using mapped channel for client ${creative.client_id}: ${targetChannelName} (${targetChannelId})`);
    } else {
      console.warn(`No slack_channel_mappings row for client ${creative.client_id} (${client?.name}). Falling back to #${FALLBACK_CHANNEL}.`);
      let cursor = '';
      do {
        const url = `${GATEWAY_URL}/conversations.list?limit=200&types=public_channel,private_channel${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'X-Connection-Api-Key': SLACK_API_KEY,
          },
        });
        const data = await res.json();
        if (!data.ok) {
          throw new Error(`Slack conversations.list error: ${data.error}`);
        }
        const match = data.channels?.find((c: { name: string; id: string }) => c.name === FALLBACK_CHANNEL);
        if (match) {
          channelId = match.id;
          break;
        }
        cursor = data.response_metadata?.next_cursor || '';
      } while (cursor);

      if (!channelId) {
        throw new Error(`No mapped Slack channel for this client and fallback #${FALLBACK_CHANNEL} not found.`);
      }
    }

    const approvalUrl = client?.public_token
      ? `https://reporting.highperformanceads.com/public/${client.public_token}/creatives`
      : `https://reporting.highperformanceads.com/`;

    const creativeDirectUrl = client?.public_token
      ? `https://reporting.highperformanceads.com/public/${client.public_token}/creatives?creative=${creative.id}`
      : approvalUrl;

    const clientName = client?.name || 'Client';
    const platformLabel = creative.platform ? ` • ${creative.platform}` : '';
    const typeLabel = creative.type ? ` (${creative.type})` : '';

    const text = `🎨 *New Creative Approval Request*\n` +
      `*Client:* ${clientName}\n` +
      `*Title:* ${creative.title}${typeLabel}${platformLabel}\n` +
      (creative.headline ? `*Headline:* ${creative.headline}\n` : '') +
      (creative.body_copy ? `*Body:* ${String(creative.body_copy).slice(0, 300)}\n` : '') +
      `\n👉 <${creativeDirectUrl}|Review This Creative>  |  <${approvalUrl}|Open Client Approval Page>`;

    const isVideo = (creative.type || '').toLowerCase().includes('video') ||
      /\.(mp4|mov|webm|m4v)(\?|$)/i.test(creative.file_url || '');
    const isImage = !isVideo && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(creative.file_url || '');

    const blocks: any[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `🎨 *New Creative Approval Request*\n*Client:* ${clientName}\n*Title:* ${creative.title}${typeLabel}${platformLabel}` },
      },
    ];
    if (creative.headline) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Headline:* ${creative.headline}` } });
    }
    if (creative.body_copy) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Body:* ${String(creative.body_copy).slice(0, 500)}` } });
    }
    if (isImage && creative.file_url) {
      blocks.push({ type: 'image', image_url: creative.file_url, alt_text: creative.title || 'Creative preview' });
    } else if (creative.file_url) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `📎 *Asset:* <${creative.file_url}|Open file>` } });
    }
    blocks.push({
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '✅ Review This Creative' }, url: creativeDirectUrl, style: 'primary' },
        { type: 'button', text: { type: 'plain_text', text: '📋 Open Client Approval Page' }, url: approvalUrl },
      ],
    });

    const postRes = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': SLACK_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        blocks,
        username: 'Creative Approvals',
        icon_emoji: ':art:',
        unfurl_links: true,
      }),
    });

    const postData = await postRes.json();
    if (!postData.ok) {
      throw new Error(`Slack chat.postMessage error: ${postData.error}`);
    }

    console.log(`Slack notification sent to ${resolvedChannelName} (${channelId}) for creative ${creativeId} / client ${creative.client_id}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('notify-creative-approval error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});