import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Payload {
  recipients: string[];
  subject: string;
  html: string;
  pdf_base64?: string;
  pdf_filename?: string;
  client_name?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'Email provider not configured. Add a RESEND_API_KEY secret to enable Stat Sheet email reports.',
          code: 'email_not_configured',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { recipients, subject, html, pdf_base64, pdf_filename, client_name } = (await req.json()) as Payload;

    const cleaned = (recipients || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    if (cleaned.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid recipient emails provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fromAddress = Deno.env.get('STATS_REPORT_FROM') || 'reports@highperformanceads.com';

    const attachments = pdf_base64
      ? [{ filename: pdf_filename || `${(client_name || 'report').toLowerCase().replace(/\s+/g, '-')}-stat-sheet.pdf`, content: pdf_base64 }]
      : undefined;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${client_name || 'High Performance Ads'} Reports <${fromAddress}>`,
        to: cleaned,
        subject: subject || `${client_name || 'Client'} – Stat Sheet`,
        html,
        attachments,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.message || 'Send failed', detail: data }), {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, sent_to: cleaned, id: data?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});