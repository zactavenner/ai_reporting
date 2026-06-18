import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getGeminiApiKey } from '../_shared/get-gemini-key.ts';
import { generateImage as openrouterGenerateImage } from '../_shared/openrouter.ts';
import { enhancePromptWithGpt5 } from '../_shared/enhance-prompt-gpt5.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// ─── Rich prompt library (ported from Ads Generator 5.0) ───
const REALISM_PREFIXES: Record<string, string> = {
  'ultra-realistic': 'Photorealistic, ultra-detailed, 8K resolution, professional studio lighting, sharp focus, natural skin texture with pores and fine details, realistic hair strands, natural eye reflections, soft shadows, shot on Canon EOS R5 with 85mm f/1.4 lens, RAW unedited look',
  'high': 'Highly realistic, detailed portrait, professional lighting, natural skin, sharp features, studio quality, DSLR quality',
  'standard': '',
};
const NEGATIVE_PROMPT = 'NOT cartoon, NOT illustration, NOT anime, NOT 3D render, NOT CGI, NOT painting, NOT drawing, NOT digital art. ABSOLUTELY NO UI overlays, NO iPhone screenshot elements, NO camera interface, NO phone bezels, NO shutter buttons, NO flash icons, NO mode selectors, NO watermarks, NO text overlays, NO LIVE badges, NO recording indicators, NO app interfaces.';
const POSE_PROMPTS: Record<string, string> = {
  natural_standing: 'Standing naturally with relaxed posture, weight on one leg, arms at sides or one hand slightly gesturing',
  seated_relaxed: 'Seated comfortably, leaned back slightly, one arm resting on chair or knee, relaxed open body language',
  leaning: 'Leaning casually against wall or surface, confident relaxed stance',
  walking: 'Mid-stride walking naturally, body in motion, candid street style capture',
  arms_crossed: 'Arms crossed confidently but not defensively, slight smile, power pose energy',
  hand_on_hip: 'One hand on hip, confident pose, direct eye contact with camera, strong posture',
  looking_away: 'Candidly looking off to the side, thoughtful expression, profile partially visible',
  selfie: 'Classic selfie pose, phone held up slightly above eye level, natural selfie angle',
};
const EXPRESSION_PROMPTS: Record<string, string> = {
  genuine_smile: "Genuine warm smile with slight teeth showing, crow's feet at eyes, Duchenne smile with real emotion",
  subtle_smile: 'Subtle closed-lip smile, Mona Lisa style, mysterious and confident',
  laughing: 'Mid-laugh candid moment, eyes crinkled, mouth open, genuine joy',
  serious: 'Serious confident expression, strong gaze, slight furrowed brow, editorial intensity',
  thoughtful: 'Thoughtful contemplative expression, eyes slightly narrowed, slight head tilt',
  neutral: 'Neutral relaxed expression, lips softly closed, calm confident eyes',
  speaking: 'Mid-speech expression, mouth slightly open forming words, animated engaged face, talking to camera',
};
const LIGHTING_PROMPTS: Record<string, string> = {
  golden_hour: 'Warm golden hour sunlight, orange/amber tones, long soft shadows, backlit hair glow',
  studio_softbox: 'Professional softbox studio lighting, even diffused light, minimal shadows',
  natural_window: 'Soft natural window light from side, gentle shadows on far side of face',
  dramatic_rembrandt: 'Dramatic Rembrandt lighting, strong directional key light from 45°, moody shadows',
  ring_light: 'Ring light catchlights in eyes, even front-facing illumination, social media creator aesthetic',
  neon_ambient: 'Colored neon ambient lighting, pink/blue/purple tones, nightlife atmosphere',
  overcast_soft: 'Overcast sky diffused soft light, no harsh shadows, natural flattering illumination',
  backlit_silhouette: 'Strong backlight creating hair glow and rim light, ethereal dreamy atmosphere',
};
const STYLE_PRESET_PROMPTS: Record<string, string> = {
  professional_headshot: 'Professional corporate headshot, business attire, clean neutral studio background, warm flattering key light, confident approachable expression, LinkedIn-ready',
  lifestyle: 'Lifestyle portrait in casual setting, natural ambient light, relaxed authentic pose, candid feel, shallow depth of field',
  editorial: 'High-fashion editorial portrait, dramatic directional lighting, fashion-forward styling, magazine cover quality',
  social_media: 'Social media optimized portrait, bright even lighting, engaging direct eye contact, vibrant colors, trendy styling',
};
const LOOK_TYPE_PROMPTS: Record<string, string> = {
  different_outfit: 'Same person wearing a completely different outfit and style. Maintain IDENTICAL facial features, bone structure, skin tone, and identity.',
  different_setting: 'Same person in a completely different environment and setting. Maintain IDENTICAL facial features and identity.',
  different_expression: 'Same person with a different facial expression and mood. Maintain IDENTICAL facial features and identity.',
  different_angle: 'Same person photographed from a different camera angle. Maintain IDENTICAL facial features and identity.',
};

