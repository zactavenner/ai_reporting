// GPT-5 prompt enhancer via Lovable AI Gateway.
// Takes a raw user idea + structured context and returns a hyper-detailed
// image-generation prompt suitable for Gemini 3 Pro Image / GPT-Image-2.

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

export interface EnhancePromptInput {
  kind: 'static-ad' | 'avatar' | 'avatar-look';
  rawPrompt?: string;
  context?: Record<string, unknown>;
  styleReferences?: Array<{ name?: string; profile?: Record<string, unknown>; url?: string }>;
}

const SYSTEMS: Record<EnhancePromptInput['kind'], string> = {
  'static-ad': `You are a world-class art director for direct-response performance ads.
Transform the user's brief into ONE deeply specific image-generation prompt for a state-of-the-art image model (Gemini 3 Pro Image / GPT-Image-2).

Rules:
- Stay 100% faithful to brand colors, fonts, offer, product/service, disclaimers and aspect-ratio safe zones the user provides.
- If reference images are mentioned, command the model to PIXEL-CLONE the primary reference's layout, composition, typography hierarchy and effects — only the COPY changes.
- Specify: composition, lighting, color story, typography hierarchy, focal point, mood, texture, visual effects.
- Never invent logos, watermarks, or brand marks. Never add stock-photo cliches.
- Output ONLY the final prompt text. No preamble, no markdown, no quotes.`,
  avatar: `You are a portrait photographer and casting director.
Transform the user's avatar brief into ONE hyper-detailed photoreal portrait prompt for Gemini 3 Pro Image / GPT-Image-2.

Rules:
- Photoreal, indistinguishable from a real photograph. Visible pores, real hair strands, eye catchlights.
- Anchor: gender, age, ethnicity, style, expression, pose, lighting, wardrobe, environment, camera/lens.
- Direct eye contact unless angle says otherwise (for video lip-sync compatibility).
- If style references are provided, INHERIT their look-and-feel (vibe, color grade, wardrobe energy, lighting) — but keep identity unique unless told otherwise.
- Absolutely no AI artifacts, no UI overlays, no watermarks, no plastic skin, no extra fingers.
- Output ONLY the final prompt text. No preamble.`,
  'avatar-look': `You generate a NEW look for an EXISTING avatar.
Preserve the original identity (face, bone structure, skin tone) exactly. Only the angle / outfit / background / expression / lighting changes per the brief.
Output ONLY the final image prompt text. No preamble.`,
};

export async function enhancePromptWithGpt5(input: EnhancePromptInput): Promise<string | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return null;

  const system = SYSTEMS[input.kind];
  const userPayload = JSON.stringify({
    rawPrompt: input.rawPrompt ?? '',
    context: input.context ?? {},
    styleReferences: input.styleReferences ?? [],
  }, null, 2);

  try {
    const res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Brief (JSON):\n${userPayload}\n\nReturn ONLY the final image-generation prompt.` },
        ],
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      console.warn('[enhance-prompt-gpt5] non-200', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim?.();
    return typeof text === 'string' && text.length > 20 ? text : null;
  } catch (err) {
    console.warn('[enhance-prompt-gpt5] error', err);
    return null;
  }
}