import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

/** Create a Supabase client pointing at the PRODUCTION database */
function getProductionSupabase() {
  const url = Deno.env.get('ORIGINAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imageUrl, editPrompt, projectId, clientId, styleName, aspectRatio } = await req.json();

    if (!imageUrl || !editPrompt) {
      return new Response(
        JSON.stringify({ error: 'imageUrl and editPrompt are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENROUTER_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('AI Edit request:', { editPrompt: editPrompt.slice(0, 100), aspectRatio });

    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3.1-flash-image-preview',
        models: ['google/gemini-3.1-flash-image-preview', "google/gemini-2.0-flash-001", "openai/gpt-4o-mini"],
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Edit this advertisement image with the following instruction: ${editPrompt}. Keep the same dimensions and aspect ratio. Maintain professional ad quality. Do not add watermarks or logos.`,
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        modalities: ['image', 'text'],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Gateway error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded, please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: 'Payment required. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      return new Response(
        JSON.stringify({ error: 'Failed to edit image', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const editedImageData = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!editedImageData) {
      console.error('No image in AI response:', JSON.stringify(aiData).slice(0, 500));
      return new Response(
        JSON.stringify({ error: 'No edited image returned from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const base64Match = editedImageData.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      return new Response(
        JSON.stringify({ error: 'Invalid image data format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const mimeType = base64Match[1];
    const base64Image = base64Match[2];

    // Upload to PRODUCTION Supabase Storage
    const supabase = getProductionSupabase();

    const imageBytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
    const timestamp = Date.now();
    const uuid = crypto.randomUUID().slice(0, 8);
    const extension = mimeType.split('/')[1] || 'png';
    const filePath = `generated-ads/${clientId}/${projectId}/edit-${timestamp}-${uuid}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('assets')
      .upload(filePath, imageBytes, { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload edited image', details: uploadError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(filePath);

    // Save as new asset in PRODUCTION database
    const { data: asset } = await supabase
      .from('assets')
      .insert({
        project_id: projectId,
        client_id: clientId,
        type: 'image',
        public_url: publicUrl,
        storage_path: filePath,
        status: 'completed',
        name: `AI Edit - ${styleName || 'Ad'} (${aspectRatio || '1:1'})`,
        metadata: {
          editPrompt,
          sourceImageUrl: imageUrl,
          editedAt: new Date().toISOString(),
        },
      })
      .select()
      .single();

    console.log('AI Edit completed:', publicUrl);

    return new Response(
      JSON.stringify({ success: true, imageUrl: publicUrl, assetId: asset?.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Edit ad error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
