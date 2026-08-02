const K = Deno.env.get('OPENROUTER_API_KEY')!;
const H = { Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  const b = await req.json();
  if (b.action === 'poll') {
    const out = [];
    for (const u of b.urls as string[]) {
      const p = await fetch(u, { headers: H });
      const t = await p.text();
      out.push({ url: u, status: p.status, body: t.slice(0, 800) });
    }
    return Response.json({ out });
  }
  const mk = (prompt: string) => ({
    model: 'minimax/hailuo-3', prompt, aspect_ratio: '9:16', duration: 15,
    resolution: '2K', generate_audio: true,
    frame_images: [{ type: 'image_url', image_url: { url: b.ref }, frame_type: 'first_frame' }],
  });
  const subs = await Promise.all([
    'Vertical UGC ad. The same woman speaks straight to camera in a bright modern office, natural handheld motion, opening hook.',
    'Vertical UGC ad, direct continuation. The SAME woman, same wardrobe, same lighting and framing, continues speaking to camera and delivers the payoff.',
  ].map(async (p) => {
    const r = await fetch('https://openrouter.ai/api/v1/videos', { method: 'POST', headers: H, body: JSON.stringify(mk(p)) });
    return { status: r.status, body: (await r.text()).slice(0, 800) };
  }));
  return Response.json({ subs });
});
