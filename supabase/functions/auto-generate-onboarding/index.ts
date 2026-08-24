import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PASSWORD = 'HPA1234$';

const AD_PLAN = [
  { ratio: '1:1', count: 4 },
  { ratio: '4:5', count: 3 },
  { ratio: '9:16', count: 3 },
];

function getCloudUrl() { return Deno.env.get('SUPABASE_URL')!; }
function getCloudKey() { return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; }
function getProdDb() {
  const url = Deno.env.get('ORIGINAL_SUPABASE_URL') || getCloudUrl();
  const key = Deno.env.get('ORIGINAL_SUPABASE_SERVICE_ROLE_KEY') || getCloudKey();
  return createClient(url, key);
}

async function callFunction(name: string, payload: any, cloudUrl: string, anonKey: string) {
  const resp = await fetch(`${cloudUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${anonKey}`,
      // Internal service identity for functions that spend model credits.
      'x-internal-secret': Deno.env.get('INTERNAL_FUNCTION_PASSWORD') || '',
    },
    body: JSON.stringify(payload),
  });
  return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    if (body.password !== PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { client_id, offer_id, offer_description, company_name, brand_colors, brand_fonts, website_url, intake_data } = body;
    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[auto-generate] Starting full pipeline for ${company_name} (${client_id})`);

    const prodDb = getProdDb();
    const cloudUrl = getCloudUrl();
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const results: Record<string, any> = {};

    // ─── STEP 1: Research + Angles ───
    console.log('[auto-generate] Step 1: Research + Angles');
    for (const assetType of ['research', 'angles']) {
      const r = await callFunction('generate-asset', {
        password: PASSWORD, client_id, offer_id: offer_id || null,
        asset_type: assetType, intake_data: intake_data || {},
      }, cloudUrl, anonKey);
      results[assetType] = { success: r.ok, error: r.ok ? null : r.data?.error };
      console.log(`[auto-generate] ${assetType}: ${r.ok ? 'OK' : r.data?.error}`);
      await new Promise(r => setTimeout(r, 1500));
    }

    // ─── STEP 2: All Copy Types ───
    console.log('[auto-generate] Step 2: All copy generation');
    const copyTypes = ['ad_copy', 'emails', 'sms', 'scripts', 'vsl', 'setter', 'caller', 'funnel', 'report'];
    for (const assetType of copyTypes) {
      const r = await callFunction('generate-asset', {
        password: PASSWORD, client_id, offer_id: offer_id || null,
        asset_type: assetType, intake_data: intake_data || {},
      }, cloudUrl, anonKey);
      results[assetType] = { success: r.ok, error: r.ok ? null : r.data?.error };
      console.log(`[auto-generate] ${assetType}: ${r.ok ? 'OK' : r.data?.error}`);
      await new Promise(r => setTimeout(r, 1500));
    }

    // ─── STEP 3: Static Ads (Capital Raising style × 10) ───
    console.log('[auto-generate] Step 3: Static ads');
    const { data: styleData } = await prodDb
      .from('ad_styles')
      .select('*')
      .ilike('name', '%capital%raising%')
      .limit(1);

    const style = styleData?.[0];
    const adResults: any[] = [];
    const adErrors: any[] = [];

    if (style) {
      const projectId = `onboarding-${client_id}`;
      for (const plan of AD_PLAN) {
        for (let i = 0; i < plan.count; i++) {
          try {
            const r = await callFunction('generate-static-ad', {
              prompt: '',
              stylePrompt: style.prompt_template,
              styleName: style.name,
              aspectRatio: plan.ratio,
              productDescription: offer_description || '',
              offerDescription: offer_description || '',
              brandColors: brand_colors || [],
              brandFonts: brand_fonts || [],
              projectId,
              clientId: client_id,
              referenceImages: style.reference_images || [],
              primaryReferenceImage: style.reference_images?.[0] || null,
              strictBrandAdherence: !!(brand_colors?.length),
            }, cloudUrl, anonKey);

            if (r.ok && r.data?.success) {
              adResults.push({ ratio: plan.ratio, imageUrl: r.data.imageUrl });
              await prodDb.from('creatives').insert({
                client_id,
                title: `${company_name || 'Onboarding'} - ${style.name} ${plan.ratio} #${i + 1}`,
                type: 'image', file_url: r.data.imageUrl,
                status: 'draft', source: 'auto-onboarding',
                aspect_ratio: plan.ratio, trigger_campaign_id: offer_id || null,
              });
            } else {
              adErrors.push({ ratio: plan.ratio, error: r.data?.error });
            }
            await new Promise(r => setTimeout(r, 2000));
          } catch (err) {
            adErrors.push({ ratio: plan.ratio, error: String(err) });
          }
        }
      }
      console.log(`[auto-generate] Ads: ${adResults.length}/10 ok, ${adErrors.length} errors`);
    } else {
      console.error('[auto-generate] Capital Raising style not found');
    }
    results.static_ads = { generated: adResults.length, errors: adErrors.length };

    // ─── STEP 4: AI Avatar Generation ───
    console.log('[auto-generate] Step 4: Avatar generation');
    let avatarImageUrl: string | null = null;
    let avatarId: string | null = null;
    try {
      const avatarR = await callFunction('generate-avatar', {
        gender: 'male',
        ageRange: '36-45',
        ethnicity: 'caucasian',
        style: 'ugc',
        background: 'office',
        backgroundPrompt: 'Modern glass office with city skyline, warm executive lighting',
        aspectRatio: '3:4',
        realism_level: 'high',
        look_type: 'professional',
        avatar_description: `Professional fund manager for ${company_name}, institutional look, navy suit, confident expression`,
      }, cloudUrl, anonKey);

      if (avatarR.ok && avatarR.data?.imageUrl) {
        avatarImageUrl = avatarR.data.imageUrl;
        // Save avatar record
        const { data: avatarData } = await prodDb.from('avatars').insert({
          name: `${company_name} Fund Manager`,
          client_id,
          image_url: avatarImageUrl,
          is_active: true,
          style: 'ugc',
          gender: 'male',
          description: `Auto-generated avatar for ${company_name} onboarding`,
        }).select('id').single();
        avatarId = avatarData?.id || null;
        console.log(`[auto-generate] Avatar generated: ${avatarId}`);
      } else {
        console.error(`[auto-generate] Avatar failed:`, avatarR.data?.error);
      }
    } catch (err) {
      console.error('[auto-generate] Avatar error:', err);
    }
    results.avatar = { generated: !!avatarImageUrl, id: avatarId };

    // ─── STEP 5: Video Scripts → AI Avatar Video ───
    console.log('[auto-generate] Step 5: Video from avatar');
    const videoResults: any[] = [];
    if (avatarImageUrl) {
      // Generate 3 video variations from the avatar
      const videoPrompts = [
        `Professional fund manager speaking directly to camera, confident eye contact, subtle hand gestures, warm office lighting. Presenting ${company_name}'s investment opportunity. Natural talking head movement, institutional quality.`,
        `Fund manager walking through modern office, turning to camera with welcoming gesture. Dynamic dolly shot. Professional, trustworthy, discussing ${company_name}'s track record.`,
        `Close-up of fund manager nodding and speaking passionately about ${company_name}. Cinematic depth of field, warm golden hour backlight through office windows.`,
      ];

      for (let i = 0; i < videoPrompts.length; i++) {
        try {
          console.log(`[auto-generate] Generating video ${i + 1}/3`);
          const videoR = await callFunction('generate-video-from-image', {
            imageUrl: avatarImageUrl,
            prompt: videoPrompts[i],
            aspectRatio: '9:16',
            duration: 5,
          }, cloudUrl, anonKey);

          if (videoR.ok && videoR.data?.operationName) {
            videoResults.push({
              operationName: videoR.data.operationName,
              prompt: videoPrompts[i].slice(0, 80),
            });
            // Save as creative with pending status (video gen is async)
            await prodDb.from('creatives').insert({
              client_id,
              title: `${company_name} - Avatar Video #${i + 1}`,
              type: 'video',
              status: 'processing',
              source: 'auto-onboarding',
              aspect_ratio: '9:16',
              trigger_campaign_id: offer_id || null,
            });
          } else if (videoR.ok && videoR.data?.videoUrl) {
            videoResults.push({ videoUrl: videoR.data.videoUrl });
            await prodDb.from('creatives').insert({
              client_id,
              title: `${company_name} - Avatar Video #${i + 1}`,
              type: 'video',
              file_url: videoR.data.videoUrl,
              status: 'draft',
              source: 'auto-onboarding',
              aspect_ratio: '9:16',
              trigger_campaign_id: offer_id || null,
            });
          } else {
            console.error(`[auto-generate] Video ${i + 1} failed:`, videoR.data?.error);
          }
          await new Promise(r => setTimeout(r, 3000));
        } catch (err) {
          console.error(`[auto-generate] Video ${i + 1} error:`, err);
        }
      }
    }
    results.videos = { generated: videoResults.length, avatar_used: !!avatarImageUrl };
    console.log(`[auto-generate] Videos: ${videoResults.length}/3`);

    // ─── STEP 6: Return results with public link ───
    const { data: clientData } = await prodDb
      .from('clients')
      .select('public_token, slug')
      .eq('id', client_id)
      .single();

    const publicToken = clientData?.public_token;
    const publicLink = publicToken
      ? `${req.headers.get('origin') || 'https://aireporting.lovable.app'}/public/${publicToken}`
      : null;

    console.log(`[auto-generate] Pipeline complete for ${company_name}`);

    return new Response(
      JSON.stringify({
        success: true,
        client_id,
        offer_id,
        public_link: publicLink,
        results,
        ad_results: adResults,
        video_results: videoResults,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[auto-generate] Fatal error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
