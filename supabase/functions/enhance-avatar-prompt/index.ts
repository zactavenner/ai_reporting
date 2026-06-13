import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { callOpenRouter, AUDIO_MODELS, type ORMessage } from '../_shared/openrouter.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are an expert prompt engineer for hyper-realistic AI avatar image generation (Nano Banana Pro / Gemini).
The user will describe an avatar verbally (or via text). Produce a single concise prompt fragment (1-3 sentences, under 400 chars) describing the avatar's physical traits, outfit, mood, lighting, and any unique details they mentioned.

Rules:
- Do NOT include camera/aspect/resolution boilerplate — those are added elsewhere.
- Do NOT prefix with "Generate" or "Create".
- Preserve any specific details (hair color, accessories, vibe, profession, ethnicity nuances).
- If the input is vague, tastefully fill in cohesive details.
- Output ONLY the prompt fragment. No quotes, no labels, no commentary.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { audioBase64, audioFormat, text } = await req.json();

    if (!audioBase64 && !text) {
      return new Response(JSON.stringify({ success: false, error: 'audioBase64 or text required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userContent: ORMessage['content'] = [];
    if (text) userContent.push({ type: 'text', text: `Existing notes: ${text}` });
    if (audioBase64) {
      userContent.push({ type: 'text', text: 'Transcribe the audio and turn it into an avatar prompt fragment per the system instructions.' });
      userContent.push({
        type: 'input_audio',
        input_audio: { data: audioBase64, format: audioFormat || 'webm' },
      });
    } else {
      userContent.unshift({ type: 'text', text: 'Turn these notes into an avatar prompt fragment per the system instructions.' });
    }

    const result = await callOpenRouter(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      { models: AUDIO_MODELS, temperature: 0.6, max_tokens: 300 },
    );

    const enhanced = (result.text || '').trim().replace(/^["']|["']$/g, '');

    return new Response(JSON.stringify({ success: true, enhancedPrompt: enhanced, model: result.model }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('enhance-avatar-prompt error:', e);
    return new Response(JSON.stringify({ success: false, error: String(e instanceof Error ? e.message : e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
