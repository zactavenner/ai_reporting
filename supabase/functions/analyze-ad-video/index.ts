import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VIDEO_AGENT_NAME_PATTERN = '%video%';
const LOVABLE_KEY = Deno.env.get('LOVABLE_API_KEY');

interface Body {
  clientId: string;
  adId?: string;
  adName?: string;
  videoUrl: string;
  mode?: 'transcribe' | 'train';
  metrics?: Record<string, unknown>;
}

const BREAKDOWN_SYSTEM = `You are a senior direct-response video ad analyst.
Given a video ad, produce STRICT JSON with this shape and no prose:
{
  "transcript": string,
  "hook": { "first_3s": string, "type": string, "why_it_works": string },
  "structure": [{ "t": string, "beat": string, "purpose": string }],
  "visual_style": string,
  "audio_style": string,
  "pacing": string,
  "cta": string,
  "target_avatar": string,
  "why_it_works": string,
  "replicable_formula": string,
  "variation_ideas": [string]
}`;

async function fetchVideoBase64(url: string): Promise<{ b64: string; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Video fetch failed (${res.status})`);
  const mime = res.headers.get('content-type') || 'video/mp4';
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > 18 * 1024 * 1024) {
    throw new Error(`Video is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — inline analysis caps at 18MB. Trim or use a shorter clip.`);
  }
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(bin), mime };
}

async function analyzeWithGemini(videoUrl: string, adName: string, metrics?: Record<string, unknown>) {
  const { b64, mime } = await fetchVideoBase64(videoUrl);
  const userText = `Ad name: ${adName}\nPerformance: ${JSON.stringify(metrics || {})}\n\nAnalyze this video ad end-to-end. Return ONLY the JSON schema.`;
  const body = {
    model: 'google/gemini-2.5-flash',
    messages: [
      { role: 'system', content: BREAKDOWN_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'input_audio', input_audio: { data: b64, format: mime.includes('mp4') ? 'mp4' : 'webm' } },
        ] as any,
      },
    ],
    response_format: { type: 'json_object' },
  };
  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gemini analyze failed: ${r.status} ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty AI response');
  try { return JSON.parse(content); } catch { return { transcript: content, raw: true }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!LOVABLE_KEY) throw new Error('LOVABLE_API_KEY not configured');
    const body = (await req.json()) as Body;
    if (!body.videoUrl) throw new Error('videoUrl required');
    const mode = body.mode ?? 'transcribe';

    const analysis = await analyzeWithGemini(body.videoUrl, body.adName || 'Untitled Ad', body.metrics);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (mode === 'train') {
      const { data: agents } = await supabase
        .from('agency_agents')
        .select('id, name')
        .or(`name.ilike.${VIDEO_AGENT_NAME_PATTERN},role.ilike.${VIDEO_AGENT_NAME_PATTERN}`)
        .limit(1);
      const agentId = agents?.[0]?.id;
      if (!agentId) throw new Error('Video Ads Specialist agent not found');

      const bodyMd = [
        `# Top-Performer Breakdown: ${body.adName}`,
        body.metrics ? `**Metrics:** ${JSON.stringify(body.metrics)}` : '',
        `**Client:** ${body.clientId}`,
        `**Source video:** ${body.videoUrl}`,
        '',
        '## Transcript',
        analysis.transcript || '_(not extracted)_',
        '',
        '## Hook',
        `- First 3s: ${analysis.hook?.first_3s || '—'}`,
        `- Type: ${analysis.hook?.type || '—'}`,
        `- Why it works: ${analysis.hook?.why_it_works || '—'}`,
        '',
        '## Structure',
        ...(analysis.structure || []).map((s: any) => `- ${s.t || ''} — ${s.beat}: ${s.purpose}`),
        '',
        `## Visual style\n${analysis.visual_style || '—'}`,
        `## Audio style\n${analysis.audio_style || '—'}`,
        `## Pacing\n${analysis.pacing || '—'}`,
        `## CTA\n${analysis.cta || '—'}`,
        `## Target avatar\n${analysis.target_avatar || '—'}`,
        `## Why it works\n${analysis.why_it_works || '—'}`,
        `## Replicable formula\n${analysis.replicable_formula || '—'}`,
        '',
        '## Variation ideas',
        ...((analysis.variation_ideas || []) as string[]).map((v) => `- ${v}`),
      ].filter(Boolean).join('\n');

      const { error } = await supabase.from('agency_agent_training').insert({
        agent_id: agentId,
        kind: 'example',
        title: `Top performer: ${body.adName}`.slice(0, 200),
        body: bodyMd,
        file_url: body.videoUrl,
        weight: 5,
      });
      if (error) throw error;
    }

    return new Response(JSON.stringify({ ok: true, mode, analysis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});