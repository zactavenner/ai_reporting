import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCapitalCreativeDirective } from './capital-creative-style.ts';
import { enhancePromptWithGpt5 } from '../_shared/enhance-prompt-gpt5.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateAdRequest {
  prompt: string;
  stylePrompt?: string;
  styleName?: string;
  aspectRatio: string;
  productDescription?: string;
  productUrl?: string;
  brandColors?: string[];
  brandFonts?: string[];
  projectId?: string;
  clientId?: string;
  referenceImages?: string[];
  primaryReferenceImage?: string;
  characterImageUrl?: string;
  idempotency_key?: string;
  offerDescription?: string;
  includeDisclaimer?: boolean;
  disclaimerText?: string;
  strictBrandAdherence?: boolean;
  adImageUrls?: string[];
  useGpt5Enhancer?: boolean;
  styleReferenceAvatarIds?: string[];
}

function getImageDimensions(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case '1:1': return { width: 1024, height: 1024 };
    case '4:5': return { width: 1024, height: 1280 };
    case '9:16': return { width: 768, height: 1365 };
    case '16:9': return { width: 1365, height: 768 };
    default: return { width: 1024, height: 1024 };
  }
}

function buildAdPrompt(params: GenerateAdRequest): string {
  const { prompt, stylePrompt, styleName, productDescription, productUrl, brandColors, brandFonts, aspectRatio, offerDescription, referenceImages, primaryReferenceImage, includeDisclaimer, disclaimerText, strictBrandAdherence } = params;
  
  const dimensions = getImageDimensions(aspectRatio);
  const hasReferenceImages = referenceImages && referenceImages.length > 0;
  const hasBrandColors = brandColors && brandColors.length > 0;

  // Auto-inject Capital Creative design system when using capital raising style
  const isCapitalStyle = styleName?.toLowerCase().includes('capital') || false;
  const capitalDirective = isCapitalStyle ? getCapitalCreativeDirective() : '';

  const colorInstruction = hasBrandColors
    ? strictBrandAdherence
      ? `STRICT BRAND ADHERENCE: You MUST use ONLY these exact brand colors throughout the entire design — no deviations, no similar shades, no artistic liberties: ${brandColors.join(', ')}`
      : `Use these brand colors as accent colors while keeping the overall look consistent: ${brandColors.join(', ')}.`
    : hasReferenceImages
      ? `CRITICAL: Extract and replicate the EXACT color palette from the PRIMARY reference image.`
      : `Use a premium, institutional color palette suited for capital-raising and investment marketing.`;

  const fontInstruction = brandFonts && brandFonts.length > 0
    ? strictBrandAdherence
      ? `STRICT FONT ADHERENCE: You MUST use ONLY these brand fonts for all text — no substitutes: ${brandFonts.join(', ')}`
      : `Preferred brand fonts: ${brandFonts.join(', ')}`
    : '';
  
  const productContext = productDescription
    ? `Product/Service: ${productDescription}`
    : productUrl ? `Product from: ${productUrl}` : '';

  const offerContext = offerDescription ? `Offer/Value Proposition: ${offerDescription}` : '';

  const primaryRefNote = primaryReferenceImage
    ? `\n\nPRIMARY REFERENCE: The FIRST image provided is your PRIMARY template. Replicate THIS specific image's layout, composition, colors (unless brand colors are specified), and visual style.`
    : '';

  const referenceInstruction = hasReferenceImages
    ? `CRITICAL — PIXEL-PERFECT REPLICATION FROM REFERENCE:
You are given reference advertisement images. Clone the PRIMARY reference image as closely as possible.${primaryRefNote}

MANDATORY REPLICATION RULES:
1. LAYOUT: Copy the exact same layout grid, element placement, margins, padding.
2. COMPOSITION: Match the reference's composition pixel-for-pixel.
3. COLORS & GRADIENTS: ${hasBrandColors ? 'Use the specified brand colors while maintaining the reference layout.' : 'Extract and replicate the EXACT color palette from the reference.'}
4. TYPOGRAPHY STYLE: Replicate the same font weight, size ratios, text alignment, letter-spacing.
5. VISUAL EFFECTS: Copy all overlays, shadows, glows, borders, rounded corners.
6. BACKGROUND & IMAGERY: Recreate the same type of background and imagery arrangement.
7. ONLY CHANGE THE COPY: Replace ONLY the text content with the new product's messaging.`
    : `AUTO-GENERATE AD DESIGN:
Since no reference images are provided, create an original, high-converting advertisement design.
${offerContext ? `Base the visual concept on this offer: ${offerDescription}` : ''}
${hasBrandColors ? '' : 'Use a premium dark/sophisticated color palette with gold or green accents — suitable for financial/investment marketing.'}

DESIGN REQUIREMENTS:
1. Create a bold, eye-catching layout with strong visual hierarchy
2. Use dramatic typography with clear headline placement
3. Include compelling visual elements (gradients, overlays, geometric shapes)
4. Design should feel premium, institutional, and trustworthy
5. Add subtle texture or depth effects for a polished look
6. Include a clear call-to-action area`;

  const disclaimerInstruction = includeDisclaimer && disclaimerText
    ? `MANDATORY DISCLAIMER: Include the following disclaimer text clearly legible at the bottom: "${disclaimerText}"`
    : '';

  const safeZoneInstruction = aspectRatio === '9:16'
    ? `INSTAGRAM STORIES/REELS SAFE ZONE: Do NOT place important content in the top 14% or bottom 20% of the image.`
    : '';

  if (prompt && !stylePrompt) {
    return `${capitalDirective}

${prompt}

${productContext}
${offerContext}
${colorInstruction}
${fontInstruction}
${referenceInstruction}
${disclaimerInstruction}
${safeZoneInstruction}

Image dimensions: ${dimensions.width}x${dimensions.height}. Ultra high resolution, professional quality.

DO NOT include:
- Watermarks
- Logos or brand marks of any kind`.trim();
  }

  return `
Create a high-converting advertisement image.

${capitalDirective}
${stylePrompt || ''}
${productContext}
${offerContext}
${colorInstruction}
${fontInstruction}
${referenceInstruction}
${disclaimerInstruction}
${safeZoneInstruction}

Image dimensions: ${dimensions.width}x${dimensions.height} (${aspectRatio} aspect ratio)

REQUIREMENTS:
- Professional advertisement quality
- Eye-catching visual design
- Clear focal point
- Balanced composition
- Modern, polished aesthetic
- Ultra high resolution

DO NOT include:
- Watermarks
- Logos or brand marks of any kind
- Stock photo artifacts
- Low quality or blurry elements
`.trim();
}

