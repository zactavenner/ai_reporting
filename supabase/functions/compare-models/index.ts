import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { prompt, system, models } = await req.json();
    if (!prompt || !Array.isArray(models) || models.length === 0) {
      return new Response(JSON.stringify({ error: 'prompt and models[] required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const messages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ];

    const results = await Promise.all((models as string[]).slice(0, 6).map(async (model) => {
      const t0 = Date.now();
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://lovable.dev",
            "X-Title": "AI Studio Compare",
          },
          body: JSON.stringify({ model, messages }),
        });
        const text = await res.text();
        let json: any = null;
        try { json = JSON.parse(text); } catch {}
        if (!res.ok) {
          return { model, error: json?.error?.message || text || `HTTP ${res.status}`, ms: Date.now() - t0 };
        }
        const output = json?.choices?.[0]?.message?.content ?? '';
        const usage = json?.usage ?? null;
        return { model, output: typeof output === 'string' ? output : JSON.stringify(output), usage, ms: Date.now() - t0 };
      } catch (e: any) {
        return { model, error: e?.message || String(e), ms: Date.now() - t0 };
      }
    }));

    return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});