import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { script, segmentDuration = 8, characterDescription, offerDescription } = await req.json();

    if (!script?.trim()) {
      return new Response(
        JSON.stringify({ scenes: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const characterContext = characterDescription
      ? `The presenter is: ${characterDescription}. Include them in avatar scenes.`
      : '';
    const offerContext = offerDescription
      ? `The product/offer is: ${offerDescription}.`
      : '';

    const systemPrompt = `You are a video ad script segmenter. Break the given script into scenes of approximately ${segmentDuration} seconds each.

For each scene, provide:
- "lipSyncLine": The exact dialogue/voiceover text for that scene
- "sceneEnvironment": A detailed visual description for image generation (what the viewer sees)
- "action": Description of movement, gestures, or action happening
- "cameraAngle": One of "close-up", "medium", "wide", or "side-profile"

${characterContext}
${offerContext}

Rules:
- Each scene should be roughly ${segmentDuration} seconds of spoken content (about ${segmentDuration * 2.5} words)
- Scene environments should be vivid and specific for AI image generation
- Vary camera angles across scenes for visual interest
- First scene should be attention-grabbing (hook)
- Last scene should have a clear call-to-action feel

Respond ONLY with valid JSON: { "scenes": [...] }`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        models: ["nvidia/nemotron-3-ultra-550b-a55b:free", "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Break this script into ~${segmentDuration}-second scenes:\n\n${script}` },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to segment script', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || '';

    // Extract JSON from response (handle markdown code blocks)
    let parsed: any;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      console.error('Failed to parse AI response:', content.slice(0, 500));
      // Fallback: split script into chunks manually
      const words = script.trim().split(/\s+/);
      const wordsPerScene = Math.ceil(segmentDuration * 2.5);
      const scenes = [];
      for (let i = 0; i < words.length; i += wordsPerScene) {
        const chunk = words.slice(i, i + wordsPerScene).join(' ');
        scenes.push({
          lipSyncLine: chunk,
          sceneEnvironment: 'Professional setting with clean background',
          action: 'Speaker addresses camera directly',
          cameraAngle: i === 0 ? 'close-up' : 'medium',
        });
      }
      parsed = { scenes };
    }

    console.log(`Script segmented into ${parsed.scenes?.length || 0} scenes`);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Breakdown script error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
