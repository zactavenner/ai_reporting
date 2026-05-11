import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/twilio';

// Compliance: never claim "guaranteed" returns in investment marketing.
const FORBIDDEN_PATTERNS = [/\bguaranteed?\b/i, /\bguarantee\b/i];

function complianceLint(message: string): string | null {
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.test(message)) return `Message contains forbidden term matching ${p}`;
  }
  return null;
}

function normalizeWhatsApp(num: string): string {
  const t = (num || '').trim();
  if (!t) return '';
  if (t.startsWith('whatsapp:')) return t;
  return `whatsapp:${t.startsWith('+') ? t : '+' + t.replace(/\D/g, '')}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const TWILIO_API_KEY = Deno.env.get('TWILIO_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
    if (!TWILIO_API_KEY) throw new Error('TWILIO_API_KEY is not configured — connect Twilio first');

    const body = await req.json().catch(() => ({}));
    const { to, message, from } = body || {};
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'message required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const recipients: string[] = Array.isArray(to) ? to : (to ? [to] : []);
    if (!recipients.length) {
      return new Response(JSON.stringify({ error: 'to (recipient) required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const violation = complianceLint(message);
    if (violation) {
      return new Response(JSON.stringify({ error: 'compliance_violation', detail: violation }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    let fromNumber = from;
    if (!fromNumber) {
      const { data: ag } = await supabase.from('agency_settings').select('twilio_whatsapp_from').limit(1).maybeSingle();
      fromNumber = ag?.twilio_whatsapp_from;
    }
    if (!fromNumber) throw new Error('No Twilio WhatsApp sender configured (twilio_whatsapp_from)');
    const fromNorm = normalizeWhatsApp(fromNumber);

    const results: any[] = [];
    for (const r of recipients) {
      const toNorm = normalizeWhatsApp(r);
      try {
        const res = await fetch(`${GATEWAY_URL}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'X-Connection-Api-Key': TWILIO_API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ From: fromNorm, To: toNorm, Body: message }),
        });
        const data = await res.json();
        if (!res.ok) {
          results.push({ to: toNorm, ok: false, status: res.status, error: data?.message || JSON.stringify(data) });
        } else {
          results.push({ to: toNorm, ok: true, sid: data?.sid });
        }
      } catch (e) {
        results.push({ to: toNorm, ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    return new Response(JSON.stringify({ success: results.some(r => r.ok), results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('send-whatsapp-report error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});