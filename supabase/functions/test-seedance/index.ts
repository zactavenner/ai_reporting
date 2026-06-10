import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const KEY = Deno.env.get('OPENROUTER_API_KEY');
  if (!KEY) return new Response(JSON.stringify({ ok: false, error: 'no key' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const body = {
    model: 'bytedance/seedance-2.0-fast',
    prompt: 'Cinematic drone shot of a modern downtown skyline at golden hour, slow push in, soft glow',
    resolution: '720p',
    aspect_ratio: '16:9',
    duration: 4,
  };
  const t0 = Date.now();
  const submit = await fetch('https://openrouter.ai/api/v1/videos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://reporting.highperformanceads.com',
      'X-Title': 'AI Studio Test',
    },
    body: JSON.stringify(body),
  });
  const submitText = await submit.text();
  if (!submit.ok) {
    return new Response(JSON.stringify({ ok: false, stage: 'submit', status: submit.status, body: submitText.slice(0, 800) }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const sj = JSON.parse(submitText);
  const url = new URL(req.url);
  if (url.searchParams.get('poll')) {
    const pollingUrl = url.searchParams.get('poll')!;
    const p = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${KEY}` } });
    const pj = await p.json();
    const urls = pj?.unsigned_urls || pj?.urls || (pj?.video?.url ? [pj.video.url] : []);
    return new Response(JSON.stringify({ status: pj?.status, error: pj?.error, videoUrl: urls[0] || null, raw: pj }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    ok: true,
    elapsed_s: (Date.now() - t0) / 1000,
    jobId: sj.id,
    polling_url: sj.polling_url,
    submitResponse: sj,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});