import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCopySystemContext } from "./copy-system.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPTS: Record<string, string> = {
  research: `You are an expert market researcher for businesses and alternative investments. 
Given a company's details, produce comprehensive research structured as JSON with these keys:
- industry_overview: 2-3 paragraphs on the industry/asset class with market data
- asset_class_trends: current trends and growth data with specific numbers
- market_opportunity: market size, growth rate, key drivers
- supply_demand: supply/demand dynamics and imbalances
- demographic_tailwinds: demographic and economic factors driving demand
- competitive_landscape: how this compares to alternatives
- timing_factors: why now is the right time
- why_asset_class: compelling reason for this asset class/product
- why_market: why this specific market/geography
- why_now: urgency and timing argument
- why_operator: why this team/operator matters
- key_statistics: array of 6-8 objects with {stat, source, context}
- recent_news: array of 3-5 recent relevant headlines
Each value should be detailed analysis. Return ONLY valid JSON.`,

  angles: `You are a world-class direct response copywriter. 
Generate 8 marketing angles as JSON array. Each angle object:
- title: short punchy angle name
- hook: one-line attention grabber
- emotional_driver: core emotion this taps into
- why_it_works: strategic reasoning
- use_case: where to deploy (ads, emails, landing page)
- ad_hooks: array of 3 short ad hook variations
- email_subject: suggested email subject line
- video_hook: opening line for a video script
Return ONLY valid JSON array.`,

  emails: `You are an elite email copywriter. Generate a 7-email nurture sequence as JSON array. Each email object:
- subject: compelling subject line
- preview_text: preview/preheader text
- body: full email body (use \\n for line breaks)
- cta_text: button text
- angle_used: which marketing angle this ties to
- sequence_step: number in sequence
- purpose: strategic goal
Primary CTA = book a call. Tone: professional, authoritative. Return ONLY valid JSON array.`,

  sms: `You are an SMS marketing expert. Generate a 6-message SMS sequence as JSON array. Each message object:
- message: SMS text (under 160 chars)
- character_count: number
- sequence_step: number
- purpose: one of "follow_up", "reminder", "nurture", "scarcity", "book_call", "re_engagement"
- cta: call to action
- timing: when to send relative to opt-in
Return ONLY valid JSON array.`,

  adcopy: `You are a paid media copywriter. For each marketing angle provided, generate ad copy variations as JSON array. Each object:
- angle: which angle this is for
- primary_text: main ad body (2-3 sentences)
- headline: ad headline (under 40 chars)
- description: description line
- cta: suggested CTA button
- platform: "meta" or "linkedin"
- variation: number (generate 3 per angle)
Return ONLY valid JSON array.`,

  scripts: `You are an expert video script writer specializing in social media ads and AI-generated video content (veo3, avatar-based, b-roll compilations, UGC-style).
Generate video scripts as JSON array. Each object:
- title: script name
- type: one of "avatar_talking_head", "broll_montage", "ugc_testimonial", "vsl_short", "veo3_cinematic", "veo3_product_demo"
- hook: opening 3-second hook (attention-grabbing, pattern-interrupt)
- body: main script body with clear scene directions in brackets [SCENE: ...]
- cta: closing call to action
- angle_used: marketing angle
- format: "9:16", "1:1", or "16:9"
- duration_estimate: estimated seconds (15, 30, 45, or 60)
- visual_direction: detailed visual notes for AI video generation (camera movements, transitions, mood, lighting)
- veo3_prompt: if type includes "veo3", provide an optimized text-to-video prompt describing the exact scene for AI generation
- music_mood: suggested music mood (e.g. "upbeat corporate", "emotional piano", "energetic EDM")
- caption_style: "bold_overlay", "subtitle", "kinetic_typography"
Generate 6-8 scripts mixing types, with at least 2 veo3-optimized scripts. Return ONLY valid JSON array.`,

  creatives: `You are a senior creative director for performance marketing campaigns.
Generate creative concepts as JSON with keys:
- static_concepts: array of 6 objects, each with:
  - headline: bold headline text
  - supporting_text: body copy
  - visual_direction: detailed art direction (colors, composition, style, mood)
  - layout_idea: specific layout description
  - format: "1080x1080", "1080x1920", or "1200x628"
  - style: one of "editorial", "bold_graphic", "testimonial_card", "data_visualization", "lifestyle", "comparison"
  - ai_image_prompt: a detailed prompt suitable for AI image generation (Gemini/DALL-E) to create this concept
- video_concepts: array of 4 objects, each with:
  - title: concept name
  - style: one of "cinematic", "motion_graphics", "talking_head", "product_demo", "testimonial"
  - setting: environment description
  - visual_scenes: array of scene descriptions with timing
  - caption_direction: text overlay strategy
  - hook_concept: opening hook approach
  - format: "9:16", "1:1", or "16:9"
  - veo3_scene_prompts: array of text-to-video prompts for each scene, optimized for AI video generation
  - duration_seconds: 15, 30, or 60
  - music_mood: suggested background music style
Return ONLY valid JSON.`,

  report: `You are a content strategist. Generate a special report / lead magnet as JSON:
- title: compelling report title
- subtitle: supporting subtitle
- executive_summary: 2-3 paragraph summary
- market_opportunity: detailed section on market
- why_now: timing and urgency section
- strategy_overview: the strategy explained
- operator_advantage: why this team
- faqs: array of 5 {question, answer} objects
- cta_heading: call to action heading
- cta_body: call to action paragraph
Return ONLY valid JSON.`,

  funnel: `You are a conversion copywriter. Generate funnel copy as JSON:
- landing_page: { headline, subheadline, body_sections (array of {heading, copy}), cta_primary, cta_secondary }
- thank_you_page: { headline, body, next_steps (array) }
- booking_page: { headline, subheadline, bullet_points (array), urgency_note }
- investor_portal_intro: { welcome_headline, welcome_body, sections (array of {title, description}) }
- faqs: array of {question, answer}
Return ONLY valid JSON.`,

  vsl: `You are an expert direct-response video copywriter specializing in compliant investment marketing. Generate a 3-minute Video Sales Letter script as JSON with these keys:
- cold_open: object with { text, duration: "0-2s", note: "compliance overlay" }
- hook: object with { text, duration: "2-9s", technique: "pattern-interrupt" }
- credibility: object with { text, duration: "9-24s", focus: "track record" }
- problem_mechanism: object with { text, duration: "24-54s", focus: "pain + solution" }
- evidence: object with { text, duration: "54-84s", focus: "balanced performance data" }
- terms: object with { text, duration: "84-104s", focus: "investment structure" }
- risk: object with { text, duration: "104-119s", focus: "honest risk acknowledgment" }
- cta: object with { text, duration: "119-135s", focus: "clear next step" }
- hook_variants: array of 3 alternative hooks
- full_script: continuous spoken piece (all sections combined)
- disclaimer: legal disclaimer text
Rules: spoken word only, use "targeted returns" never "guaranteed", under 3 minutes read time, every claim must be supportable.
Return ONLY valid JSON.`,

  caller: `You are an expert at building AI phone agent scripts for investor outreach. Generate a complete AI caller config as JSON with these keys:
- opening_script: opening greeting (10s)
- qualification_questions: array of objects { question, purpose } covering accredited status, investment size, timeline
- pitch_script: main pitch (45s)
- objection_responses: object with keys { send_info_first, talk_to_advisor, what_are_risks, not_interested } each with a response string
- booking_script: transition to booking (15s)
- voicemail_script: voicemail message
- close_script: closing (10s)
- do_not_say: array of phrases to avoid
- always_include: array of required disclaimers/phrases
- call_structure: object { opening: "10s", qualify: "30s", pitch: "45s", objections: "30s", book: "15s", close: "10s" }
Professional, warm, efficient tone. Never guarantee returns.
Return ONLY valid JSON.`,

  setter: `You are an expert at building AI setter/chatbot scripts for investor qualification. Generate a complete AI setter config as JSON:
- greeting: initial message
- qualification_flow: array of { question, response_handlers: { positive, negative, unclear } }
- booking_prompt: how to transition to booking
- objection_handlers: object with common objections and responses
- disqualification_message: polite exit for non-qualified leads
- follow_up_sequences: array of follow-up messages with timing
Return ONLY valid JSON.`,
};