/** Create a Supabase client pointing at the PRODUCTION database */
function getProductionSupabase() {
  const url = Deno.env.get('ORIGINAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

/** Create a Supabase client for STORAGE operations (must use local Lovable Cloud URL) */
function getStorageSupabase() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: GenerateAdRequest = await req.json();
    const { styleName, aspectRatio, projectId, clientId, referenceImages = [], idempotency_key } = body;

    const LOVABLE_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating ad with params:', { styleName, aspectRatio, projectId });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Resolve style-reference avatars → pull their image_url + style_profile
    let styleRefs: Array<{ name?: string; profile?: Record<string, unknown>; url?: string }> = [];
    if (body.styleReferenceAvatarIds && body.styleReferenceAvatarIds.length > 0) {
      const { data: refs } = await supabaseAdmin
        .from('avatars')
        .select('name, image_url, metadata')
        .in('id', body.styleReferenceAvatarIds);
      if (refs) {
        styleRefs = refs.map((r) => ({
          name: r.name,
          url: r.image_url,
          profile: ((r.metadata as Record<string, unknown>) || {}).style_profile as Record<string, unknown> | undefined,
        }));
      }
    }

    let prompt = buildAdPrompt(body);

    // GPT-5 enhancement pass (default on, opt-out via useGpt5Enhancer=false)
    if (body.useGpt5Enhancer !== false) {
      const enhanced = await enhancePromptWithGpt5({
        kind: 'static-ad',
        rawPrompt: prompt,
        context: {
          styleName, aspectRatio,
          productDescription: body.productDescription,
          offerDescription: body.offerDescription,
          brandColors: body.brandColors,
          brandFonts: body.brandFonts,
          strictBrandAdherence: body.strictBrandAdherence,
          hasPrimaryReference: !!body.primaryReferenceImage,
          hasCharacter: !!body.characterImageUrl,
        },
        styleReferences: styleRefs,
      });
      if (enhanced) {
        console.log('GPT-5 enhanced prompt (preview):', enhanced.slice(0, 200));
        prompt = enhanced;
      }
    }
    console.log('Generated prompt:', prompt.slice(0, 300) + '...');

    // Build message content with prompt and optional reference images
    const contentParts: any[] = [{ type: 'text', text: prompt }];

    async function addImageToContent(imageUrl: string, label: string) {
      try {
        const imageResponse = await fetch(imageUrl);
        if (imageResponse.ok) {
          const imageBuffer = await imageResponse.arrayBuffer();
          const bytes = new Uint8Array(imageBuffer);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, Array.from(chunk));
          }
          const base64Image = btoa(binary);
          const contentType = imageResponse.headers.get('content-type') || 'image/png';
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${contentType};base64,${base64Image}` }
          });
          console.log(`Added ${label}:`, imageUrl.slice(0, 60));
          return true;
        }
      } catch (err) {
        console.warn(`Failed to fetch ${label}:`, imageUrl, err);
      }
      return false;
    }

    // PRIORITY 1: PRIMARY reference image
    if (body.primaryReferenceImage) {
      await addImageToContent(body.primaryReferenceImage, 'PRIMARY reference');
    }

    // PRIORITY 2: Character/avatar image
    if (body.characterImageUrl) {
      await addImageToContent(body.characterImageUrl, 'character reference');
    }

    // PRIORITY 2.5: style-reference avatar images (visual style transfer)
    for (const ref of styleRefs.slice(0, 2)) {
      if (ref.url) await addImageToContent(ref.url, 'style-reference avatar');
    }

    // PRIORITY 3: Remaining reference images
    const maxAdditionalRefs = (body.primaryReferenceImage ? 3 : 4) - (body.characterImageUrl ? 1 : 0);
    for (const imageUrl of referenceImages.slice(0, maxAdditionalRefs + 1)) {
      if (imageUrl === body.primaryReferenceImage || imageUrl === body.characterImageUrl) continue;
      await addImageToContent(imageUrl, 'supplementary reference');
    }

    // PRIORITY 4: User-uploaded ad images
    for (const imageUrl of (body.adImageUrls || []).slice(0, 2)) {
      await addImageToContent(imageUrl, 'ad asset image');
    }

    // Call Lovable AI Gateway with image generation model
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3.1-flash-image-preview',
        models: ['google/gemini-3.1-flash-image-preview', "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          {
            role: 'user',
            content: contentParts,
          },
        ],
        modalities: ['image', 'text'],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Gateway error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please wait a moment and try again.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add funds in Settings > Workspace > Usage.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'Failed to generate image', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const images = aiData.choices?.[0]?.message?.images;

    if (!images || images.length === 0) {
      console.error('No image in AI response:', JSON.stringify(aiData).slice(0, 500));
      return new Response(
        JSON.stringify({ error: 'No image generated by AI model' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract base64 image data
    const imageDataUrl = images[0].image_url.url;
    const base64Match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      return new Response(
        JSON.stringify({ error: 'Invalid image data format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mimeType = base64Match[1];
    const base64Image = base64Match[2];

    // Upload to Lovable Cloud Storage (local URL — DNS-resolvable from edge functions)
    const storageClient = getStorageSupabase();

    const imageBytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
    const timestamp = Date.now();
    const uuid = crypto.randomUUID().slice(0, 8);
    const extension = mimeType.split('/')[1] || 'png';
    const filePath = `generated-ads/${clientId}/${projectId}/${timestamp}-${uuid}.${extension}`;

    const { error: uploadError } = await storageClient.storage
      .from('assets')
      .upload(filePath, imageBytes, { contentType: mimeType, upsert: true, cacheControl: '3600' });

    if (uploadError) {
      console.error('Upload error:', JSON.stringify(uploadError));
      const errMsg = typeof uploadError === 'object' ? (uploadError.message || JSON.stringify(uploadError)) : String(uploadError);
      return new Response(
        JSON.stringify({ error: `Failed to upload image: ${errMsg}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { publicUrl } } = storageClient.storage.from('assets').getPublicUrl(filePath);

    // Save asset record to PRODUCTION database
    const supabase = getProductionSupabase();
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        project_id: projectId,
        client_id: clientId,
        type: 'image',
        public_url: publicUrl,
        storage_path: filePath,
        status: 'completed',
        name: `${styleName} - ${aspectRatio}`,
        metadata: {
          styleName,
          aspectRatio,
          prompt: prompt.slice(0, 500),
          generatedAt: new Date().toISOString(),
          ...(idempotency_key ? { idempotency_key } : {}),
        },
      })
      .select()
      .single();

    if (assetError) {
      console.error('Asset insert error:', assetError);
    }

    console.log('Ad generated successfully:', publicUrl);

    return new Response(
      JSON.stringify({ success: true, imageUrl: publicUrl, storagePath: filePath, assetId: asset?.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Generate ad error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
