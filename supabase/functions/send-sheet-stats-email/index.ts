import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const INTERNAL_PASSWORD = "HPA1234$";

interface Payload {
  recipients: string[];
  subject: string;
  html: string;
  pdf_base64?: string;
  pdf_filename?: string;
  client_name?: string;
  client_id?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recipients, subject, html, client_name, client_id } = (await req.json()) as Payload;

    const cleaned = (recipients || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

    if (cleaned.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid recipient emails provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const results: Array<{ email: string; ok?: boolean; error?: string; messageId?: string }> = [];
    for (const email of cleaned) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-ghl-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: INTERNAL_PASSWORD,
            channel: 'email',
            to_email: email,
            name: client_name || 'Investor Report',
            subject: subject || `${client_name || 'Client'} — Stat Sheet`,
            html,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `send failed ${res.status}`);
        results.push({ email, ok: true, messageId: data?.messageId });

        if (client_id) {
          await supabase.from('client_report_sends').insert({
            client_id,
            cadence: 'ad_hoc',
            channel: 'email',
            period_start: new Date().toISOString().slice(0, 10),
            period_end: new Date().toISOString().slice(0, 10),
            status: 'sent',
            idempotency_key: `stats:${client_id}:${email}:${Date.now()}`,
            ghl_message_id: data?.messageId || null,
            ghl_contact_id: data?.contactId || null,
            sent_at: new Date().toISOString(),
            payload: { subject, source: 'send-sheet-stats-email' },
          });
        }
      } catch (e: any) {
        const msg = e?.message || String(e);
        results.push({ email, error: msg });
        if (client_id) {
          await supabase.from('client_report_sends').insert({
            client_id,
            cadence: 'ad_hoc',
            channel: 'email',
            period_start: new Date().toISOString().slice(0, 10),
            period_end: new Date().toISOString().slice(0, 10),
            status: 'failed',
            error: msg,
            idempotency_key: `stats:${client_id}:${email}:${Date.now()}`,
            payload: { subject, source: 'send-sheet-stats-email' },
          });
        }
      }
    }

    const failed = results.filter((r) => r.error);
    if (failed.length === results.length) {
      return new Response(JSON.stringify({ error: failed[0].error, results }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true, sent_to: results.filter((r) => r.ok).map((r) => r.email), results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});