function buildUserPrompt(client_data: any, asset_type: string, existing_research: any, existing_angles: any): string {
  let userPrompt = `Company Details:\n`;
  userPrompt += `- Company: ${client_data.company_name || client_data.name}\n`;
  userPrompt += `- Type: ${client_data.fund_type || client_data.client_type || "Business"}\n`;
  if (client_data.raise_amount) userPrompt += `- Raise Amount: $${client_data.raise_amount}\n`;
  if (client_data.min_investment) userPrompt += `- Minimum Investment: $${client_data.min_investment}\n`;
  if (client_data.timeline) userPrompt += `- Timeline: ${client_data.timeline}\n`;
  if (client_data.target_investor) userPrompt += `- Target Audience: ${client_data.target_investor}\n`;
  if (client_data.website) userPrompt += `- Website: ${client_data.website}\n`;
  if (client_data.industry) userPrompt += `- Industry: ${client_data.industry}\n`;
  if (client_data.offer_description) userPrompt += `- Offer: ${client_data.offer_description}\n`;
  if (client_data.brand_notes) userPrompt += `- Brand Notes: ${client_data.brand_notes}\n`;
  if (client_data.additional_notes) userPrompt += `- Additional Notes: ${client_data.additional_notes}\n`;
  // Capital raising specific fields for copy system variable replacement
  if (client_data.speaker_name) userPrompt += `- Speaker/Spokesperson: ${client_data.speaker_name}\n`;
  if (client_data.targeted_returns) userPrompt += `- Targeted Returns: ${client_data.targeted_returns}\n`;
  if (client_data.hold_period) userPrompt += `- Hold Period: ${client_data.hold_period}\n`;
  if (client_data.distribution_schedule) userPrompt += `- Distribution Schedule: ${client_data.distribution_schedule}\n`;
  if (client_data.investment_range) userPrompt += `- Investment Range: ${client_data.investment_range}\n`;
  if (client_data.tax_advantages) userPrompt += `- Tax Advantages: ${client_data.tax_advantages}\n`;
  if (client_data.credibility) userPrompt += `- Credibility/Track Record: ${client_data.credibility}\n`;
  if (client_data.fund_history) userPrompt += `- Fund History/Backstory: ${client_data.fund_history}\n`;

  if (existing_research && asset_type !== "research") {
    userPrompt += `\n=== MARKET RESEARCH (use this data extensively) ===\n${JSON.stringify(existing_research, null, 2)}\n`;
  }
  if (existing_angles && ["emails", "sms", "adcopy", "scripts", "creatives", "funnel"].includes(asset_type)) {
    userPrompt += `\n=== MARKETING ANGLES (build on these) ===\n${JSON.stringify(existing_angles, null, 2)}\n`;
  }

  userPrompt += `\nGenerate the ${asset_type} content now. Follow the AI Capital Raising Copy System templates exactly. Replace ALL bracketed variables with the actual client data above. Return ONLY valid JSON.`;
  return userPrompt;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { client_id, asset_type, client_data, existing_research, existing_angles, offer_id } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");

    const baseSystemPrompt = SYSTEM_PROMPTS[asset_type];
    if (!baseSystemPrompt) throw new Error(`Unknown asset type: ${asset_type}`);

    // Prepend the AI Capital Raising Copy System context for compliance + templates
    const copySystemContext = getCopySystemContext(asset_type);
    const systemPrompt = copySystemContext + '\n' + baseSystemPrompt;

    const userPrompt = buildUserPrompt(client_data, asset_type, existing_research, existing_angles);

    // Use Lovable AI Gateway with Gemini
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openrouter/owl-alpha",
        models: ["openrouter/owl-alpha", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: asset_type === "research" ? 0.3 : 0.8,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI Gateway error:", response.status, errText);
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const result = await response.json();
    let content = result.choices?.[0]?.message?.content || "";
    content = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { parsed = { raw: content }; }
      } else {
        parsed = { raw: content };
      }
    }

    // Save to original database (where clients & client_assets live)
    const supabaseUrl = Deno.env.get("ORIGINAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("ORIGINAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const insertData: any = {
        client_id,
        asset_type,
        title: `${asset_type.charAt(0).toUpperCase() + asset_type.slice(1)} - Generated`,
        content: parsed,
        status: "draft",
      };
    if (offer_id) insertData.offer_id = offer_id;

    const { data: asset, error: dbError } = await supabase
      .from("client_assets")
      .insert(insertData)
      .select()
      .single();

    if (dbError) {
      console.error("DB error:", dbError);
      throw new Error("Failed to save asset");
    }

    return new Response(JSON.stringify({ asset, content: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-asset error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
