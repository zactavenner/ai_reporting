import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getGeminiApiKey } from '../_shared/get-gemini-key.ts';
import { authorizeGenerationCaller } from '../_shared/generationAuth.ts';
import { buildExactVideoRequest, resolveExactModel } from '../_shared/exactModel.ts';


const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dashboard-token, x-internal-secret',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();

    // Model credits are only ever spent for an authenticated caller.
    const caller = await authorizeGenerationCaller(req, requestBody);
    if (!caller.ok) {
      return new Response(JSON.stringify({ error: caller.error }), {
        status: caller.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { imageUrl, prompt, aspectRatio, duration, apiKey: clientApiKey, model, lastFrameUrl, ingredientUrl, exactModel: requestedExactModel, resolution } = requestBody;

    // ── Exact-model path (Jeremy / approved automated callers) ───────────────
    // The approved model id is validated against the active configured allowlist
    // and sent to the provider verbatim: no aliasing, no fallback, and the
    // receipt reports the model that actually ran.
    if (String(requestedExactModel ?? '').trim()) {
      if (!OPENROUTER_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      let exact: string;
      let providerBody: Record<string, unknown>;
      try {
        exact = await resolveExactModel(db, 'video', requestedExactModel);
        providerBody = buildExactVideoRequest({
          exactModel: exact,
          prompt,
          aspectRatio,
          durationSeconds: duration,
          resolution,
          firstFrameUrl: imageUrl ?? null,
          lastFrameUrl: lastFrameUrl ?? null,
          referenceImageUrls: ingredientUrl ? [ingredientUrl] : [],
        });
      } catch (e) {
        return new Response(
          JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const submit = await fetch('https://openrouter.ai/api/v1/videos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://reporting.highperformanceads.com',
          'X-Title': 'Jeremy — exact model video',
        },
        body: JSON.stringify(providerBody),
      });
      if (!submit.ok) {
        const t = await submit.text();
        return new Response(
          JSON.stringify({ error: `Video submit ${submit.status}`, details: t.slice(0, 400) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const sj = await submit.json();
      const reported = String(sj?.model ?? '').trim();
      if (reported && reported !== exact) {
        return new Response(
          JSON.stringify({ error: `Provider accepted ${reported} but ${exact} was requested.`, model: reported }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const pollingUrl: string | undefined = sj.polling_url;
      if (!pollingUrl) {
        return new Response(
          JSON.stringify({ error: 'Provider returned no polling_url', details: JSON.stringify(sj).slice(0, 300) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      let exactVideoUrl: string | null = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const p = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
        if (!p.ok) continue;
        const pj = await p.json();
        if (pj.status === 'completed') {
          const urls: string[] = pj.unsigned_urls || pj.urls || (pj.video?.url ? [pj.video.url] : []);
          exactVideoUrl = urls[0] || null;
          break;
        }
        if (pj.status === 'failed') {
          return new Response(
            JSON.stringify({ error: `Video generation failed: ${pj.error || 'unknown'}`, model: exact }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
      if (!exactVideoUrl) {
        return new Response(
          JSON.stringify({ error: 'Video generation timed out after 5 minutes', model: exact }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ status: 'completed', videoUrl: exactVideoUrl, model: exact }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // For Veo3 (default) imageUrl is required (image-to-video). For Seedance, imageUrl is optional
    // because it also supports text-to-video and ingredient-only (subject reference) modes.
    if (!imageUrl && model !== 'seedance-pro') {
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
      const frameImages: Array<Record<string, unknown>> = [];
      if (imageUrl) frameImages.push({ type: 'image_url', image_url: { url: imageUrl }, frame_type: 'first_frame' });
      if (lastFrameUrl) frameImages.push({ type: 'image_url', image_url: { url: lastFrameUrl }, frame_type: 'last_frame' });
      const seedanceBody: Record<string, unknown> = {
        model: 'bytedance/seedance-2.0',
        prompt: prompt || (imageUrl
          ? 'Animate this image with subtle, professional motion.'
          : 'Cinematic short-form ad clip.'),
        resolution: '1080p',
        aspect_ratio: aspectRatio || '16:9',
        duration: Math.min(Math.max(duration || 5, 5), 15),
      };
      if (frameImages.length) seedanceBody.frame_images = frameImages;
      if (ingredientUrl) {
        // Subject/product reference image — preserved across the clip (distinct from keyframes).
        seedanceBody.reference_images = [{ type: 'image_url', image_url: { url: ingredientUrl } }];
      }
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
