import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { callOpenRouterJSON } from '../_shared/openrouter.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { text, channel } = await req.json();
    if (!text?.trim()) {
      return new Response(JSON.stringify({ messages: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const ch = channel === 'email' ? 'email' : 'sms';

    const schema = ch === 'email'
      ? `{ "messages": [ { "delay_days": number, "from_name": string, "subject": string, "body": string } ] }`
      : `{ "messages": [ { "delay_days": number, "body": string } ] }`;

    const rules = ch === 'email'
      ? `- Extract every distinct email in the pasted nurture sequence, in order.
- "delay_days" = integer number of days from the FIRST message (first email = 0). Parse cues like "Day 0", "Day 3", "Day 7", "+2 days", "next day", "one week later", etc. If no timing is stated for a later email, space it +2 days from the previous one.
- "subject" = the email subject line (strip "Subject:" prefix). If none is stated, invent a short, on-brand subject from the body.
- "from_name" = the sender name if present (e.g. "From: Alex"), else "".
- "body" = the actual email body text, cleaned up. Preserve line breaks. Do NOT include the subject or delay markers inside body.`
      : `- Extract every distinct SMS/text message in the pasted nurture sequence, in order.
- "delay_days" = integer number of days from the FIRST message (first sms = 0). Parse cues like "Day 0", "Day 2", "+1 day", "next day", "one week later". If no timing is stated for a later message, space it +2 days from the previous one.
- "body" = the actual SMS text only. Strip labels like "SMS 1:", "Text:", "Day 3 -", etc.`;

    const system = `You convert a pasted nurture sequence into structured JSON for a ${ch.toUpperCase()} cadence editor.

${rules}

Return ONLY valid JSON matching this exact shape:
${schema}

No commentary. No markdown fences.`;

    const { data } = await callOpenRouterJSON<{ messages: any[] }>(
      [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      { temperature: 0.2, max_tokens: 4000 },
    );

    const rawMsgs = Array.isArray(data?.messages) ? data.messages : [];
    const messages = rawMsgs.map((m: any, i: number) => {
      const delay = Number.isFinite(Number(m?.delay_days)) ? Math.max(0, Math.floor(Number(m.delay_days))) : i * 2;
      if (ch === 'email') {
        return {
          delay_days: delay,
          from_name: String(m?.from_name || '').trim(),
          subject: String(m?.subject || '').trim(),
          body: String(m?.body || '').trim(),
        };
      }
      return { delay_days: delay, body: String(m?.body || '').trim() };
    }).filter((m: any) => m.body || m.subject);

    return new Response(JSON.stringify({ messages }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[parse-nurture-sequence]', e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});