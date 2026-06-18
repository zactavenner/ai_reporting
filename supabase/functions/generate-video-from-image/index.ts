import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getGeminiApiKey } from '../_shared/get-gemini-key.ts';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imageUrl, prompt, aspectRatio, duration, apiKey: clientApiKey, model } = await req.json();

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'imageUrl is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ---------- Seedance 2.0 Pro via OpenRouter (image-to-video, inline poll) ----------
    if (model === 'seedance-pro') {
      if (!OPENROUTER_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const seedanceBody: Record<string, unknown> = {
        model: 'bytedance/seedance-2.0',
        prompt: prompt || 'Animate this image with subtle, professional motion.',
        resolution: '1080p',
        aspect_ratio: aspectRatio || '16:9',
        duration: Math.min(Math.max(duration || 5, 5), 15),
        frame_images: [
          { type: 'image_url', image_url: { url: imageUrl }, frame_type: 'first_frame' },
        ],
      };
      const submit = await fetch('https://openrouter.ai/api/v1/videos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://reporting.highperformanceads.com',
          'X-Title': 'Batch Video — Seedance',
        },
        body: JSON.stringify(seedanceBody),
      });
      if (!submit.ok) {
        const t = await submit.text();
        console.error('Seedance submit failed', submit.status, t.slice(0, 400));
        return new Response(
          JSON.stringify({ error: `Seedance submit ${submit.status}`, details: t.slice(0, 400) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const sj = await submit.json();
      const pollingUrl: string | undefined = sj.polling_url;
      if (!pollingUrl) {
        return new Response(
          JSON.stringify({ error: 'Seedance returned no polling_url', details: JSON.stringify(sj).slice(0, 300) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      let videoUrl: string | null = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const p = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
        if (!p.ok) continue;
        const pj = await p.json();
        if (pj.status === 'completed') {
          const urls: string[] = pj.unsigned_urls || pj.urls || (pj.video?.url ? [pj.video.url] : []);
          videoUrl = urls[0] || null;
          break;
        }
        if (pj.status === 'failed') {
          return new Response(
            JSON.stringify({ error: `Seedance failed: ${pj.error || 'unknown'}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
      if (!videoUrl) {
        return new Response(
          JSON.stringify({ error: 'Seedance timed out after 5 minutes' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ status: 'completed', videoUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const apiKey = await getGeminiApiKey(clientApiKey, 'video');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'No Google AI API key configured. Add GEMINI_API_KEY in settings.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('Video generation request:', {
      prompt: prompt?.slice(0, 100),
      aspectRatio,
      duration,
    });

    // Fetch source image and convert to base64 for the Veo API
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch source image' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const bytes = new Uint8Array(imageBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64Image = btoa(binary);
    const imageMimeType = imageResponse.headers.get('content-type') || 'image/png';

    const videoPrompt = prompt || 'Create a subtle, professional animation from this image with gentle motion.';

    // Use Veo 3 via Google Generative Language API (async / long-running operation)
    const veoUrl = `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning?key=${apiKey}`;

    const veoBody: Record<string, unknown> = {
      instances: [
        {
          prompt: videoPrompt,
          image: {
            bytesBase64Encoded: base64Image,
            mimeType: imageMimeType,
          },
        },
      ],
      parameters: {
        aspectRatio: aspectRatio || '16:9',
        durationSeconds: duration || 5,
        sampleCount: 1,
      },
    };

    console.log('Calling Veo API...');
    const veoResponse = await fetch(veoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(veoBody),
    });

    if (!veoResponse.ok) {
      const errorText = await veoResponse.text();
      console.error('Veo API error:', veoResponse.status, errorText);

      if (veoResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ error: 'Veo API error', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const veoData = await veoResponse.json();
    console.log('Veo response:', JSON.stringify(veoData).slice(0, 300));

    // The API returns a long-running operation name for polling
    if (veoData.name) {
      return new Response(
        JSON.stringify({
          status: 'processing',
          operationId: veoData.name,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Unlikely immediate completion
    return new Response(
      JSON.stringify({ error: 'Unexpected Veo response format', details: JSON.stringify(veoData).slice(0, 500) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Generate video error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
