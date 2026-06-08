import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { callOpenRouter } from '../_shared/openrouter.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FRAMEWORKS: Record<string, string> = {
  hormozi: 'Alex Hormozi style: Bold hook, massive value promise, specific proof, irresistible offer, urgent CTA',
  pas: 'Problem-Agitate-Solution: Identify pain, amplify consequences, present solution',
  aida: 'AIDA: Attention-grabbing hook, Interest with benefits, Desire with proof, Action with CTA',
  storytelling: 'Storytelling: Relatable character, challenge faced, transformation achieved, invitation to join',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { productInfo, frameworks = ['hormozi', 'pas'] } = await req.json();

    const frameworkDescriptions = frameworks
      .map((f: string) => `- ${f}: ${FRAMEWORKS[f] || f}`)
      .join('\n');

    const prompt = `Generate ${frameworks.length} short video ad scripts (30-60 seconds each, suitable for TikTok/Reels).

Product/Service: ${productInfo.productService || 'Product'}
Target Audience: ${productInfo.targetAudience || 'General audience'}
USP: ${productInfo.usp || 'Great value'}
Pain Points: ${(productInfo.painPoints || []).join(', ')}
Benefits: ${(productInfo.benefits || []).join(', ')}

Generate one script per framework:
${frameworkDescriptions}

Each script should:
- Be conversational and natural (spoken to camera)
- 80-150 words (30-60 seconds when spoken)
- Include a strong opening hook (first 3 seconds)
- End with a clear CTA

Respond ONLY with valid JSON:
{
  "scripts": [
    {
      "id": "unique-id",
      "title": "Script Title",
      "framework": "framework-name",
      "content": "The full script text..."
    }
  ]
}`;

    let content = '';
    try {
      const result = await callOpenRouter([{ role: 'user', content: prompt }], { temperature: 0.8 });
      content = result.text;
    } catch (err) {
      console.error('OpenRouter error:', err);
      return new Response(
        JSON.stringify({ error: 'Failed to generate scripts', details: String(err) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let parsed: any;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      console.error('Failed to parse AI response:', content.slice(0, 500));
      // Return a basic fallback script
      parsed = {
        scripts: [{
          id: `script-${Date.now()}`,
          title: 'Generated Script',
          framework: frameworks[0] || 'custom',
          content: content.replace(/```[\s\S]*?```/g, '').trim() || 'Script generation failed. Please try again.',
        }],
      };
    }

    // Ensure each script has an id
    if (parsed.scripts) {
      parsed.scripts = parsed.scripts.map((s: any, i: number) => ({
        ...s,
        id: s.id || `script-${Date.now()}-${i}`,
      }));
    }

    console.log(`Generated ${parsed.scripts?.length || 0} scripts`);

    return new Response(
      JSON.stringify(parsed),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Generate scripts error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
