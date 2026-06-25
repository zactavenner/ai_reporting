import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getGeminiApiKey } from '../_shared/get-gemini-key.ts';
import { getOpenRouterApiKey } from '../_shared/get-openrouter-key.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function pollHaiperStatus(generationId: string, apiKey: string): Promise<Response> {
  const openRouterUrl = `https://openrouter.ai/api/v1/generation?id=${generationId}`;

  const pollResponse = await fetch(openRouterUrl, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!pollResponse.ok) {
    console.error('[Haiper] Poll error:', pollResponse.status);
    return new Response(
      JSON.stringify({ status: 'processing', progress: 0.5 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const pollData = await pollResponse.json();
  console.log('[Haiper] Poll response:', JSON.stringify(pollData).substring(0, 300));

  if (pollData.data?.status === 'completed' || pollData.data?.native_tokens_completion > 0) {
    const content = pollData.data?.choices?.[0]?.message?.content ||
                    pollData.data?.response?.choices?.[0]?.message?.content;

    if (content) {
      const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.(mp4|webm|mov)[^\s"'<>]*/i);
      if (urlMatch) {
        return new Response(
          JSON.stringify({ status: 'completed', videoUrl: urlMatch[0] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const jsonMatch = content.match(/\{[\s\S]*"video[_-]?url"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const videoUrl = parsed.video_url || parsed.videoUrl || parsed.url;
          if (videoUrl) {
            return new Response(
              JSON.stringify({ status: 'completed', videoUrl }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch { /* parse failed */ }
      }
    }

    if (pollData.data?.generation_id && pollData.data?.status === 'completed') {
      return new Response(
        JSON.stringify({ status: 'failed', error: 'Video completed but no URL found in response' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  if (pollData.data?.status === 'failed' || pollData.data?.error) {
    return new Response(
      JSON.stringify({ status: 'failed', error: pollData.data?.error?.message || 'Haiper generation failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const progress = pollData.data?.usage?.completion_tokens
    ? Math.min(0.9, pollData.data.usage.completion_tokens / 1000)
    : 0.5;

  return new Response(
    JSON.stringify({ status: 'processing', progress }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { operationId, apiKey } = await req.json();

    if (!operationId) {
      return new Response(
        JSON.stringify({ error: 'operationId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Haiper / OpenRouter operations
    if (operationId.startsWith('haiper:')) {
      const generationId = operationId.replace('haiper:', '');
      const resolvedKey = await getOpenRouterApiKey(apiKey);
      if (!resolvedKey) {
        return new Response(
          JSON.stringify({ status: 'failed', error: 'No OpenRouter API key available for polling' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return pollHaiperStatus(generationId, resolvedKey);
    }

    // Google Generative AI operations
    if (operationId.startsWith('operations/')) {
      const resolvedKey = await getGeminiApiKey(apiKey, 'video');
      if (!resolvedKey) {
        return new Response(
          JSON.stringify({ status: 'failed', error: 'No API key available for polling' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${resolvedKey}`;
      const pollResponse = await fetch(pollUrl);

      if (!pollResponse.ok) {
        const errorText = await pollResponse.text();
        console.error('Poll error:', pollResponse.status, errorText);
        return new Response(
          JSON.stringify({ status: 'processing', progress: 0.5 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const pollData = await pollResponse.json();

      if (pollData.done) {
        const result = pollData.response;
        if (result?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri) {
          const videoUri = result.generateVideoResponse.generatedSamples[0].video.uri;
          const videoUrl = `${videoUri}?key=${resolvedKey}`;
          return new Response(
            JSON.stringify({ status: 'completed', videoUrl }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (pollData.error) {
          return new Response(
            JSON.stringify({ status: 'failed', error: pollData.error.message || 'Generation failed' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ status: 'failed', error: 'No video in completed response' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const progress = pollData.metadata?.progress || 0.5;
      return new Response(
        JSON.stringify({ status: 'processing', progress }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For non-Google, non-Haiper operations, return completed (synchronous generation)
    return new Response(
      JSON.stringify({ status: 'completed', videoUrl: operationId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Poll video status error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
