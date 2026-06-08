import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { callOpenRouterJSON } from '../_shared/openrouter.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { prompt, model } = await req.json();

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'prompt is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    try {
      const { data } = await callOpenRouterJSON([{ role: 'user', content: prompt }], {
        models: model ? [model] : undefined,
      });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('OpenRouter error:', err);
      return new Response(
        JSON.stringify({ error: 'AI request failed', details: String(err) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } catch (error) {
    console.error('Generate ad script error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
