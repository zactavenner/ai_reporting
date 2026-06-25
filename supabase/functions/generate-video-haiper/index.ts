import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getOpenRouterApiKey } from '../_shared/get-openrouter-key.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { prompt, imageUrl, aspectRatio = '16:9', duration = 8, apiKey: clientApiKey } = await req.json();

    if (!prompt?.trim()) {
      return new Response(
        JSON.stringify({ error: 'prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const apiKey = await getOpenRouterApiKey(clientApiKey);
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'No OpenRouter API key configured. Add your OpenRouter key in Agency Settings.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[Haiper] Starting video generation via OpenRouter`);
    console.log(`[Haiper] Prompt: ${prompt.substring(0, 100)}...`);
    console.log(`[Haiper] Image URL: ${imageUrl ? imageUrl.substring(0, 80) + '...' : 'none (text-to-video)'}`);

    const messages: Array<Record<string, unknown>> = [];

    if (imageUrl) {
      let base64Image: string | null = null;
      let imageMimeType = 'image/png';

      try {
        const imageResponse = await fetch(imageUrl);
        if (imageResponse.ok) {
          imageMimeType = imageResponse.headers.get('content-type') || 'image/png';
          const imageBuffer = await imageResponse.arrayBuffer();
          const bytes = new Uint8Array(imageBuffer);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, Array.from(chunk));
          }
          base64Image = btoa(binary);
        }
      } catch (err) {
        console.warn('[Haiper] Failed to fetch source image, falling back to text-only:', err);
      }

      if (base64Image) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageMimeType};base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: `Generate a ${duration}-second video from this image. Aspect ratio: ${aspectRatio}. ${prompt}`,
            },
          ],
        });
      } else {
        messages.push({
          role: 'user',
          content: `Generate a ${duration}-second video. Aspect ratio: ${aspectRatio}. ${prompt}`,
        });
      }
    } else {
      messages.push({
        role: 'user',
        content: `Generate a ${duration}-second video. Aspect ratio: ${aspectRatio}. ${prompt}`,
      });
    }

    const openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';

    const requestBody = {
      model: 'haiper-ai/haiper-video-2',
      messages,
      provider: {
        order: ['Haiper'],
      },
    };

    console.log('[Haiper] Sending request to OpenRouter...');

    const response = await fetch(openRouterUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': Deno.env.get('SUPABASE_URL') || 'https://ai-reporting.app',
        'X-Title': 'AI Reporting Platform',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Haiper] OpenRouter API error:', response.status, errorText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Insufficient OpenRouter credits. Top up at openrouter.ai/credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ error: `OpenRouter API error: ${response.status}`, details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data = await response.json();
    console.log('[Haiper] OpenRouter response:', JSON.stringify(data).substring(0, 500));

    if (data.id && !data.choices?.[0]?.message?.content) {
      console.log(`[Haiper] Async generation started, generation ID: ${data.id}`);
      return new Response(
        JSON.stringify({
          status: 'processing',
          operationId: `haiper:${data.id}`,
          message: 'Haiper video generation started. Poll for completion.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const content = data.choices?.[0]?.message?.content;
    if (content) {
      const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.(mp4|webm|mov)[^\s"'<>]*/i);
      if (urlMatch) {
        console.log(`[Haiper] Video URL found in response: ${urlMatch[0].substring(0, 80)}`);
        return new Response(
          JSON.stringify({ status: 'completed', videoUrl: urlMatch[0] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const jsonMatch = content.match(/\{[\s\S]*"video[_-]?url"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const videoUrl = parsed.video_url || parsed.videoUrl || parsed.url;
          if (videoUrl) {
            console.log(`[Haiper] Video URL extracted from JSON: ${videoUrl.substring(0, 80)}`);
            return new Response(
              JSON.stringify({ status: 'completed', videoUrl }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
        } catch { /* parse failed, continue */ }
      }

      return new Response(
        JSON.stringify({
          status: 'processing',
          operationId: `haiper:${data.id}`,
          message: 'Video generation in progress.',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (data.id) {
      return new Response(
        JSON.stringify({
          status: 'processing',
          operationId: `haiper:${data.id}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unexpected response format from OpenRouter', details: JSON.stringify(data).substring(0, 500) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[Haiper] Generate video error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
