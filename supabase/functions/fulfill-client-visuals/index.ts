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

async function createStep(db: any, runId: string, phase: string, stepName: string, sortOrder: number, stepType = 'edge_function', functionName?: string) {
  const { data } = await db.from('fulfillment_steps').insert({
    run_id: runId, phase, step_name: stepName, step_type: stepType,
    sort_order: sortOrder, function_name: functionName || null, status: 'pending',
  }).select('id').single();
  return data?.id;
}

async function updateStep(db: any, stepId: string, status: string, outputData?: any, errorMessage?: string) {
  const update: any = { status };
  if (status === 'running') update.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'failed') update.completed_at = new Date().toISOString();
  if (outputData) update.output_data = outputData;
  if (errorMessage) update.error_message = errorMessage;
  await db.from('fulfillment_steps').update(update).eq('id', stepId);
}

async function updateRunPhase(db: any, runId: string, phase: string) {
  await db.from('fulfillment_runs').update({ current_phase: phase }).eq('id', runId);
}

async function notifySlack(cloudUrl: string, anonKey: string, message: string) {
  try { await callFunction('slack-notify', { message }, cloudUrl, anonKey); } catch {}
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

    const { client_id, offer_id, run_id, client_data, brand_colors, brand_fonts, company_name, offer_description } = body;
    if (!client_id || !run_id) throw new Error('client_id and run_id required');

    const prodDb = getProdDb();
    const cloudUrl = getCloudUrl();
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';

    console.log(`[fulfill-visuals] Starting for ${company_name} (run: ${run_id})`);

    // ─── PHASE 4: Static Ad Creatives ───
    await updateRunPhase(prodDb, run_id, 'static_ads');
    await notifySlack(cloudUrl, anonKey, `🎨 Phase 4: Static ads for *${company_name}*`);

    const { data: styleData } = await prodDb
      .from('ad_styles').select('*')
      .ilike('name', '%capital%raising%').limit(1);
    const style = styleData?.[0];

    const adResults: any[] = [];
    let sortOrder = 40;

    if (style) {
      const projectId = `fulfillment-${client_id}`;
      let batchCount = 0;

      for (const plan of AD_PLAN) {
        for (let i = 0; i < plan.count; i++) {
          const stepId = await createStep(prodDb, run_id, 'static_ads', `Static Ad ${plan.ratio} #${i + 1}`, sortOrder++, 'edge_function', 'generate-static-ad');
          try {
            await updateStep(prodDb, stepId, 'running');
            const r = await callFunction('generate-static-ad', {
              prompt: '', stylePrompt: style.prompt_template,
              styleName: style.name, aspectRatio: plan.ratio,
              productDescription: offer_description, offerDescription: offer_description,
              brandColors: brand_colors || [], brandFonts: brand_fonts || [],
              projectId, clientId: client_id,
              referenceImages: style.reference_images || [],
              primaryReferenceImage: style.reference_images?.[0] || null,
              strictBrandAdherence: !!(brand_colors?.length),
              includeDisclaimer: true,
            }, cloudUrl, anonKey);

            if (r.ok && r.data?.success) {
              adResults.push({ ratio: plan.ratio, imageUrl: r.data.imageUrl });
              await prodDb.from('creatives').insert({
                client_id, title: `${company_name} - ${style.name} ${plan.ratio} #${i + 1}`,
                type: 'image', file_url: r.data.imageUrl,
                status: 'draft', source: 'auto-fulfillment',
                aspect_ratio: plan.ratio, trigger_campaign_id: offer_id || null,
              });
              await updateStep(prodDb, stepId, 'completed', { imageUrl: r.data.imageUrl, assetId: r.data.assetId });
            } else {
              await updateStep(prodDb, stepId, 'failed', null, r.data?.error || 'Ad generation failed');
            }
          } catch (e) {
            await updateStep(prodDb, stepId, 'failed', null, String(e));
          }

          batchCount++;
          if (batchCount % 3 === 0) await new Promise(r => setTimeout(r, 2000));
          else await new Promise(r => setTimeout(r, 500));
        }
      }
    } else {
      console.error('[fulfill-visuals] Capital Raising style not found');
    }

    console.log(`[fulfill-visuals] Ads: ${adResults.length}/10`);

    // ─── PHASE 5: AI Avatar Generation ───
    await updateRunPhase(prodDb, run_id, 'avatar');
    await notifySlack(cloudUrl, anonKey, `🧑 Phase 5: Avatar generation for *${company_name}*`);

    let avatarImageUrl: string | null = null;
    let avatarId: string | null = null;
    const avatarLookUrls: string[] = [];

    const mainAvatarStepId = await createStep(prodDb, run_id, 'avatar', 'Generate Main Avatar', sortOrder++, 'edge_function', 'generate-avatar');
    try {
      await updateStep(prodDb, mainAvatarStepId, 'running');
      const avatarR = await callFunction('generate-avatar', {
        gender: 'male', ageRange: '36-45', ethnicity: 'caucasian',
        style: 'ugc', background: 'studio', realism_level: 'high',
        avatar_description: `Professional headshot of a male investment professional, age 36-45, for ${company_name} capital raising campaign`,
        clientId: client_id,
      }, cloudUrl, anonKey);

      if (avatarR.ok && avatarR.data?.imageUrl) {
        avatarImageUrl = avatarR.data.imageUrl;
        const { data: avatarData } = await prodDb.from('avatars').insert({
          name: `${company_name} Fund Manager`,
          client_id, image_url: avatarImageUrl, is_active: true,
          style: 'ugc', gender: 'male',
          description: `Auto-generated avatar for ${company_name} fulfillment`,
        }).select('id').single();
        avatarId = avatarData?.id || null;
        await updateStep(prodDb, mainAvatarStepId, 'completed', { avatarId, imageUrl: avatarImageUrl });
      } else {
        await updateStep(prodDb, mainAvatarStepId, 'failed', null, avatarR.data?.error || 'Avatar failed');
      }
    } catch (e) {
      await updateStep(prodDb, mainAvatarStepId, 'failed', null, String(e));
    }

    // Generate 3 avatar looks
    const lookPrompts = [
      { name: 'Studio Headshot', prompt: 'Straight-on headshot, clean studio backdrop, professional lighting', background: 'studio' },
      { name: 'Office Setting', prompt: 'Slight angle, office setting with bookshelf, warm lighting', background: 'office' },
      { name: 'Casual Professional', prompt: 'Casual professional, outdoor urban setting, natural light', background: 'outdoor' },
    ];

    if (avatarId) {
      for (let i = 0; i < lookPrompts.length; i++) {
        const look = lookPrompts[i];
        const lookStepId = await createStep(prodDb, run_id, 'avatar', `Avatar Look: ${look.name}`, sortOrder++, 'edge_function', 'generate-avatar');
        try {
          await updateStep(prodDb, lookStepId, 'running');
          const r = await callFunction('generate-avatar', {
            gender: 'male', ageRange: '36-45', ethnicity: 'caucasian',
            style: 'ugc', background: look.background, realism_level: 'high',
            avatar_description: `${look.prompt}, investment professional for ${company_name}`,
            clientId: client_id,
          }, cloudUrl, anonKey);

          if (r.ok && r.data?.imageUrl) {
            avatarLookUrls.push(r.data.imageUrl);
            await prodDb.from('avatar_looks').insert({
              avatar_id: avatarId, name: look.name,
              image_url: r.data.imageUrl, prompt: look.prompt,
              background: look.background,
            });
            await updateStep(prodDb, lookStepId, 'completed', { imageUrl: r.data.imageUrl });
          } else {
            await updateStep(prodDb, lookStepId, 'failed', null, r.data?.error || 'Look failed');
          }
        } catch (e) {
          await updateStep(prodDb, lookStepId, 'failed', null, String(e));
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // ─── PHASE 6: Video Generation ───
    await updateRunPhase(prodDb, run_id, 'video');
    await notifySlack(cloudUrl, anonKey, `🎬 Phase 6: Video generation for *${company_name}*`);

    const videoResults: any[] = [];
    const officeLookUrl = avatarLookUrls[1] || avatarImageUrl;

    if (officeLookUrl) {
      // Avatar videos
      const videoPrompts = [
        { aspect: '9:16', prompt: `Professional fund manager speaking to camera, confident eye contact, subtle gestures, warm office lighting. Presenting ${company_name}'s investment opportunity. Natural talking head movement.` },
        { aspect: '16:9', prompt: `Fund manager in modern office, turning to camera with welcoming gesture. Professional, trustworthy, discussing ${company_name}'s track record. Cinematic lighting.` },
      ];

      for (let i = 0; i < videoPrompts.length; i++) {
        const vp = videoPrompts[i];
        const stepId = await createStep(prodDb, run_id, 'video', `Avatar Video ${vp.aspect} #${i + 1}`, sortOrder++, 'edge_function', 'generate-video-from-image');
        try {
          await updateStep(prodDb, stepId, 'running');
          const r = await callFunction('generate-video-from-image', {
            imageUrl: officeLookUrl, prompt: vp.prompt,
            aspectRatio: vp.aspect, duration: 5,
          }, cloudUrl, anonKey);

          if (r.ok && (r.data?.operationName || r.data?.videoUrl)) {
            videoResults.push({ ...r.data, aspect: vp.aspect });
            await prodDb.from('creatives').insert({
              client_id, title: `${company_name} - Avatar Video ${vp.aspect} #${i + 1}`,
              type: 'video', file_url: r.data.videoUrl || null,
              status: r.data.videoUrl ? 'draft' : 'processing',
              source: 'auto-fulfillment', aspect_ratio: vp.aspect,
              trigger_campaign_id: offer_id || null,
            });
            await updateStep(prodDb, stepId, 'completed', r.data);
          } else {
            await updateStep(prodDb, stepId, 'failed', null, r.data?.error || 'Video failed');
          }
        } catch (e) {
          await updateStep(prodDb, stepId, 'failed', null, String(e));
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // B-roll clips
    const brollPrompts = [
      'Aerial view of luxury real estate properties, cinematic drone footage, golden hour lighting',
      'Professional office interior, modern financial district, time-lapse of city skyline',
      'Charts and graphs showing upward growth trends on a premium monitor, shallow depth of field',
    ];

    for (let i = 0; i < brollPrompts.length; i++) {
      const stepId = await createStep(prodDb, run_id, 'video', `B-Roll Clip #${i + 1}`, sortOrder++, 'edge_function', 'generate-broll');
      try {
        await updateStep(prodDb, stepId, 'running');
        const r = await callFunction('generate-broll', {
          prompt: brollPrompts[i], aspectRatio: '16:9', duration: 5,
        }, cloudUrl, anonKey);

        if (r.ok) {
          videoResults.push({ ...r.data, type: 'broll' });
          await updateStep(prodDb, stepId, 'completed', r.data);
        } else {
          await updateStep(prodDb, stepId, 'failed', null, r.data?.error || 'B-roll failed');
        }
      } catch (e) {
        await updateStep(prodDb, stepId, 'failed', null, String(e));
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    // ─── Trigger Phase 7-8 (browser tasks) ───
    console.log(`[fulfill-visuals] Triggering browser phase for run ${run_id}`);
    fetch(`${cloudUrl}/functions/v1/fulfill-client-browser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
      body: JSON.stringify({
        password: PASSWORD, client_id, offer_id, run_id,
        company_name, offer_description, client_data,
        ad_image_urls: adResults.map(a => a.imageUrl),
        avatar_image_url: avatarImageUrl,
      }),
    }).catch(err => console.error('[fulfill-visuals] Browser trigger error:', err));

    return new Response(JSON.stringify({
      success: true, run_id,
      ads_generated: adResults.length,
      avatar_generated: !!avatarImageUrl,
      videos_generated: videoResults.length,
      message: 'Phases 4-6 complete. Phase 7-8 triggered.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[fulfill-visuals] Fatal error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
