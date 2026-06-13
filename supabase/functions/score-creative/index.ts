import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

/** Score a creative across 4 axes (hook, clarity, CTA, compliance). 0–100 each. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json();
    let { hook, headline, primary_text, cta, image_url } = body;
    if (body.ad_id) {
      const { data } = await sb.from('meta_ads').select('headline, primary_text, call_to_action_type, thumbnail_url').eq('id', body.ad_id).single();
      if (data) { headline = data.headline; primary_text = data.primary_text; cta = data.call_to_action_type; image_url = data.thumbnail_url; }
    }
    if (body.creative_id) {
      const { data } = await sb.from('creatives').select('headline, body, cta, thumbnail_url').eq('id', body.creative_id).single();
      if (data) { headline = data.headline; primary_text = data.body; cta = data.cta; image_url = data.thumbnail_url; }
    }

    const userContent: any[] = [{ type: 'text', text: `Score this investment-marketing creative on 4 axes (0–100 each), then return JSON:
{ "hook": <0-100>, "clarity": <0-100>, "cta": <0-100>, "compliance": <0-100>, "overall": <0-100>, "verdict": "<2 sentence summary>", "fixes": ["..","..",".."] }

Rules:
- compliance penalizes "guaranteed", "no risk", missing risk language
- hook scores attention-grab in first 5 words of headline+body
- cta scores clarity of next action

Hook: ${hook || '(n/a)'}
Headline: ${headline || '(none)'}
Body: ${primary_text || '(none)'}
CTA: ${cta || '(none)'}` }];
    if (image_url) userContent.push({ type: 'image_url', image_url: { url: image_url } });

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "openrouter/owl-alpha",
        messages: [{ role: 'user', content: userContent }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) throw new Error(`AI ${r.status}: ${await r.text()}`);
    const out = await r.json();
    const score = JSON.parse(out.choices[0].message.content);
    return new Response(JSON.stringify({ ok: true, score }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});