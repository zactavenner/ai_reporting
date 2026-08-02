const K = Deno.env.get('OPENROUTER_API_KEY')!;
const H = { Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
async function run(prompt: string, ref: string) {
  const body = { model: 'minimax/hailuo-3', prompt, aspect_ratio: '9:16', duration: 15, resolution: '2K', generate_audio: true, frame_images: [{ type: 'image_url', image_url: { url: ref }, frame_type: 'first_frame' }] };
  const s = await fetch('https://openrouter.ai/api/v1/videos', { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await s.text();
  if (!s.ok) return { ok: false, status: s.status, body: t.slice(0, 600) };
  const j = JSON.parse(t);
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const p = await fetch(j.polling_url, { headers: H });
    if (!p.ok) continue;
    const pj = await p.json();
    if (pj.status === 'completed') return { ok: true, url: (pj.unsigned_urls || pj.urls || [])[0] || pj.video?.url || null };
    if (pj.status === 'failed') return { ok: false, error: JSON.stringify(pj).slice(0, 500) };
  }
  return { ok: false, error: 'timeout' };
}
Deno.serve(async (req) => {
  const { ref } = await req.json();
  const [a, b] = await Promise.all([
    run('Vertical UGC ad. The same woman speaks straight to camera in a bright modern office, natural handheld motion, opening hook.', ref),
    run('Vertical UGC ad, direct continuation. The SAME woman, same wardrobe, same lighting and framing, continues speaking to camera and delivers the payoff.', ref),
  ]);
  return Response.json({ clip1: a, clip2: b });
});