function buildRichAvatarPrompt(body: Record<string, any>): string {
  const {
    gender = 'female', ageRange = '26-35', ethnicity = 'caucasian', style = 'ugc',
    backgroundPrompt, customPrompt, cameraDevice = 'iphone', aspectRatio = '3:4',
    realism_level = 'high', style_preset, look_type, look_description, avatar_description,
    pose, expression, lighting, hair_style, hair_color, outfit_description,
    anglePromptModifier, angleFocalLength, angleFraming, angleType,
  } = body;

  const styleSection = style_preset && STYLE_PRESET_PROMPTS[style_preset]
    ? `STYLE PRESET: ${STYLE_PRESET_PROMPTS[style_preset]}` : '';
  const lookSection = look_type && LOOK_TYPE_PROMPTS[look_type]
    ? `LOOK MODE: ${LOOK_TYPE_PROMPTS[look_type]}${look_description ? `\nSpecific: ${look_description}` : ''}${avatar_description ? `\nOriginal avatar: ${avatar_description}` : ''}` : '';
  const poseSection = pose && POSE_PROMPTS[pose] ? `POSE: ${POSE_PROMPTS[pose]}` : '';
  const exprSection = expression && EXPRESSION_PROMPTS[expression] ? `EXPRESSION: ${EXPRESSION_PROMPTS[expression]}` : '';
  const lightSection = lighting && LIGHTING_PROMPTS[lighting] ? `LIGHTING: ${LIGHTING_PROMPTS[lighting]}` : '';
  const hairSection = (hair_style || hair_color) ? `HAIR: ${hair_style ?? ''} ${hair_color ?? ''}`.trim() : '';
  const outfitSection = outfit_description ? `OUTFIT: ${outfit_description}` : `STYLE: ${style}`;
  const angleSection = angleType ? `CAMERA ANGLE — ${String(angleType).toUpperCase()}: ${anglePromptModifier ?? ''} ${angleFocalLength ?? ''} ${angleFraming ?? ''}` : '';

  return [
    REALISM_PREFIXES[realism_level] || '',
    `ULTRA PHOTOREALISTIC portrait of a ${ageRange} ${ethnicity} ${gender}.`,
    outfitSection, styleSection, lookSection, poseSection, exprSection, lightSection, hairSection, angleSection,
    `CAMERA: ${cameraDevice === 'samsung' ? 'Samsung Galaxy S24 Ultra' : 'iPhone 15 Pro'} camera, natural color science.`,
    `ASPECT: ${aspectRatio}.`,
    'EYE CONTACT: Direct eye contact with camera (mandatory for video lip-sync compatibility) unless angle dictates otherwise.',
    `ENVIRONMENT: ${backgroundPrompt || 'clean neutral background, natural ambient lighting'}.`,
    'SKIN REALISM: visible pores on nose/cheeks/forehead, natural T-zone shine, real skin texture, authentic tone variations.',
    'HAIR REALISM: individual strands visible, slight flyaways, natural shine.',
    customPrompt ? `EXTRA: ${customPrompt}` : '',
    `AVOID: ${NEGATIVE_PROMPT} NO plastic skin, NO uncanny dead eyes, NO extra fingers, NO floating limbs.`,
    'Must look indistinguishable from a real photograph.',
  ].filter(Boolean).join('\n');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      gender = 'female',
      ageRange = '26-35',
      ethnicity = 'caucasian',
      style = 'ugc',
      background = 'studio',
      backgroundPrompt,
      customPrompt,
      prompt: directPrompt,
      cameraDevice = 'iphone',
      aspectRatio = '3:4',
      realism = 0.7,
      wideAngle = 0.5,
      angleType,
      anglePromptModifier,
      angleFocalLength,
      angleFraming,
      referenceImageUrl,
      realism_level = 'high',
      style_preset,
      look_type,
      look_description,
      avatar_description,
      apiKey: requestApiKey,
      isStock,
      clientId,
      model: requestedModel,
      useGpt5Enhancer,
      styleReferenceAvatarIds,
    } = body;

    // model selection: 'openai' = GPT Image 2, default 'nano-banana-pro' = Gemini 3 Pro Image
    const selectedModel: 'openai' | 'nano-banana-pro' =
      requestedModel === 'openai' ? 'openai' : 'nano-banana-pro';

    // Get API keys (gemini for nano-banana-pro path; LOVABLE_API_KEY for gpt-image-2 path)
    const geminiApiKey = selectedModel === 'nano-banana-pro' ? await getGeminiApiKey(requestApiKey) : null;
    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY') || '';
    if (selectedModel === 'nano-banana-pro' && !geminiApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Gemini API key not configured. Add it in Agency Settings.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (selectedModel === 'openai' && !openrouterKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'OPENROUTER_API_KEY missing — cannot call image generation.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the prompt with the rich library
    let fullPrompt = directPrompt || buildRichAvatarPrompt(body);

    // Resolve style-reference avatars (image URLs + learned style_profiles)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    let styleRefs: Array<{ name?: string; profile?: Record<string, unknown>; url?: string }> = [];
    if (Array.isArray(styleReferenceAvatarIds) && styleReferenceAvatarIds.length > 0) {
      const { data: refs } = await supabaseAdmin
        .from('avatars')
        .select('name, image_url, metadata')
        .in('id', styleReferenceAvatarIds);
      if (refs) {
        styleRefs = refs.map((r) => ({
          name: r.name,
          url: r.image_url,
          profile: ((r.metadata as Record<string, unknown>) || {}).style_profile as Record<string, unknown> | undefined,
        }));
      }
    }

    // GPT-5 enhancement (on by default; opt-out via useGpt5Enhancer === false)
    if (useGpt5Enhancer !== false) {
      const enhanced = await enhancePromptWithGpt5({
        kind: look_type ? 'avatar-look' : 'avatar',
        rawPrompt: fullPrompt,
        context: { gender, ageRange, ethnicity, style, aspectRatio, realism_level, look_type, look_description },
        styleReferences: styleRefs,
      });
      if (enhanced) {
        console.log('GPT-5 enhanced avatar prompt (preview):', enhanced.slice(0, 200));
        fullPrompt = enhanced;
      }
    }

    // Generate the image
    let base64Image = '';
    let mimeType = 'image/png';

    if (selectedModel === 'openai') {
      // GPT Image via OpenRouter (auto-fallback chain inside helper)
      const sizeMap: Record<string, string> = {
        '1:1': '1024x1024', '3:4': '1024x1536', '9:16': '1024x1536',
        '4:3': '1536x1024', '16:9': '1536x1024', '2:3': '1024x1536', '3:2': '1536x1024',
      };
      const size = sizeMap[aspectRatio] || '1024x1536';
      const promptText = fullPrompt + (referenceImageUrl ? `\n\nReference image (preserve identity / look): ${referenceImageUrl}` : '');
      try {
        const { b64, model } = await openrouterGenerateImage(promptText, {
          size,
          models: ['openai/gpt-image-1', 'google/gemini-3-pro-image-preview', 'google/gemini-2.5-flash-image-preview'],
        });
        base64Image = b64;
        mimeType = 'image/png';
        console.log('Image generated via OpenRouter model:', model);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('OpenRouter image gen failed:', msg);
        return new Response(
          JSON.stringify({ success: false, error: 'Image generation failed via OpenRouter.', details: msg.slice(0, 500) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Nano Banana Pro (Gemini 3 Pro Image Preview)
      const parts: any[] = [{ text: fullPrompt }];
      if (referenceImageUrl) {
        try {
          const imgRes = await fetch(referenceImageUrl);
          if (imgRes.ok) {
            const buf = await imgRes.arrayBuffer();
            const b64 = arrayBufferToBase64(buf);
            const ct = imgRes.headers.get('content-type') || 'image/png';
            parts.push({ inlineData: { mimeType: ct, data: b64 } });
          }
        } catch (err) {
          console.warn('Failed to fetch reference image:', err);
        }
      }
      // Style-reference avatars (up to 2)
      for (const ref of styleRefs.slice(0, 2)) {
        if (!ref.url) continue;
        try {
          const r = await fetch(ref.url);
          if (r.ok) {
            const b64 = arrayBufferToBase64(await r.arrayBuffer());
            parts.push({ inlineData: { mimeType: r.headers.get('content-type') || 'image/png', data: b64 } });
          }
        } catch (_e) { /* ignore */ }
      }
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
        }
      );
      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error('Gemini API error:', errorText);
        return new Response(
          JSON.stringify({ success: false, error: 'Gemini API error', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const geminiData = await geminiResponse.json();
      const imageParts = geminiData.candidates?.[0]?.content?.parts || [];
      const imagePart = imageParts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
      if (!imagePart?.inlineData?.data) {
        return new Response(
          JSON.stringify({ success: false, error: 'No image data in Gemini response' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      base64Image = imagePart.inlineData.data;
      mimeType = imagePart.inlineData.mimeType || 'image/png';
    }

    // Upload to storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const imageBytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
    const timestamp = Date.now();
    const uuid = crypto.randomUUID().slice(0, 8);
    const ext = mimeType.split('/')[1] || 'png';
    const folder = clientId ? `avatars/${clientId}` : 'avatars/stock';
    const filePath = `${folder}/${timestamp}-${uuid}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('assets')
      .upload(filePath, imageBytes, { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to upload avatar image' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(filePath);

    console.log('Avatar generated successfully:', publicUrl);

    return new Response(
      JSON.stringify({ success: true, imageUrl: publicUrl, storagePath: filePath }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Generate avatar error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
