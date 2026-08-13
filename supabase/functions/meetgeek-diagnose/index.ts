// Temporary diagnostic: probes MeetGeek auth header variants. Never returns the key.
Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body?.password !== "HPA1234$") return new Response("no", { status: 401 });
  const apiKey = (Deno.env.get("MEETGEEK_API_KEY") || "").trim();
  const variants: Record<string, Record<string, string>> = {
    bearer: { Authorization: `Bearer ${apiKey}` },
    raw: { Authorization: apiKey },
    xapikey: { "x-api-key": apiKey },
  };
  const out: any[] = [];
  for (const [name, headers] of Object.entries(variants)) {
    for (const path of ["/v1/meetings?limit=2", "/v1/meetings"]) {
      const res = await fetch(`https://api.meetgeek.ai${path}`, { headers });
      out.push({ host: "api.meetgeek.ai", name, path, status: res.status, sample: (await res.text()).slice(0, 200) });
    }
  }
  return new Response(JSON.stringify({ key_length: apiKey.length, key_prefix_shape: /^[A-Za-z0-9._-]+$/.test(apiKey), out }), {
    headers: { "Content-Type": "application/json" },
  });
});
