import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: userData } = await supa.auth.getUser(token);
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { creativeId, fast = false, resolution = '1080p', model = 'seedance' } = await req.json();
    if (!creativeId) {
      return new Response(JSON.stringify({ error: 'creativeId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const useHappyHorse = String(model).toLowerCase() === 'happyhorse';
    const statusCol = useHappyHorse ? 'video_status_alt' : 'video_status';
    const urlCol = useHappyHorse ? 'video_url_alt' : 'video_url';
    const modelCol = useHappyHorse ? 'video_model_alt' : 'video_model';

    const { data: creative, error: cErr } = await supa
      .from('fundad_creatives')
      .select('*')
      .eq('id', creativeId)
      .eq('user_id', user.id)
      .single();
    if (cErr || !creative) throw new Error('Creative not found');

    await supa.from('fundad_creatives').update({ [statusCol]: 'generating' }).eq('id', creativeId);

    const orModel = useHappyHorse
      ? 'alibaba/happyhorse-1.1'
      : (fast ? 'bytedance/seedance-2.0-fast' : 'bytedance/seedance-2.0');
    const effectiveResolution = (fast && resolution === '1080p') ? '720p' : resolution;
    const submit = await fetch('https://openrouter.ai/api/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://reporting.highperformanceads.com',
        'X-Title': `FundAd AI Studio — ${useHappyHorse ? 'HappyHorse' : 'Seedance'}`,
      },
      body: JSON.stringify({
        model: orModel,
        prompt: creative.seedance_prompt,
        resolution: effectiveResolution,
        aspect_ratio: '9:16',
        duration: 15,
      }),
    });
    if (!submit.ok) {
      const t = await submit.text();
      throw new Error(`${useHappyHorse ? 'HappyHorse' : 'Seedance'} submit ${submit.status}: ${t.slice(0, 400)}`);
    }
    const sj = await submit.json();
    const pollingUrl: string | undefined = sj.polling_url;
    const jobId = sj.id || crypto.randomUUID();
    if (!pollingUrl) throw new Error(`No polling_url from ${useHappyHorse ? 'HappyHorse' : 'Seedance'}`);

    let videoUrl: string | null = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const p = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` } });
      if (!p.ok) continue;
      const pj = await p.json();
      if (pj.status === 'completed') {
        const urls: string[] = pj.unsigned_urls || pj.urls || (pj.video?.url ? [pj.video.url] : []);
        videoUrl = urls[0] || null;
        break;
      }
      if (pj.status === 'failed') throw new Error(`${useHappyHorse ? 'HappyHorse' : 'Seedance'} failed: ${pj.error || 'unknown'}`);
    }
    if (!videoUrl) throw new Error(`${useHappyHorse ? 'HappyHorse' : 'Seedance'} timed out`);

    let storedUrl = videoUrl;
    try {
      const dl = await fetch(videoUrl);
      if (dl.ok) {
        const bytes = new Uint8Array(await dl.arrayBuffer());
        const path = `fundad/${user.id}/${useHappyHorse ? 'happyhorse' : 'seedance'}-${jobId}-${Date.now()}.mp4`;
        const up = await supa.storage.from('creatives').upload(path, bytes, {
          contentType: 'video/mp4',
          upsert: false,
        });
        if (!up.error) {
          const { data: pub } = supa.storage.from('creatives').getPublicUrl(path);
          storedUrl = pub.publicUrl;
        }
      }
    } catch (e) {
      console.warn('Rehost failed', e);
    }

    await supa
      .from('fundad_creatives')
      .update({ [urlCol]: storedUrl, [statusCol]: 'completed', [modelCol]: orModel })
      .eq('id', creativeId);

    return new Response(JSON.stringify({ videoUrl: storedUrl, model: orModel }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('fundad-render error', e);
    try {
      const { creativeId, model } = await req.clone().json().catch(() => ({}));
      if (creativeId) {
        const useHH = String(model || '').toLowerCase() === 'happyhorse';
        const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await supa
          .from('fundad_creatives')
          .update(useHH ? { video_status_alt: 'failed' } : { video_status: 'failed' })
          .eq('id', creativeId);
      }
    } catch {}
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});