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
  const pollingUrl = sj.polling_url;
  const jobId = sj.id;
  let last: any = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const p = await fetch(pollingUrl, { headers: { Authorization: `Bearer ${KEY}` } });
    if (!p.ok) { last = { http: p.status }; continue; }
    last = await p.json();
    if (last.status === 'completed' || last.status === 'failed') break;
  }
  const urls = last?.unsigned_urls || last?.urls || (last?.video?.url ? [last.video.url] : []);
  return new Response(JSON.stringify({
    ok: last?.status === 'completed',
    elapsed_s: (Date.now() - t0) / 1000,
    jobId,
    status: last?.status,
    error: last?.error,
    videoUrl: urls[0] || null,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});