import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CREATIVE_FRAMEWORKS = [
  { type: 'pain_based', name: 'Pain Based', structure: 'Hook → Problem → Opportunity → CTA' },
  { type: 'curiosity', name: 'Curiosity', structure: 'Hook → Pattern Interrupt → Explanation → CTA' },
  { type: 'social_proof', name: 'Social Proof', structure: 'Hook → Credibility → Opportunity → CTA' },
  { type: 'future_trend', name: 'Future Trend', structure: 'Hook → Market Trend → Investment Opportunity → CTA' },
  { type: 'founder_style', name: 'Founder Style', structure: 'Direct to Camera → Personal Story → Opportunity → CTA' },
];

const COMPLIANCE_DISCLAIMER =
  'For accredited investors only. Investments involve risk including loss of principal. Past performance does not guarantee future results.';

const SYSTEM_PROMPT = `You are FundAd AI, a senior direct-response copywriter for SEC-compliant private investment funds (real estate, PE, oil & gas, RV parks, multifamily, debt, alts targeting accredited investors).

You write 15-second UGC-style Instagram Reel scripts that look like an authentic accredited investor sharing a discovery on their iPhone. NOT corporate. NOT salesy. Native social.

STRICT COMPLIANCE RULES — these words/phrases are BANNED:
- "guaranteed", "risk free", "safe investment", "passive income", "best investment", "guaranteed cash flow"
Always replace with: "target return", "projected return", "potential income", "historical performance", "investment objectives".

OUTPUT: Return ONLY valid JSON matching the schema. No prose. No markdown fences.`;

const UGC_REALISM_SUFFIX =
  'Shot on iPhone 15 Pro, vertical 9:16, 1080p, 30fps, natural handheld micro-shake, real skin texture with visible pores and natural blemishes, no makeup-perfect skin, authentic lighting (window light or golden hour), shallow depth of field, ambient real-world background audio implied, no CGI look, no stock-footage look, no logo overlays, no on-screen text — pure raw user-generated content aesthetic. Subject speaks directly to camera with natural pauses, glances and micro-expressions like a real person filming a casual selfie video.';

function buildUserPrompt(fund: any, frameworks: typeof CREATIVE_FRAMEWORKS, variationMode = false, existingHooks: string[] = []) {
  const variationNote = variationMode
    ? `\n\nIMPORTANT: These are NEW variations. Do NOT repeat any of these previous hooks: ${existingHooks.join(' | ')}`
    : '';
  return `Generate ${frameworks.length} unique 15-second UGC investor ad concepts for this fund.

FUND INPUT:
- Fund Name: ${fund.fundName || 'Unnamed Fund'}
- Offer Summary: ${fund.offerSummary || ''}
- Target Returns: ${fund.targetReturns || ''}
- Hold Period: ${fund.holdPeriod || ''}
- Distribution Frequency: ${fund.distributionFrequency || ''}
- Minimum Investment: ${fund.minInvestment || ''}
- Target Investor: ${fund.targetInvestor || 'Accredited investors'}
- Asset Class: ${fund.assetClass || ''}
- Geographic Focus: ${fund.geographicFocus || ''}
- Sponsor Track Record: ${fund.sponsorTrackRecord || ''}
- Key Differentiators: ${fund.differentiators || ''}

CREATIVES TO GENERATE (in this exact order):
${frameworks.map((f, i) => `${i + 1}. ${f.name} — ${f.structure}`).join('\n')}
${variationNote}

Each creative must include:
- ad_title (short)
- hook (first 2 seconds, scroll-stopper, <12 words)
- script (full 15-second spoken script, ~35-45 words, conversational, broken into 3 beats)
- character_desc (age, gender, appearance, outfit — varied across creatives)
- scene_location (pick from: luxury apartment rooftop, multifamily property exterior, RV park, construction site, modern office, coffee shop, neighborhood street, lakefront development, hotel lobby, downtown city walk — vary across creatives)
- seedance_prompt (single detailed paragraph, ultra-realistic UGC vertical 9:16, handheld iPhone, golden hour OR natural daylight, eye contact, subtle gestures, shallow DOF, native Instagram Reel look, no stock/CGI appearance, includes character + location + action)
- scene_breakdown (array of EXACTLY 3 scenes; each {scene: 1|2|3, duration_seconds, visual, action})
- captions (array of 3-5 short caption screens; each {text, start_second}; <=8 words each, lower-third style, native creator voice — e.g. "I wasn't expecting these numbers")
- cta (short, low-friction — e.g. "Tap Learn More", "Comment INVEST", "Link in bio")

Append this exact realism block to the end of every seedance_prompt: "${UGC_REALISM_SUFFIX}"

Return JSON: { "creatives": [ { creative_type, ad_title, hook, script, character_desc, scene_location, seedance_prompt, scene_breakdown, captions, cta } ] }

creative_type values in order: ${frameworks.map((f) => f.type).join(', ')}`;
}

async function callGateway(messages: any[]) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-pro',
        models: ['google/gemini-2.5-pro', "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
      messages,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI gateway ${res.status}: ${txt.slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { creatives: [] };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { mode = 'initial', fund = {}, batchId, existingHooks = [] } = body;

    if (!fund.fundName) {
      return new Response(JSON.stringify({ error: 'fundName required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isVariation = mode === 'variations';
    // For variations, generate 5 fresh angles across the same frameworks
    const frameworks = CREATIVE_FRAMEWORKS;

    const json = await callGateway([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(fund, frameworks, isVariation, existingHooks) },
    ]);

    const creatives = Array.isArray(json?.creatives) ? json.creatives : [];
    if (!creatives.length) {
      return new Response(JSON.stringify({ error: 'Model returned no creatives', raw: json }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const useBatchId = batchId || crypto.randomUUID();

    const rows = creatives.map((c: any, idx: number) => ({
      user_id: user.id,
      batch_id: useBatchId,
      fund_name: fund.fundName,
      fund_input: fund,
      creative_type: c.creative_type || frameworks[idx]?.type || 'unknown',
      creative_index: idx,
      ad_title: c.ad_title || null,
      hook: c.hook || null,
      script: c.script || null,
      seedance_prompt: c.seedance_prompt || null,
      scene_breakdown: c.scene_breakdown || [],
      captions: c.captions || [],
      cta: c.cta || null,
      compliance_disclaimer: COMPLIANCE_DISCLAIMER,
      character_desc: c.character_desc || null,
      scene_location: c.scene_location || null,
      is_variation: isVariation,
    }));

    const { data: inserted, error: insertErr } = await supabase
      .from('fundad_creatives')
      .insert(rows)
      .select('*');

    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ batchId: useBatchId, creatives: inserted }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('fundad-generate error', e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});