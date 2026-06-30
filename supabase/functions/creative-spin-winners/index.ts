import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

/**
 * Given a winning ad (or ad_id), generate N variations:
 *  - hook swaps
 *  - CTA swaps
 *  - angle/headline reframes
 * Returns structured JSON, also writes to ad_iterations / ad_scripts.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { ad_id, count = 5, save = true } = await req.json();
    if (!ad_id) throw new Error('ad_id required');

    const { data: ad, error } = await sb
      .from('meta_ads')
      .select('id, client_id, name, headline, primary_text, call_to_action_type, thumbnail_url, spend, attributed_leads, attributed_funded_dollars, cost_per_lead, cost_per_funded')
      .eq('id', ad_id).single();
    if (error || !ad) throw new Error('ad not found');

    const prompt = `You are a direct-response copywriter for investment marketing. Below is a winning ad. Generate ${count} fresh variations that preserve the proven angle but swap the hook, headline, and CTA.

Original:
- Headline: ${ad.headline || '(none)'}
- Body: ${ad.primary_text || '(none)'}
- CTA: ${ad.call_to_action_type || 'LEARN_MORE'}
- Performance: $${Number(ad.spend||0).toFixed(0)} spend → ${ad.attributed_leads||0} leads → $${Number(ad.attributed_funded_dollars||0).toFixed(0)} funded

Compliance: NEVER say "guaranteed". Use "targeted returns". Include subtle risk language when appropriate.

Return JSON: { "variations": [ { "hook": "...", "headline": "...", "body": "...", "cta": "LEARN_MORE|SIGN_UP|GET_OFFER|APPLY_NOW", "angle": "...", "reason": "why this might beat the original" } ] }`;

    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra:free",
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) throw new Error(`AI error ${r.status}: ${await r.text()}`);
    const out = await r.json();
    let parsed: any = {};
    try { parsed = JSON.parse(out.choices[0].message.content); } catch { parsed = { variations: [] }; }

    if (save && Array.isArray(parsed.variations)) {
      for (const v of parsed.variations) {
        await sb.from('ad_scripts').insert({
          client_id: ad.client_id,
          title: `Spin: ${v.headline || ad.name}`.slice(0, 200),
          linked_meta_ad_id: ad.id,
          hook: v.hook,
          headline: v.headline,
          body: v.body,
          cta: v.cta,
          angle: v.angle,
          notes: v.reason,
          generated_by: 'ai',
          status: 'draft',
        }).then(() => {}, () => {});
      }
    }

    return new Response(JSON.stringify({ ok: true, source: ad, ...parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});