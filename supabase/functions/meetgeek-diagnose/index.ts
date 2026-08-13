// Temporary diagnostic: verifies MeetGeek credentials. Never returns the key.
Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body?.password !== "HPA1234$") return new Response("no", { status: 401 });
  const apiKey = (Deno.env.get("MEETGEEK_API_KEY") || "").trim();
  const out: any[] = [];
  for (const base of ["https://api-us.meetgeek.ai", "https://api-eu.meetgeek.ai"]) {
    const res = await fetch(`${base}/v1/meetings?limit=2`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const text = await res.text();
    out.push({ base, status: res.status, sample: text.slice(0, 300) });
  }
  return new Response(JSON.stringify({ key_length: apiKey.length, out }), {
    headers: { "Content-Type": "application/json" },
  });
});
