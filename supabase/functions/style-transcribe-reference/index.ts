import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const OPENROUTER_API_KEY = (Deno.env.get('OPENROUTER_API_KEY') || '').trim().replace(/^['"]|['"]$/g, '');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

type Ref = {
  url: string;
  name?: string;
  kind?: 'image' | 'video';
  transcript?: string;
  analysis?: Record<string, unknown>;
  transcribed_at?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'unauthorized' }, 401);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const styleId = String(body?.style_id ?? '');
    const refIndex = Number(body?.reference_index);
    if (!styleId || !Number.isInteger(refIndex) || refIndex < 0) {
      return json({ error: 'style_id and reference_index required' }, 400);
    }

    const { data: style, error: loadErr } = await supabase
      .from('video_style_presets')
      .select('id, references')
      .eq('id', styleId)
      .maybeSingle();
    if (loadErr || !style) return json({ error: 'style not found' }, 404);

    const refs: Ref[] = Array.isArray(style.references) ? style.references : [];
    const ref = refs[refIndex];
    if (!ref?.url) return json({ error: 'reference not found' }, 404);

    if (!OPENROUTER_API_KEY.startsWith('sk-or-')) return json({ error: 'OPENROUTER_API_KEY missing or invalid' }, 500);
    const aiResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://reporting.highperformanceads.com',
        'X-Title': 'HPA Style Reference Analysis',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content:
              'You analyze short video ads for style training. Return STRICT JSON with keys: transcript (full spoken-word transcript), analysis (object with: format, pacing_cuts_per_sec, camera_style, lighting, audio_treatment, hook_pattern, cta_pattern, visual_motifs[], tone). No prose outside JSON.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this reference video for style training:' },
              { type: 'image_url', image_url: { url: ref.url } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiResp.ok) {
      const text = await aiResp.text().catch(() => '');
      return json({ error: `ai gateway ${aiResp.status}: ${text.slice(0, 400)}` }, 502);
    }
    const aiJson = await aiResp.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? '{}';
    let parsed: { transcript?: string; analysis?: Record<string, unknown> } = {};
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      parsed = { transcript: String(raw).slice(0, 4000) };
    }

    const updated: Ref = {
      ...ref,
      transcript: parsed.transcript ?? ref.transcript ?? '',
      analysis: parsed.analysis ?? ref.analysis ?? {},
      transcribed_at: new Date().toISOString(),
    };
    const nextRefs = [...refs];
    nextRefs[refIndex] = updated;

    const { error: saveErr } = await supabase
      .from('video_style_presets')
      .update({ references: nextRefs })
      .eq('id', styleId);
    if (saveErr) return json({ error: saveErr.message }, 500);

    return json({ ok: true, reference: updated });
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