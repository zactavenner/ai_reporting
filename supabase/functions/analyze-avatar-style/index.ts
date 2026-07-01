import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a casting director + portrait photographer.
Look at the provided portrait and return ONLY a strict JSON object describing its visual style profile.
Schema:
{
  "gender": "male|female|non-binary",
  "age_range": "18-25|26-35|36-45|46-55|55+",
  "ethnicity": "string",
  "vibe": "string (1-2 words)",
  "outfit": "string",
  "hair": "string",
  "expression": "string",
  "lighting": "string",
  "background": "string",
  "color_grade": "string",
  "camera": "string",
  "style_keywords": ["string", ...] (4-8),
  "reusable_prompt": "string (a 2-3 sentence reusable seed prompt that could be passed back to an image model to make a NEW person in the SAME visual style)"
}
No prose. JSON only.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { avatarId, imageUrl: rawImageUrl, persist = true } = await req.json();
    const apiKey = (Deno.env.get('OPENROUTER_API_KEY') || '').trim().replace(/^['"]|['"]$/g, '');
    if (!apiKey.startsWith('sk-or-')) {
      return new Response(JSON.stringify({ error: 'OPENROUTER_API_KEY missing or invalid' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let imageUrl = rawImageUrl as string | undefined;
    let existingMeta: Record<string, unknown> = {};
    if (avatarId) {
      const { data, error } = await supabase
        .from('avatars').select('image_url, base_image_url, metadata').eq('id', avatarId).maybeSingle();
      if (error) throw error;
      if (!data) return new Response(JSON.stringify({ error: 'Avatar not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      imageUrl = imageUrl || data.image_url || data.base_image_url || undefined;
      existingMeta = (data.metadata as Record<string, unknown>) || {};
    }
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'No image to analyze' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const gatewayRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://reporting.highperformanceads.com',
        'X-Title': 'HPA Avatar Style Analysis',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: 'Analyze this portrait. Return ONLY the JSON object.' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ]},
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!gatewayRes.ok) {
      const txt = await gatewayRes.text();
      console.error('GPT-5 analyze error', gatewayRes.status, txt.slice(0, 400));
      return new Response(JSON.stringify({ error: 'Vision analysis failed', details: txt.slice(0, 400) }), {
        status: gatewayRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const data = await gatewayRes.json();
    const content = data?.choices?.[0]?.message?.content;
    let profile: Record<string, unknown> = {};
    try {
      profile = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (_e) {
      console.warn('Could not parse style profile JSON, returning raw');
      profile = { raw: content };
    }

    if (persist && avatarId) {
      const merged = {
        ...existingMeta,
        style_profile: profile,
        style_profile_analyzed_at: new Date().toISOString(),
      };
      await supabase.from('avatars').update({ metadata: merged }).eq('id', avatarId);
    }

    return new Response(JSON.stringify({ success: true, profile }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('analyze-avatar-style error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});