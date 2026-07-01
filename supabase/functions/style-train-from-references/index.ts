import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const OPENROUTER_API_KEY = (Deno.env.get('OPENROUTER_API_KEY') || '').trim().replace(/^['"]|['"]$/g, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const styleId = String(body?.style_id ?? '');
    if (!styleId) return json({ error: 'style_id required' }, 400);

    const { data: style, error: loadErr } = await supabase
      .from('video_style_presets')
      .select('id, name, prompt, references')
      .eq('id', styleId)
      .maybeSingle();
    if (loadErr || !style) return json({ error: 'style not found' }, 404);

    const refs = (Array.isArray(style.references) ? style.references : []).filter(
      (r: { transcript?: string; analysis?: unknown }) => (r?.transcript && r.transcript.trim()) || r?.analysis,
    );
    if (!refs.length) {
      return json({ error: 'No transcribed references. Auto-transcribe at least one reference first.' }, 400);
    }

    const examplesBlock = refs
      .map(
        (r: { name?: string; url: string; transcript?: string; analysis?: unknown }, i: number) =>
          `--- EXAMPLE ${i + 1}${r.name ? ` (${r.name})` : ''} ---\nURL: ${r.url}\nTRANSCRIPT:\n${(r.transcript || '').slice(0, 2000)}\nANALYSIS:\n${JSON.stringify(r.analysis ?? {}, null, 2)}`,
      )
      .join('\n\n');

    const systemPrompt = `You are a senior video direction prompt engineer. You produce STYLE prompt blocks that, when prepended to a short-form video generation request, force the output to match a target reference style.

Output format (plain text, no markdown headers, no preamble):
STYLE: <one paragraph describing the look, pacing, audio, energy>

RULES:
- <bullet on talent / camera / framing>
- <bullet on cuts and pacing in seconds>
- <bullet on lighting and grade>
- <bullet on audio: voice tone, music, SFX>
- <bullet on hook (first 0-2s) structure>
- <bullet on CTA structure>
- <bullet on hard constraints / things to NEVER do>

STRUCTURE (for a 12-15s clip):
- (0-2s) ...
- (2-6s) ...
- (6-12s) ...
- (12-15s) CTA ...

Synthesize from the patterns visible across the examples. Be specific and prescriptive — no fluff.`;

    const userPrompt = `Style name: ${style.name}\nCurrent prompt (may be empty or stale, use only as weak prior):\n${style.prompt || '(none)'}\n\nReference examples to learn from:\n\n${examplesBlock}\n\nWrite the new STYLE prompt block now.`;

    if (!OPENROUTER_API_KEY.startsWith('sk-or-')) return json({ error: 'OPENROUTER_API_KEY missing or invalid' }, 500);
    const aiResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://reporting.highperformanceads.com',
        'X-Title': 'HPA Style Training',
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text().catch(() => '');
      return json({ error: `OpenRouter ${aiResp.status}: ${text.slice(0, 400)}` }, 502);
    }
    const aiJson = await aiResp.json();
    const trained = String(aiJson?.choices?.[0]?.message?.content ?? '').trim();
    if (!trained) return json({ error: 'empty completion' }, 502);

    const { error: saveErr } = await supabase
      .from('video_style_presets')
      .update({ ai_trained_prompt: trained, prompt: trained })
      .eq('id', styleId);
    if (saveErr) return json({ error: saveErr.message }, 500);

    return json({ ok: true, prompt: trained, references_used: refs.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown error' }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}